import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout, AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { PaymentPlansPanel } from "@/components/PaymentPlansPanel";
import { MultiMethodPaymentDialog } from "@/components/MultiMethodPaymentDialog";
import { SideSummary } from "@/components/contact/SideSummary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { fetchAllRows } from "@/lib/fetchAll";
import { formatEGP, formatDate } from "@/lib/format";
import { printReport, exportToExcel } from "@/lib/export";
import { logAudit } from "@/lib/roles";
import { saveContact, deleteContact } from "@/lib/contactWrites";
import {
  fetchContactOverview, fetchContactDocuments, fetchContactMoney, methodLabel,
  type ContactOverview, type ContactDocument, type ContactMoneyRow, type Side,
} from "@/lib/ledger";
import { toast } from "sonner";
import { ArrowRight, Activity, Building2, DollarSign, Download, FileText, HandCoins, Pencil, Phone, MapPin, Receipt, Archive, User, AlertTriangle } from "lucide-react";
import { vouchersForMovements } from "@/lib/movementVouchers";
import { useAttachmentCounts } from "@/hooks/useAttachmentCounts";
import { AttachmentsDialogButton } from "@/components/AttachmentsDialogButton";

/**
 * Contact file (360°) — Step 6C. Everything comes from the unified ledger:
 *   • customer account and supplier account are two separate sections — never netted;
 *   • scope: all branches (company admins) or one branch (documents and money of that branch;
 *     money that crossed branches is shown on its own line);
 *   • documents open / closed / cancelled / before the ledger date, money, returns, statement, plans.
 */
type DocFilter = "all" | "open" | "closed" | "cancelled" | "before_ledger";
const STATE_LABEL: Record<string, { t: string; c: string }> = {
  open: { t: "مفتوحة", c: "bg-warning/15 text-warning" },
  closed: { t: "مقفولة", c: "bg-success/15 text-success" },
  cancelled: { t: "ملغاة", c: "bg-destructive/15 text-destructive" },
  before_ledger: { t: "قبل 2026 (أرشيف)", c: "bg-muted text-muted-foreground" },
};

export default function ContactFile() {
  const params = useParams<{ id: string; supplierId: string; contactId: string }>();
  const routeBranchId = params.id;
  const contactId = params.supplierId || params.contactId;
  const nav = useNavigate();
  const { user, profile, tenantId, branches, isAdmin, hasRole } = useAuth();
  const isAdminView = !routeBranchId;
  const Layout = isAdminView ? AdminLayout : BranchLayout;
  const backTo = isAdminView ? "/admin/contacts" : `/branch/${routeBranchId}/contacts`;

  // scope: "all" = company-wide (admins); otherwise a branch id
  const [scope, setScope] = useState<string>(isAdmin || !routeBranchId ? "all" : routeBranchId);
  const scopeBranch = scope === "all" ? null : scope;
  const [ov, setOv] = useState<ContactOverview | null>(null);
  const [ovAll, setOvAll] = useState<ContactOverview | null>(null);
  const [side, setSide] = useState<Side>("customer");
  const [docs, setDocs] = useState<ContactDocument[]>([]);
  const [money, setMoney] = useState<ContactMoneyRow[]>([]);
  // voucher of each money row → its attachments (transfer receipts)
  const [moneyVouchers, setMoneyVouchers] = useState<Record<string, { id: string; status: string }>>({});
  useEffect(() => {
    let alive = true;
    if (!money.length) { setMoneyVouchers({}); return; }
    vouchersForMovements(money).then((m) => { if (alive) setMoneyVouchers(m); }).catch(() => {});
    return () => { alive = false; };
  }, [money]);
  const moneyAttCounts = useAttachmentCounts("voucher", useMemo(() => Object.values(moneyVouchers).map((v) => v.id), [moneyVouchers]));
  const [returnsRows, setReturnsRows] = useState<any[]>([]);
  const [docFilter, setDocFilter] = useState<DocFilter>("all");
  const [loading, setLoading] = useState(true);
  const [payDir, setPayDir] = useState<null | "in" | "out">(null);
  // branch that receives / pays the money: the page's branch, the chosen scope, or picked by the user
  const [payPick, setPayPick] = useState<null | "in" | "out">(null);
  // void of a payment transaction (collection / payment from this file or a plan); a cashier's request
  // waits for a manager's approval, a manager / accountant voids at once
  const [voidRow, setVoidRow] = useState<ContactMoneyRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidBusy, setVoidBusy] = useState(false);
  const [pickedBranch, setPickedBranch] = useState<string>("");
  const [editOpen, setEditOpen] = useState(false);
  // «سدد من تحت حسابه»: use money already on account for one open document (owner rule, 0082)
  const [useAcc, setUseAcc] = useState<ContactDocument | null>(null);
  const [useAccAmount, setUseAccAmount] = useState("");
  const [useAccBusy, setUseAccBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [edit, setEdit] = useState({ name: "", type: "customer" as "customer" | "supplier" | "both", contact_person: "", phone: "", address: "", notes: "" });

  const c = ov?.contact;
  const hasCustomer = c?.type === "customer" || c?.type === "both" || Math.abs(ov?.customer?.balance ?? 0) > 0.005;
  const hasSupplier = c?.type === "supplier" || c?.type === "both" || Math.abs(ov?.supplier?.balance ?? 0) > 0.005;

  const loadOverview = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    try {
      const [o, oa] = await Promise.all([
        fetchContactOverview(contactId, scopeBranch),
        scopeBranch ? fetchContactOverview(contactId, null).catch(() => null) : Promise.resolve(null),
      ]);
      setOv(o);
      setOvAll(oa);
      setSide((cur) => {
        const cOk = o.customer && (o.contact.type !== "supplier" || Math.abs(o.customer.balance) > 0.005);
        const sOk = o.supplier && (o.contact.type !== "customer" || Math.abs(o.supplier.balance) > 0.005);
        if (cur === "customer" && cOk) return cur;
        if (cur === "supplier" && sOk) return cur;
        return cOk ? "customer" : "supplier";
      });
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر تحميل ملف الجهة");
    } finally {
      setLoading(false);
    }
  }, [contactId, scopeBranch]);

  const loadSide = useCallback(async () => {
    if (!contactId || !ov) return;
    const sideData = side === "customer" ? ov.customer : ov.supplier;
    if (!sideData || sideData.totals_only) { setDocs([]); setMoney([]); setReturnsRows([]); return; }
    try {
      const [d, m] = await Promise.all([
        fetchContactDocuments(contactId, side, scopeBranch),
        fetchContactMoney(contactId, side, scopeBranch),
      ]);
      setDocs(d); setMoney(m);
      // returns list (both cash and on-account parts), this side, this scope
      const rows = side === "customer"
        ? await fetchAllRows<any>(() => {
            let q: any = supabase.from("returns")
              .select("id, return_number, created_at, invoice_date, branch_id, status, total_refund, refund_cash_amount, refund_transfer_amount, refund_balance_amount, branches(name), invoices!inner(id, invoice_number, contact_id)")
              .eq("invoices.contact_id", contactId);
            if (scopeBranch) q = q.eq("branch_id", scopeBranch);
            return q.order("id");
          })
        : await fetchAllRows<any>(() => {
            let q: any = supabase.from("purchase_returns")
              .select("id, return_number, created_at, invoice_date, branch_id, status, total_amount, refund_cash_amount, refund_transfer_amount, refund_balance_amount, branches(name), shipments(id, shipment_number)")
              .eq("contact_id", contactId);
            if (scopeBranch) q = q.eq("branch_id", scopeBranch);
            return q.order("id");
          });
      setReturnsRows(rows.map((r: any) => ({
        id: r.id, number: r.return_number ?? "—", date: r.invoice_date ?? r.created_at, branch: r.branches?.name ?? "—",
        doc: side === "customer" ? r.invoices?.invoice_number : r.shipments?.shipment_number,
        total: Number(side === "customer" ? r.total_refund : r.total_amount) || 0,
        cash: (Number(r.refund_cash_amount) || 0) + (Number(r.refund_transfer_amount) || 0),
        credit: Number(r.refund_balance_amount) || 0, status: r.status ?? "active", branch_id: r.branch_id,
      })).sort((a: any, b: any) => (a.date < b.date ? 1 : -1)));
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر تحميل الحركات");
    }
  }, [contactId, side, scopeBranch, ov]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { loadSide(); }, [loadSide]);
  useRealtimeRefresh(["invoices", "invoice_payments", "shipments", "supplier_payments", "returns", "purchase_returns", "vouchers", "payment_transactions", "customer_credit_log", "contacts"], loadOverview);

  useEffect(() => {
    if (c) setEdit({ name: c.name ?? "", type: c.type, contact_person: c.contact_person ?? "", phone: c.phone ?? "", address: c.address ?? "", notes: c.notes ?? "" });
  }, [c?.id]);

  const sideData = side === "customer" ? ov?.customer : ov?.supplier;
  // what is on account is company-wide (money is not split by branch)
  const accountAvail = Math.max(0, Number((ovAll ?? ov)?.[side]?.advance) || 0);
  const canUseAccount = isAdmin || hasRole("branch_manager") || hasRole("accountant") || hasRole("cashier");
  const openUseAccount = (r: ContactDocument) => {
    setUseAcc(r);
    setUseAccAmount(String(Math.min(accountAvail, Number(r.remaining) || 0)));
  };
  const submitUseAccount = async () => {
    if (!useAcc || !contactId) return;
    const amt = Number(useAccAmount) || 0;
    if (amt <= 0) return toast.error("اكتب مبلغ أكبر من صفر");
    if (amt > accountAvail + 0.005) return toast.error(`اللي تحت الحساب ${formatEGP(accountAvail)} بس`);
    if (amt > (Number(useAcc.remaining) || 0) + 0.005) return toast.error("المبلغ أكبر من الباقي على الفاتورة");
    setUseAccBusy(true);
    const { error } = await supabase.rpc("settle_from_account" as any, { p_contact_id: contactId, p_side: side, p_doc_id: useAcc.doc_id, p_amount: amt } as any);
    setUseAccBusy(false);
    if (error) {
      const { rpcErrorText } = await import("@/lib/rpcError");
      return toast.error(rpcErrorText(error, "السداد من تحت الحساب"));
    }
    toast.success(`اتخصم ${formatEGP(amt)} من تحت الحساب على ${useAcc.doc_number ?? "الفاتورة"}`);
    setUseAcc(null);
    loadOverview();
  };
  const shownDocs = useMemo(() => docs.filter((d) => d.doc_type !== "movement" && (docFilter === "all" || d.state === docFilter)), [docs, docFilter]);
  const chargeRows = useMemo(() => docs.filter((d) => d.doc_type === "movement"), [docs]);
  const scopeName = scopeBranch ? (c?.branches?.find((b) => b.id === scopeBranch)?.name ?? branches.find((b) => b.id === scopeBranch)?.name ?? "فرع") : "كل الفروع";
  const sideName = side === "customer" ? "حساب العميل" : "حساب المورد";
  const docPath = (d: { doc_type: string; doc_id: string; branch_id: string }) =>
    d.doc_type === "invoice" ? `/branch/${d.branch_id}/sales/${d.doc_id}` : `/branch/${d.branch_id}/shipments/${d.doc_id}`;
  const scopeOptions = useMemo(() => {
    // admins: every branch the contact dealt with; branch staff: their own branches only
    const list = new Map<string, string>();
    if (isAdmin) (c?.branches ?? []).forEach((b) => list.set(b.id, b.name));
    else branches.forEach((b: any) => list.set(b.id, b.name));
    if (routeBranchId && !list.has(routeBranchId)) list.set(routeBranchId, branches.find((b) => b.id === routeBranchId)?.name ?? "الفرع");
    return Array.from(list.entries()).map(([id, name]) => ({ id, name }));
  }, [c?.branches, branches, isAdmin, routeBranchId]);

  const submitEdit = async () => {
    if (!edit.name) return toast.error("الاسم مطلوب");
    const { error } = await saveContact(contactId!, edit);
    if (error) return toast.error(error.message);
    await logAudit({ userId: user!.id, userName: profile?.name ?? "", tenantId, action: "UPDATE", entity: "Contact", entityId: contactId, details: edit });
    toast.success("تم التعديل");
    setEditOpen(false);
    loadOverview();
  };
  const submitArchive = async () => {
    const { error } = await deleteContact(contactId!);
    if (error) return toast.error(error.message);
    toast.success("تمت الأرشفة — المستندات والحركات محفوظة");
    nav(backTo);
  };

  const exportExcel = () => {
    if (!ov || !c) return;
    const summary: any[] = [{ البيان: "الجهة", القيمة: c.name }, { البيان: "النطاق", القيمة: scopeName }];
    for (const [k, d] of [["حساب العميل", ov.customer], ["حساب المورد", ov.supplier]] as const) {
      if (!d) continue;
      summary.push(
        { البيان: `${k} — الرصيد`, القيمة: d.balance },
        { البيان: `${k} — مفتوح`, القيمة: d.open_remaining },
        { البيان: `${k} — مقدم`, القيمة: d.advance },
      );
      if (d.totals_only || !d.documents) continue;
      summary.push(
        { البيان: `${k} — إجمالي الفواتير`, القيمة: d.documents.total },
        { البيان: `${k} — الفلوس`, القيمة: (d.money.collected ?? d.money.paid ?? 0) },
        { البيان: `${k} — المرتجعات`, القيمة: d.returns.total },
      );
    }
    exportToExcel(`ملف_${c.name}_${scopeName}`, [
      { name: "ملخص", rows: summary },
      { name: `مستندات ${sideName}`, rows: docs.filter((d) => d.doc_type !== "movement").map((d) => ({
        الرقم: d.doc_number, التاريخ: formatDate(d.doc_date), الفرع: d.branch_name, الحالة: STATE_LABEL[d.state]?.t ?? d.state,
        الإجمالي: d.total, "مدفوع فلوس": d.paid_money ?? "", "مدفوع بمرتجعات": d.paid_by_returns ?? "", المتبقي: d.remaining ?? "",
      })) },
      { name: `فلوس ${sideName}`, rows: money.map((m) => ({
        التاريخ: formatDate(m.movement_date), النوع: m.kind_label, الفرع: m.branch_name, الطريقة: methodLabel(m.method),
        المبلغ: m.amount, "اتخصم منه": m.allocated, "متبقي مقدم": m.unallocated, المرجع: m.reference ?? "", الحالة: m.status === "active" ? "سارية" : "ملغاة",
      })) },
      { name: `مرتجعات ${sideName}`, rows: returnsRows.map((r) => ({ الرقم: r.number, التاريخ: formatDate(r.date), الفرع: r.branch, المستند: r.doc ?? "", الإجمالي: r.total, "نقدي/تحويل": r.cash, "على الحساب": r.credit, الحالة: r.status })) },
    ]);
  };

  const printFile = () => {
    if (!ov || !c || !sideData) return;
    const rows = shownDocs.map((d) => `<tr><td>${d.doc_number ?? ""}</td><td>${formatDate(d.doc_date)}</td><td>${d.branch_name ?? ""}</td><td>${STATE_LABEL[d.state]?.t ?? d.state}</td><td>${formatEGP(d.total)}</td><td>${d.remaining == null ? "—" : formatEGP(d.remaining)}</td></tr>`).join("");
    printReport(`ملف ${c.name} — ${sideName}`, `
      <h1>${c.name} — ${sideName}</h1>
      <div class="meta">النطاق: ${scopeName}</div>
      <div class="kpi">
        <div><span class="muted">الرصيد</span><b>${formatEGP(Math.abs(sideData.balance))}</b></div>
        <div><span class="muted">مفتوح</span><b>${formatEGP(sideData.open_remaining)}</b></div>
        <div><span class="muted">مقدم</span><b>${formatEGP(sideData.advance)}</b></div>
        <div><span class="muted">${side === "customer" ? "المبيعات" : "المشتريات"}</span><b>${sideData.documents ? formatEGP(sideData.documents.total) : "—"}</b></div>
      </div>
      <table><thead><tr><th>الرقم</th><th>التاريخ</th><th>الفرع</th><th>الحالة</th><th>الإجمالي</th><th>المتبقي</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted">حساب العميل وحساب المورد منفصلين.</p>`);
  };

  const canCollect = hasCustomer && !!ov?.customer;
  const canPay = hasSupplier && !!ov?.supplier && (isAdmin || hasRole("branch_manager") || hasRole("accountant"));
  // never guess a branch: with "all branches" the user picks which branch's till takes the money
  const fixedPayBranch = routeBranchId ?? scopeBranch ?? null;
  const payBranch = fixedPayBranch ?? (pickedBranch || null);
  const startPay = (dir: "in" | "out") => {
    if (fixedPayBranch) { setPayDir(dir); return; }
    setPickedBranch("");
    setPayPick(dir);
  };

  return (
    <Layout>
      <PageHeader
        title={c?.name ?? "ملف الجهة"}
        subtitle={c ? `${c.type === "customer" ? "عميل" : c.type === "supplier" ? "مورد" : "عميل ومورد"}${c.contact_person ? " · " + c.contact_person : ""}` : ""}
        actions={
          <div className="flex flex-wrap gap-2">
            {canCollect && branches.length > 0 && (
              <Button className="btn-gradient" onClick={() => startPay("in")}><HandCoins className="w-4 h-4 ml-1" /> تحصيل من العميل</Button>
            )}
            {canPay && branches.length > 0 && (
              <Button variant="outline" onClick={() => startPay("out")}><DollarSign className="w-4 h-4 ml-1" /> سداد للمورد</Button>
            )}
            <Button variant="outline" onClick={() => nav(`${isAdminView ? `/admin/contacts/${contactId}/statement` : `/branch/${routeBranchId}/contacts/${contactId}/statement`}?side=${side}${scopeBranch ? `&branch=${scopeBranch}` : ""}`)}>
              <Activity className="w-4 h-4 ml-1" /> كشف {sideName}
            </Button>
            <Button variant="outline" onClick={printFile}><FileText className="w-4 h-4 ml-1" /> PDF</Button>
            <Button variant="outline" onClick={exportExcel}><Download className="w-4 h-4 ml-1" /> Excel</Button>
            {isAdmin && <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="w-4 h-4 ml-1" /> تعديل</Button>}
            {isAdmin && <Button variant="outline" className="text-destructive" onClick={() => setArchiveOpen(true)}><Archive className="w-4 h-4 ml-1" /> أرشفة</Button>}
            {isAdmin && c && c.type !== "both" && (
              <Button variant="outline" onClick={async () => {
                const { error } = await saveContact(contactId!, { type: "both" });
                if (error) return toast.error(error.message);
                toast.success(c.type === "supplier" ? "تمت إضافته كعميل أيضاً" : "تمت إضافته كمورد أيضاً");
                loadOverview();
              }}><Receipt className="w-4 h-4 ml-1" /> {c.type === "supplier" ? "أيضاً عميل" : "أيضاً مورد"}</Button>
            )}
            <Button variant="outline" onClick={() => nav(backTo)}><ArrowRight className="w-4 h-4 ml-1" /> رجوع</Button>
          </div>
        }
      />

      {c && (
        <div className="card-elevated p-4 mb-4 grid md:grid-cols-3 gap-3 text-sm">
          <div className="flex items-center gap-2"><User className="w-4 h-4 text-muted-foreground" /> {c.contact_person ?? "—"}</div>
          <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" /> <span dir="ltr">{c.phone ?? "—"}</span></div>
          <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-muted-foreground" /> {c.address ?? "—"}</div>
          {c.notes && <div className="md:col-span-3 text-muted-foreground">📝 {c.notes}</div>}
          {c.is_archived && <div className="md:col-span-3 text-destructive font-semibold">الجهة مؤرشفة</div>}
        </div>
      )}

      {/* scope: company-wide or one branch */}
      <div className="card-elevated p-3 mb-4 flex flex-wrap items-center gap-2">
        <Building2 className="w-4 h-4 text-muted-foreground" />
        {isAdmin && (
          <Button size="sm" variant={scope === "all" ? "default" : "outline"} className="rounded-full" onClick={() => setScope("all")}>كل الفروع</Button>
        )}
        {scopeOptions.map((b) => (
          <Button key={b.id} size="sm" variant={scope === b.id ? "default" : "outline"} className="rounded-full" onClick={() => setScope(b.id)}>{b.name}</Button>
        ))}
        <span className="text-xs text-muted-foreground mr-2">
          {scopeBranch
            ? "فواتير وفلوس الفرع ده بس؛ الفلوس اللي عدّت بين الفروع ظاهرة لوحدها."
            : "كل الفروع = الرصيد الإجمالي للجهة."}
        </span>
      </div>

      {scopeBranch && ovAll && (
        <div className="card-elevated p-3 mb-4 text-sm flex flex-wrap gap-4">
          <span className="font-semibold">الرصيد الإجمالي في كل الفروع:</span>
          {ovAll.customer && hasCustomer && <span>حساب العميل: <b>{formatEGP(Math.abs(ovAll.customer.balance))}</b> {ovAll.customer.balance > 0.005 ? "لنا عليه" : ovAll.customer.balance < -0.005 ? "مقدم منه" : "مسدد"}</span>}
          {ovAll.supplier && hasSupplier && <span>حساب المورد: <b>{formatEGP(Math.abs(ovAll.supplier.balance))}</b> {ovAll.supplier.balance > 0.005 ? "علينا له" : ovAll.supplier.balance < -0.005 ? "مقدم لينا عنده" : "مسدد"}</span>}
        </div>
      )}

      {loading && !ov && <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>}

      {ov && (
        <Tabs value={side} onValueChange={(v) => setSide(v as Side)} className="w-full">
          <TabsList>
            {hasCustomer && ov.customer && <TabsTrigger value="customer">حساب العميل</TabsTrigger>}
            {hasSupplier && ov.supplier && <TabsTrigger value="supplier">حساب المورد</TabsTrigger>}
          </TabsList>
          <p className="text-xs text-muted-foreground mt-2">الحسابين منفصلين تماماً: فلوس العميل ما بتسددش فواتير المورد والعكس.</p>

          {(["customer", "supplier"] as Side[]).map((sd) => {
            const d = sd === "customer" ? ov.customer : ov.supplier;
            if (!d) return null;
            return (
              <TabsContent key={sd} value={sd} className="mt-3 space-y-4">
                <SideSummary side={sd} data={d} />
                {!d.totals_only && d.documents && (<>
                {scopeBranch && (d.paid_from_other_branches > 0.005 || d.used_in_other_branches > 0.005) && (
                  <div className="card-elevated p-3 text-xs flex flex-wrap gap-4 border-primary/30">
                    <span>اتسدد من فلوس فروع تانية على مستندات هنا: <b>{formatEGP(d.paid_from_other_branches)}</b></span>
                    <span>فلوس اتسجلت هنا واتخصمت من مستندات فروع تانية: <b>{formatEGP(d.used_in_other_branches)}</b></span>
                    <span className="text-muted-foreground">(حساب جاري بين الفروع 1910)</span>
                  </div>
                )}
                {d.before_ledger.count > 0 && (
                  <div className="card-elevated p-3 text-xs flex items-center gap-2 bg-muted/40">
                    <AlertTriangle className="w-4 h-4 text-warning" />
                    فيه {d.before_ledger.count} مستند قبل 1 يناير 2026 بإجمالي {formatEGP(d.before_ledger.total)} — دي فترة الأرشيف ومش داخلة في الرصيد؛ رصيدها متمثل في الرصيد الافتتاحي.
                  </div>
                )}

                <Tabs defaultValue="docs">
                  <TabsList className="flex-wrap h-auto">
                    <TabsTrigger value="docs">{sd === "customer" ? "فواتير البيع" : "فواتير الشراء"} ({docs.filter((x) => x.doc_type !== "movement").length})</TabsTrigger>
                    <TabsTrigger value="money">{sd === "customer" ? "المقبوضات" : "المدفوعات"} ({money.length})</TabsTrigger>
                    <TabsTrigger value="returns">{sd === "customer" ? "مرتجعات البيع" : "مرتجعات الشراء"} ({returnsRows.length})</TabsTrigger>
                    <TabsTrigger value="plans">خطط الدفع</TabsTrigger>
                  </TabsList>

                  <TabsContent value="docs" className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {(["all", "open", "closed", "cancelled", "before_ledger"] as DocFilter[]).map((f) => (
                        <Button key={f} size="sm" variant={docFilter === f ? "default" : "outline"} onClick={() => setDocFilter(f)}>
                          {f === "all" ? "الكل" : STATE_LABEL[f].t} ({docs.filter((x) => x.doc_type !== "movement" && (f === "all" || x.state === f)).length})
                        </Button>
                      ))}
                    </div>
                    {accountAvail > 0.005 && docs.some((x) => x.doc_type !== "movement" && x.state === "open") && (
                      <div className="card-elevated p-3 text-sm border-primary/40 bg-primary/5 flex flex-wrap items-center gap-2">
                        <HandCoins className="w-4 h-4 text-primary" />
                        {sd === "customer" ? "العميل له تحت حسابه" : "لينا تحت حسابنا عند المورد"} <b>{formatEGP(accountAvail)}</b>
                        وعليه فواتير مفتوحة. الفلوس دي مش بتتخصم لوحدها — دوس «سدد من تحت حسابه» جنب الفاتورة اللي عاوزها.
                      </div>
                    )}
                    <DataTable
                      rows={shownDocs}
                      empty="لا توجد مستندات"
                      onRowClick={(r: ContactDocument) => nav(docPath(r))}
                      columns={[
                        { key: "n", header: "الرقم", render: (r: ContactDocument) => <span className="font-mono font-semibold">{r.doc_number ?? "—"}</span> },
                        { key: "d", header: "التاريخ", render: (r: ContactDocument) => formatDate(r.doc_date) },
                        { key: "b", header: "الفرع", render: (r: ContactDocument) => r.branch_name ?? "—" },
                        { key: "s", header: "الحالة", render: (r: ContactDocument) => <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATE_LABEL[r.state]?.c ?? ""}`}>{STATE_LABEL[r.state]?.t ?? r.state}</span> },
                        { key: "t", header: "الإجمالي", render: (r: ContactDocument) => <b>{formatEGP(r.total)}</b> },
                        { key: "pm", header: "مدفوع فلوس", render: (r: ContactDocument) => (r.paid_money == null ? "—" : formatEGP(r.paid_money)) },
                        { key: "pr", header: "خصم مرتجعات", render: (r: ContactDocument) => (r.paid_by_returns ? formatEGP(r.paid_by_returns) : "—") },
                        { key: "px", header: "من فرع تاني", render: (r: ContactDocument) => (r.paid_from_other_branches ? formatEGP(r.paid_from_other_branches) : "—") },
                        { key: "rm", header: "المتبقي", render: (r: ContactDocument) => (r.remaining == null ? "—" : <b className={r.remaining > 0.005 ? "text-warning" : "text-success"}>{formatEGP(r.remaining)}</b>) },
                        { key: "acc", header: "", render: (r: ContactDocument) => canUseAccount && accountAvail > 0.005 && r.state === "open" && (Number(r.remaining) || 0) > 0.005 && (r.doc_type === "invoice" || r.doc_type === "shipment")
                            ? <Button size="sm" variant="outline" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); openUseAccount(r); }}>{side === "customer" ? "سدد من تحت حسابه" : "سدد من تحت حسابنا"}</Button>
                            : null },
                      ]}
                    />
                    {chargeRows.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        بنود تانية على الحساب: {chargeRows.map((r) => `${r.doc_number ?? "—"} ${formatEGP(r.total)} (متبقي ${formatEGP(r.remaining ?? 0)})`).join(" · ")}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="money" className="mt-3">
                    <DataTable
                      rows={money}
                      empty="لا توجد حركات فلوس"
                      columns={[
                        { key: "d", header: "التاريخ", render: (m: ContactMoneyRow) => formatDate(m.movement_date) },
                        { key: "k", header: "النوع", render: (m: ContactMoneyRow) => m.kind_label },
                        { key: "b", header: "الفرع", render: (m: ContactMoneyRow) => m.branch_name ?? "—" },
                        { key: "m", header: "الطريقة", render: (m: ContactMoneyRow) => methodLabel(m.method) },
                        { key: "r", header: "المرجع", render: (m: ContactMoneyRow) => <span className="text-xs">{m.reference ?? "—"}{m.target_doc_number ? ` ← ${m.target_doc_number}` : ""}</span> },
                        { key: "a", header: "المبلغ", render: (m: ContactMoneyRow) => <b className={m.status === "active" ? "" : "line-through text-muted-foreground"}>{formatEGP(m.amount)}</b> },
                        { key: "al", header: "اتخصم من فواتير", render: (m: ContactMoneyRow) => formatEGP(m.allocated) },
                        { key: "u", header: "متبقي مقدم", render: (m: ContactMoneyRow) => (m.effect === "settle" && m.unallocated > 0.005 ? <b className="text-primary">{formatEGP(m.unallocated)}</b> : "—") },
                        { key: "x", header: "في فرع تاني", render: (m: ContactMoneyRow) => (m.used_in_other_branches > 0.005 ? formatEGP(m.used_in_other_branches) : "—") },
                        { key: "att", header: "📎", render: (m: ContactMoneyRow) => {
                          const v = moneyVouchers[m.movement_id];
                          return v ? <AttachmentsDialogButton recordType="voucher" recordId={v.id} count={moneyAttCounts[v.id] ?? 0} canEdit={v.status === "active"} /> : "—";
                        } },
                        { key: "st", header: "الحالة", render: (m: ContactMoneyRow) => (m.status === "active" ? <span className="text-success text-xs">سارية</span> : <span className="text-destructive text-xs" title={m.cancel_reason ?? ""}>ملغاة</span>) },
                        { key: "act", header: "", render: (m: ContactMoneyRow) => (m.status === "active" && m.source_table === "payment_transactions" ? (
                          <Button size="sm" variant="ghost" className="text-destructive h-7" onClick={(e) => { e.stopPropagation(); setVoidReason(""); setVoidRow(m); }}>إلغاء</Button>
                        ) : null) },
                      ]}
                    />
                  </TabsContent>

                  <TabsContent value="returns" className="mt-3">
                    <DataTable
                      rows={returnsRows}
                      empty="لا توجد مرتجعات"
                      onRowClick={(r: any) => nav(sd === "customer" ? `/branch/${r.branch_id}/sale-returns/${r.id}` : `/branch/${r.branch_id}/purchase-returns/${r.id}`)}
                      columns={[
                        { key: "n", header: "رقم المرتجع", render: (r: any) => <span className="font-mono">{r.number}</span> },
                        { key: "d", header: "التاريخ", render: (r: any) => formatDate(r.date) },
                        { key: "b", header: "الفرع", render: (r: any) => r.branch },
                        { key: "doc", header: sd === "customer" ? "فاتورة البيع" : "فاتورة الشراء", render: (r: any) => r.doc ?? "—" },
                        { key: "t", header: "الإجمالي", render: (r: any) => <b>{formatEGP(r.total)}</b> },
                        { key: "c", header: sd === "customer" ? "اترد نقدي/تحويل" : "استردينا نقدي/تحويل", render: (r: any) => formatEGP(r.cash) },
                        { key: "cr", header: "على الحساب", render: (r: any) => formatEGP(r.credit) },
                        { key: "s", header: "الحالة", render: (r: any) => (r.status === "cancelled" ? <span className="text-destructive text-xs">ملغي</span> : r.status === "draft" ? <span className="text-xs">مسودة</span> : <span className="text-success text-xs">ساري</span>) },
                      ]}
                    />
                  </TabsContent>

                  <TabsContent value="plans" className="mt-3">
                    {contactId && <PaymentPlansPanel entityType={sd} entityId={contactId} direction={sd === "customer" ? "in" : "out"} />}
                  </TabsContent>
                </Tabs>
                </>)}
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      {payDir && contactId && payBranch && (
        <MultiMethodPaymentDialog
          open={!!payDir}
          onOpenChange={(o) => { if (!o) setPayDir(null); }}
          mode={{ kind: "contact", contactId, branchId: payBranch }}
          defaultAmount={payDir === "in" ? Math.max(ovAll?.customer?.balance ?? ov?.customer?.balance ?? 0, 0) : Math.max(ovAll?.supplier?.balance ?? ov?.supplier?.balance ?? 0, 0)}
          direction={payDir}
          title={payDir === "in" ? `تحصيل من العميل — ${c?.name ?? ""}` : `سداد للمورد — ${c?.name ?? ""}`}
          onSuccess={() => { setPayDir(null); setPickedBranch(""); loadOverview(); }}
        />
      )}

      <Dialog open={!!voidRow} onOpenChange={(o) => { if (!o) setVoidRow(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>إلغاء {voidRow?.kind_label} {voidRow ? formatEGP(voidRow.amount) : ""}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            الحركة مش هتتمسح: هيتسجل عكسها في الخزنة وفي القيود، والفاتورة أو الخطة اللي اتخصمت منها هترجع مفتوحة بنفس المبلغ.
          </p>
          <Textarea placeholder="سبب الإلغاء (5 حروف على الأقل)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          <DialogFooter>
            <Button variant="destructive" disabled={voidBusy || voidReason.trim().length < 5} onClick={async () => {
              if (!voidRow) return;
              setVoidBusy(true);
              const { data, error } = await (supabase as any).rpc("request_void_payment_transaction", { p_tx_id: voidRow.source_id, p_reason: voidReason.trim() });
              setVoidBusy(false);
              if (error) return toast.error(error.message);
              toast.success((data as any)?.status === "voided" ? "اتلغت الحركة" : (data as any)?.status === "already_pending" ? "فيه طلب إلغاء مستني الموافقة بالفعل" : "اتبعت طلب الإلغاء لمدير الفرع");
              setVoidRow(null);
              loadOverview();
            }}>تأكيد الإلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payPick} onOpenChange={(o) => { if (!o) setPayPick(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{payPick === "in" ? "الفلوس هتدخل خزنة أنهي فرع؟" : "الفلوس هتطلع من خزنة أنهي فرع؟"}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">الحركة بتتسجل في الفرع اللي استلم أو دفع الفلوس، وبتتخصم من أقدم مستند مفتوح لنفس الحساب في أي فرع.</p>
          <Select value={pickedBranch} onValueChange={setPickedBranch}>
            <SelectTrigger><SelectValue placeholder="اختار الفرع" /></SelectTrigger>
            <SelectContent>
              {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button disabled={!pickedBranch} onClick={() => { const d = payPick; setPayPick(null); setPayDir(d); }}>متابعة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!useAcc} onOpenChange={(o) => { if (!o) setUseAcc(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{side === "customer" ? "سدد من تحت حسابه" : "سدد من تحت حسابنا عند المورد"} — {useAcc?.doc_number ?? ""}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-surface-2 p-2.5"><div className="text-[11px] text-muted-foreground">الباقي على الفاتورة</div><b className="tabular-nums">{formatEGP(Number(useAcc?.remaining) || 0)}</b></div>
              <div className="rounded-lg bg-primary/10 p-2.5"><div className="text-[11px] text-muted-foreground">{side === "customer" ? "تحت حسابه" : "تحت حسابنا عند المورد"}</div><b className="tabular-nums text-primary">{formatEGP(accountAvail)}</b></div>
            </div>
            <div><Label>المبلغ اللي هيتخصم</Label><Input type="number" min={0} value={useAccAmount} onChange={(e) => setUseAccAmount(e.target.value)} className="mt-1.5" /></div>
            <p className="text-[11px] text-muted-foreground leading-5">مفيش فلوس بتدخل أو تخرج من الخزنة — الفلوس دي اتحصّلت قبل كده، وده بس بيقفل بيها الفاتورة. الفاتورة هتفضل «آجل» وتظهر في عمود «من تحت حسابه».</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUseAcc(null)}>رجوع</Button>
            <Button onClick={submitUseAccount} disabled={useAccBusy}>{useAccBusy ? "..." : "خصم"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>تعديل بيانات الجهة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>النوع *</Label>
              <Select value={edit.type} onValueChange={(v) => setEdit({ ...edit, type: v as any })}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer">عميل</SelectItem>
                  <SelectItem value="supplier">مورد</SelectItem>
                  <SelectItem value="both">عميل ومورد</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>الاسم *</Label><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="mt-1.5" /></div>
            <div><Label>المسؤول</Label><Input value={edit.contact_person} onChange={(e) => setEdit({ ...edit, contact_person: e.target.value })} className="mt-1.5" /></div>
            <div><Label>التليفون</Label><Input dir="ltr" className="text-right mt-1.5" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
            <div><Label>العنوان</Label><Input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} className="mt-1.5" /></div>
            <div><Label>ملاحظات</Label><Textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} className="mt-1.5" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={submitEdit}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>أرشفة {c?.name}؟</AlertDialogTitle>
            <AlertDialogDescription>
              مفيش حذف نهائي: الجهة هتتأرشف وتختفي من القوائم، وكل مستنداتها وحركاتها محفوظة. الأرشفة مش مسموحة لو حساب العميل أو حساب المورد فيه رصيد مفتوح.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={submitArchive} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">أرشفة</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
