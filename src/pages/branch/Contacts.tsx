import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PermPart } from "@/contexts/PermCustomize";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Users, UserCheck, Truck, UserPlus, TruckIcon, Pencil, Trash2, FileSpreadsheet, Printer, ArrowUpRight, ArrowDownLeft, FileText, Filter, Check, Scale, Receipt, Wallet, ChevronDown, ChevronUp } from "lucide-react";
import { ContactDetailsDrawer } from "@/components/ContactDetailsDrawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useAuth } from "@/contexts/AuthContext";
import { createApprovalRequest } from "@/lib/approvalRequests";
import { exportToExcel, printReport } from "@/lib/export";
import { MetricCardWithHint } from "@/components/MetricCardWithHint";
import { Clock } from "lucide-react";
import { confirmAlert } from "@/components/ConfirmDialog";
import { VoucherDialog } from "@/components/VoucherDialog";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { saveContact, deleteContact } from "@/lib/contactWrites";
import { fetchContactsPage, type BalanceFilter, type ContactPageTotals } from "@/lib/ledger";
import { Search, Layers } from "lucide-react";
import { openDocs, OPEN_DOCS_MAX } from "@/lib/openDocs";
import { printStatements } from "@/lib/bulkPrint";

type ContactType = "customer" | "supplier" | "both";

const TYPE_LABELS: Record<ContactType, string> = {
  customer: "عميل",
  supplier: "مورد",
  both: "عميل ومورد",
};

export default function Contacts() {
  const { id: branchId } = useParams<{ id: string }>();
  const { tenantId, user, profile, isAdmin, hasRole } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const filter = (sp.get("tab") ?? "all") as "all" | ContactType;

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [reqReason, setReqReason] = useState("");
  const [form, setForm] = useState({
    name: "",
    type: "customer" as ContactType,
    contact_person: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
  });
  const [search, setSearch] = useState("");
  const [voucherCtx, setVoucherCtx] = useState<{ type: "receipt" | "payment"; contact: any } | null>(null);
  type BalanceKey = BalanceFilter;
  const [balanceFilters, setBalanceFilters] = useState<BalanceKey[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleBalance = (k: BalanceKey) =>
    setBalanceFilters((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);
  const BALANCE_LABELS: Record<BalanceKey, string> = {
    owe_us: "عملاء عليهم فلوس لنا",
    customer_advance: "عملاء ليهم مقدم عندنا",
    we_owe: "موردين لهم فلوس علينا",
    supplier_advance: "موردين لينا عندهم مقدم",
    overdue: "عليهم أقساط متأخرة",
    settled: "حساباتهم مسددة",
  };
  const isManager = hasRole("branch_manager");

  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ all: 0, customer: 0, supplier: 0, both: 0 });
  const [totals, setTotals] = useState<ContactPageTotals | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(0); }, [debouncedSearch, filter, balanceFilters, branchId]);

  // All filtering, search and paging run in the database (contacts_page RPC, unified ledger) — no 1,000-row cap.
  // Balances are this branch's documents and money; customer and supplier sides are separate (no netting).
  const fetchPage = (limit: number, offset: number) => fetchContactsPage({
    branchId: branchId!, type: filter, query: debouncedSearch || null, balance: balanceFilters, limit, offset,
  });
  const reqRef = useRef(0);
  const load = async () => {
    if (!branchId) return;
    const id = ++reqRef.current;
    setLoading(true);
    try {
      const res = await fetchPage(PAGE_SIZE, page * PAGE_SIZE);
      if (id !== reqRef.current) return;
      setRows(res.rows);
      setTotal(res.total);
      setCounts({ all: 0, customer: 0, supplier: 0, both: 0, ...res.counts });
      setTotals(res.totals);
    } catch (e: any) {
      if (id === reqRef.current) toast.error(e.message ?? "تعذر تحميل الجهات");
    } finally {
      if (id === reqRef.current) setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [branchId, page, debouncedSearch, filter, balanceFilters]);

  // Realtime: refresh on contact changes AND on any transaction that affects balance (triggers will update contacts row)
  useRealtimeRefresh(["contacts", "invoices", "invoice_payments", "returns", "shipments", "supplier_payments", "purchase_returns", "vouchers", "payment_transactions", "customer_credit_log"], load);

  const filtered = rows;

  // Selection (owner request 2026-10-16): open as tabs, print statements, export — kept across pages
  const [selected, setSelected] = useState<Map<string, any>>(new Map());
  useEffect(() => { setSelected(new Map()); }, [debouncedSearch, filter, balanceFilters, branchId]);
  const toggleSel = (r: any) => setSelected((prev) => { const n = new Map(prev); if (n.has(r.id)) n.delete(r.id); else n.set(r.id, r); return n; });
  /** What we are owed and what we owe, from the two separate accounts (never netted against each other). */
  const owes = (r: any) => {
    const c = Number(r.customer_balance ?? 0), su = Number(r.supplier_balance ?? 0);
    return {
      us: { fromCustomer: Math.max(c, 0), supplierAdvance: Math.max(-su, 0) },
      them: { toSupplier: Math.max(su, 0), customerAdvance: Math.max(-c, 0) },
    };
  };
  const selRows = Array.from(selected.values());
  const exportSelected = () => exportToExcel("جهات-محددة", [{
    name: "الجهات",
    rows: selRows.map((r, i) => {
      const o = owes(r);
      return {
        "#": i + 1, "الاسم": r.name, "النوع": TYPE_LABELS[r.type as ContactType] ?? r.type, "التليفون": r.phone ?? "", "العنوان": r.address ?? "",
        "لينا عنده": o.us.fromCustomer + o.us.supplierAdvance, "علينا له": o.them.toSupplier + o.them.customerAdvance,
        "حساب العميل": sideText("c", Number(r.customer_balance ?? 0)) + " " + Math.abs(Number(r.customer_balance ?? 0)),
        "حساب المورد": sideText("s", Number(r.supplier_balance ?? 0)) + " " + Math.abs(Number(r.supplier_balance ?? 0)),
      };
    }),
  }]);


  // Excel / PDF export of the current filtered view
  const sideText = (side: "c" | "s", v: number) => Math.abs(v) <= 0.005 ? "مسدد"
    : side === "c" ? (v > 0 ? "لنا عليه" : "مقدم منه") : (v > 0 ? "علينا له" : "مقدم لينا عنده");
  const exportRows = async () => {
    const all: any[] = [];
    for (let off = 0; ; off += 1000) {
      const p = await fetchPage(1000, off);
      all.push(...p.rows);
      if (p.rows.length < 1000) break;
    }
    // a side is exported when the contact has that role OR still carries a balance on it (a contact whose
    // type changed keeps its old side's balance — it must never disappear from the export)
    const hasSide = (r: any, sd: "c" | "s") => {
      const role = sd === "c" ? r.type !== "supplier" : r.type !== "customer";
      const bal = Number(sd === "c" ? r.customer_balance : r.supplier_balance) || 0;
      return role || Math.abs(bal) > 0.005;
    };
    return all.map((r: any) => ({
      "الاسم": r.name,
      "النوع": TYPE_LABELS[(r.type ?? "customer") as ContactType],
      "التليفون": r.phone ?? "",
      "الإيميل": r.email ?? "",
      "العنوان": r.address ?? "",
      "حساب العميل (الفرع)": hasSide(r, "c") ? Number(r.customer_balance ?? 0) : "",
      "حالة حساب العميل": hasSide(r, "c") ? sideText("c", Number(r.customer_balance ?? 0)) : "",
      "فواتير بيع مفتوحة": hasSide(r, "c") ? Number(r.customer_open ?? 0) : "",
      "مقدم العميل": hasSide(r, "c") ? Number(r.customer_advance ?? 0) : "",
      "حساب المورد (الفرع)": hasSide(r, "s") ? Number(r.supplier_balance ?? 0) : "",
      "حالة حساب المورد": hasSide(r, "s") ? sideText("s", Number(r.supplier_balance ?? 0)) : "",
      "فواتير شراء مفتوحة": hasSide(r, "s") ? Number(r.supplier_open ?? 0) : "",
      "مقدمنا عند المورد": hasSide(r, "s") ? Number(r.supplier_advance ?? 0) : "",
    }));
  };
  const filterSuffix = balanceFilters.length === 1 ? `_${balanceFilters[0]}` : "";
  const handleExportExcel = async () => {
    const data = await exportRows();
    if (!data.length) return toast.error("لا توجد بيانات للتصدير");
    exportToExcel("العملاء_والموردين" + filterSuffix, [{ name: "الأرصدة", rows: data }]);
  };
  const handleExportPDF = async () => {
    const data = await exportRows();
    if (!data.length) return toast.error("لا توجد بيانات للتصدير");
    const title = "أرصدة العملاء والموردين" + (filterSuffix ? ` (${BALANCE_LABELS[balanceFilters[0]]})` : "");
    const summary = `
      <div class="kpi">
        <div><span class="muted">مستحق لنا على العملاء</span><b class="pos">${formatEGP(totals?.customers_open ?? 0)}</b></div>
        <div><span class="muted">مقدمات عملاء عندنا</span><b>${formatEGP(totals?.customer_advances ?? 0)}</b></div>
        <div><span class="muted">مستحق للموردين علينا</span><b class="neg">${formatEGP(totals?.suppliers_open ?? 0)}</b></div>
        <div><span class="muted">مقدمات لينا عند الموردين</span><b>${formatEGP(totals?.supplier_advances ?? 0)}</b></div>
      </div>
      <div class="meta">حساب العميل وحساب المورد منفصلين.</div>`;
    const head = `<tr>${Object.keys(data[0]).map(k => `<th>${k}</th>`).join("")}</tr>`;
    const body = data.map(r => `<tr>${Object.entries(r).map(([k, v]) => {
      if (k.startsWith("حساب ") && v !== "") return `<td><b>${formatEGP(Math.abs(Number(v as any)))}</b></td>`;
      return `<td>${v ?? ""}</td>`;
    }).join("")}</tr>`).join("");
    printReport(title, `${summary}<table><thead>${head}</thead><tbody>${body}</tbody></table>`);
  };

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", type: "customer", contact_person: "", phone: "", email: "", address: "", notes: "" });
    setOpen(true);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      name: r.name ?? "",
      type: (r.type ?? "customer") as ContactType,
      contact_person: r.contact_person ?? "",
      phone: r.phone ?? "",
      email: r.email ?? "",
      address: r.address ?? "",
      notes: r.notes ?? "",
    });
    setReqReason("");
    setOpen(true);
  };

  // تحذير لو نفس رقم التليفون موجود قبل كده (مسموح بالتأكيد فقط)
  const phoneDuplicateOk = async () => {
    const phone = (form.phone || "").trim();
    if (!phone) return true;
    let q = supabase.from("contacts").select("id,name,type").eq("phone", phone).limit(3);
    if (editing) q = q.neq("id", editing.id);
    const { data } = await q;
    if (!data?.length) return true;
    return confirmAlert({
      title: "الرقم ده مستخدم قبل كده 📞",
      description: `فيه ${data.length === 1 ? "" : data.length + " "}${data.length === 1 ? "حساب" : "حسابات"} بنفس التليفون: ${data
        .map((c: any) => `${c.name} (${c.type === "supplier" ? "مورد" : "عميل"})`)
        .join("، ")}. تحب تكمّل الحفظ برضه؟`,
      confirmLabel: "أيوه، كمّل",
      cancelLabel: "لأ، هعدّله",
      tone: "warning",
    });
  };

  const submit = async () => {
    if (!form.name) return toast.error("الاسم مطلوب");
    if (!(await phoneDuplicateOk())) return;


    // EDIT
    if (editing) {
      const payload: any = {
        name: form.name,
        contact_person: form.contact_person || null,
        phone: form.phone || null,
        email: form.email ? form.email.trim().toLowerCase() : null,
        address: form.address || null,
        notes: form.notes || null,
      };
      if (isAdmin) {
        const { error } = await saveContact(editing.id, payload);
        if (error) return toast.error(error.message);
        toast.success("تم التحديث");
      } else if (isManager) {
        if (!reqReason.trim()) return toast.error("اكتب سبب التعديل");
        const ok = await createApprovalRequest({
          tenantId: tenantId!, branchId: branchId ?? null,
          entityType: "contact", entityId: editing.id, entityLabel: editing.name,
          action: "update", payload, reason: reqReason,
          requestedBy: user!.id, requestedByName: profile?.name ?? "—",
        });
        if (!ok) return;
      } else {
        return toast.error("غير مصرح");
      }
      setOpen(false);
      setEditing(null);
      load();
      return;
    }

    // NEW
    const payload: any = {
      name: form.name,
      type: form.type,
      contact_person: form.contact_person || null,
      phone: form.phone || null,
      email: form.email ? form.email.trim().toLowerCase() : null,
      address: form.address || null,
      notes: form.notes || null,
      branch_id: form.type === "supplier" ? null : branchId,
    };
    const { error } = await saveContact(null, payload);
    if (error) return toast.error(error.message);
    toast.success("تمت الإضافة");
    setOpen(false);
    setForm({ name: "", type: "customer", contact_person: "", phone: "", email: "", address: "", notes: "" });
    load();
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    if (isAdmin) {
      const { error } = await deleteContact(deleteTarget.id);
      if (error) return toast.error(error.message);
      toast.success("تمت الأرشفة — المستندات والحركات محفوظة");
    } else if (isManager) {
      if (!reqReason.trim()) return toast.error("اكتب سبب الأرشفة");
      const ok = await createApprovalRequest({
        tenantId: tenantId!, branchId: branchId ?? null,
        entityType: "contact", entityId: deleteTarget.id, entityLabel: deleteTarget.name,
        action: "delete", reason: reqReason,
        requestedBy: user!.id, requestedByName: profile?.name ?? "—",
      });
      if (!ok) return;
    } else {
      return toast.error("غير مصرح");
    }
    setDeleteTarget(null);
    setReqReason("");
    load();
  };

  const drawerContact = useMemo(() => rows.find((r) => r.id === expandedId) ?? null, [rows, expandedId]);

  const promoteToBoth = async (r: any, asWhat: "customer" | "supplier") => {
    if (r.type === "both") return;
    // لو حاليًا عميل وعايز نضيفه كمورد، أو العكس → النوع يصبح both
    const { error } = await saveContact(r.id, { type: "both" });
    if (error) return toast.error(error.message);
    toast.success(asWhat === "supplier" ? "تمت إضافته كمورد أيضاً" : "تمت إضافته كعميل أيضاً");
    load();
  };

  return (
    <BranchLayout>
      <PageHeader
        title="الموردين والعملاء"
        actions={
          <div className="flex flex-wrap gap-2">
            <PermPart page="customers" part="export_buttons"><div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!total} className="gap-2">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!total} className="gap-2">
              <Printer className="w-4 h-4" /> PDF
            </Button>
            </div></PermPart>
            <PermPart page="customers" part="add_button"><Button className="btn-gradient" onClick={openNew}>
              <Plus className="w-4 h-4 ml-1" /> إضافة جهة
            </Button></PermPart>
          </div>
        }
      />

      <PermPart page="customers" part="counts_line"><div className="mb-4 text-base sm:text-lg font-semibold text-foreground/90">
        {counts.both > 0
          ? <>إجمالي <span className="text-primary">{counts.all}</span> جهة • <span className="text-primary">{counts.customer - counts.both}</span> عميل • <span className="text-primary">{counts.supplier - counts.both}</span> مورد • <span className="text-primary">{counts.both}</span> عميل ومورد</>
          : <>إجمالي <span className="text-primary">{counts.all}</span> جهة • <span className="text-primary">{counts.customer}</span> عميل • <span className="text-primary">{counts.supplier}</span> مورد</>
        }
      </div></PermPart>


      {/* Balance KPIs — هذا الفرع فقط (فواتيره وفلوسه)، العملاء والموردين كل جانب لوحده */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <MetricCardWithHint
          label="مستحق لنا على العملاء"
          active={balanceFilters.length === 1 && balanceFilters[0] === "owe_us"}
          onClick={() => setBalanceFilters((p) => (p.length === 1 && p[0] === "owe_us" ? [] : ["owe_us"]))}
          value={totals?.customers_open ?? 0}
          tone="success"
          icon={<ArrowDownLeft />}
          metricHint={{ meaning: "المتبقي على فواتير بيع الفرع المفتوحة بعد كل التحصيلات ورصيد المرتجعات (بما فيها فلوس اتدفعت في فرع تاني على فواتير هنا).", source: "الدفتر الموحد (contacts_page): فواتير البيع ناقص التوزيعات عليها.", formula: "Σ (إجمالي الفاتورة − الموزع عليها) لفواتير الفرع المفتوحة" }}
        />
        <MetricCardWithHint
          label="مقدمات عملاء عندنا"
          active={balanceFilters.length === 1 && balanceFilters[0] === "customer_advance"}
          onClick={() => setBalanceFilters((p) => (p.length === 1 && p[0] === "customer_advance" ? [] : ["customer_advance"]))}
          value={totals?.customer_advances ?? 0}
          tone="primary"
          icon={<Wallet />}
          metricHint={{ meaning: "فلوس عملاء اتسجلت في الفرع ده ولسه ما اتخصمتش من أي فاتورة (حساب 2150).", source: "الدفتر الموحد: حركات العملاء في الفرع اللي لسه ليها رصيد.", formula: "Σ (مبلغ الحركة − الموزع منها)" }}
        />
        <MetricCardWithHint
          label="مستحق للموردين علينا"
          active={balanceFilters.length === 1 && balanceFilters[0] === "we_owe"}
          onClick={() => setBalanceFilters((p) => (p.length === 1 && p[0] === "we_owe" ? [] : ["we_owe"]))}
          value={totals?.suppliers_open ?? 0}
          tone="destructive"
          icon={<ArrowUpRight />}
          metricHint={{ meaning: "المتبقي على فواتير شراء الفرع المفتوحة بعد المدفوعات ورصيد مرتجعات الشراء.", source: "الدفتر الموحد: فواتير الشراء ناقص التوزيعات عليها.", formula: "Σ (إجمالي فاتورة الشراء − الموزع عليها)" }}
        />
        <MetricCardWithHint
          label="مقدمات لينا عند الموردين"
          active={balanceFilters.length === 1 && balanceFilters[0] === "supplier_advance"}
          onClick={() => setBalanceFilters((p) => (p.length === 1 && p[0] === "supplier_advance" ? [] : ["supplier_advance"]))}
          value={totals?.supplier_advances ?? 0}
          tone="primary"
          icon={<Wallet />}
          metricHint={{ meaning: "فلوس دفعها الفرع للموردين ولسه ما اتخصمتش من فواتير شراء (حساب 1460).", source: "الدفتر الموحد: حركات الموردين في الفرع اللي لسه ليها رصيد.", formula: "Σ (مبلغ الحركة − الموزع منها)" }}
        />
        <MetricCardWithHint
          label="أقساط متأخرة (عملاء / موردين)"
          active={balanceFilters.length === 1 && balanceFilters[0] === "overdue"}
          onClick={() => setBalanceFilters((p) => (p.length === 1 && p[0] === "overdue" ? [] : ["overdue"]))}
          value={(totals?.customer_overdue ?? 0)}
          tone="warning"
          icon={<Clock />}
          metricHint={{ meaning: `أقساط عملاء الفرع اللي ميعادها عدى ولسه مفتوحة. أقساط الموردين المتأخرة: ${formatEGP(totals?.supplier_overdue ?? 0)}.`, source: "خطط وأقساط الفرع، محدودة بالمتبقي الفعلي في الدفتر (القسط على فاتورة اتسددت مش بيتحسب متأخر).", formula: "Σ (قيمة القسط − المدفوع منه) لأقساط مستحقة قبل النهارده بتوقيت القاهرة" }}
        />
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-center justify-between">
        <Tabs value={filter} onValueChange={(v) => setSp({ tab: v })}>
          <TabsList>
            <TabsTrigger value="all" className="gap-1.5">
              <Users className="w-3.5 h-3.5" /> الكل <Badge variant="secondary" className="ml-1">{counts.all}</Badge>
            </TabsTrigger>
            <TabsTrigger value="customer" className="gap-1.5">
              <UserCheck className="w-3.5 h-3.5" /> عملاء <Badge variant="secondary" className="ml-1">{counts.customer}</Badge>
            </TabsTrigger>
            <TabsTrigger value="supplier" className="gap-1.5">
              <Truck className="w-3.5 h-3.5" /> موردين <Badge variant="secondary" className="ml-1">{counts.supplier}</Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-2 min-w-[200px] justify-between">
                <span className="flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5" />
                  {balanceFilters.length === 0
                    ? "كل العملاء والموردين"
                    : `${balanceFilters.length} تصنيف محدد`}
                </span>
                {balanceFilters.length > 0 && (
                  <Badge variant="secondary" className="h-5">{balanceFilters.length}</Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="end">
              <div className="text-xs text-muted-foreground px-2 pb-2 border-b mb-1">
                اختر تصنيف أو أكثر
              </div>
              {(["owe_us", "customer_advance", "we_owe", "supplier_advance", "overdue", "settled"] as const).map((k) => (
                <label
                  key={k}
                  className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-accent cursor-pointer text-sm"
                >
                  <Checkbox
                    checked={balanceFilters.includes(k)}
                    onCheckedChange={() => toggleBalance(k)}
                  />
                  <span className="flex-1">{BALANCE_LABELS[k]}</span>
                </label>
              ))}
              {balanceFilters.length > 0 && (
                <button
                  onClick={() => setBalanceFilters([])}
                  className="w-full mt-1 pt-2 border-t text-xs text-muted-foreground hover:text-foreground"
                >
                  مسح الاختيارات
                </button>
              )}
            </PopoverContent>
          </Popover>
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="الاسم، التليفون، المسؤول، العنوان، الملاحظات..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 pr-9 bg-background"
            />
          </div>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <Button size="sm" variant="ghost" className="h-7" onClick={() => setSelected((prev) => { const n = new Map(prev); filtered.forEach((r: any) => n.set(r.id, r)); return n; })}>تحديد كل الصفحة</Button>
        {selRows.length > 0 && (
          <div className="sticky top-2 z-10 flex flex-wrap items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 shadow-sm">
            <span className="font-bold">محدد {selRows.length} جهة</span>
            <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => {
              const list = selRows.slice(0, OPEN_DOCS_MAX).map((r) => ({ path: `/branch/${branchId}/contacts/${r.id}`, label: r.name }));
              openDocs(list);
              if (selRows.length > OPEN_DOCS_MAX) toast.info(`اتفتح أول ${OPEN_DOCS_MAX} بس — أقصى عدد تابات`);
              if (list[0]) nav(list[0].path);
            }}><Layers className="h-3.5 w-3.5" />فتح الكل</Button>
            <Button size="sm" variant="outline" className="h-7 gap-1" onClick={async () => {
              try { await printStatements(selRows.map((r) => ({ id: r.id, name: r.name, type: r.type })), branchId ?? null, null); }
              catch (e: any) { toast.error(e?.message ?? "تعذر الطباعة"); }
            }}><Printer className="h-3.5 w-3.5" />طباعة كشوف الحساب</Button>
            <Button size="sm" variant="outline" className="h-7 gap-1" onClick={exportSelected}><FileSpreadsheet className="h-3.5 w-3.5" />تصدير المحدد</Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setSelected(new Map())}>إلغاء التحديد</Button>
          </div>
        )}
      </div>
      <DataTable
        loading={loading}
        rows={filtered}
        pageSize={PAGE_SIZE}
        indexColumn={{ offset: page * PAGE_SIZE }}
        onRowClick={(r: any) => setExpandedId(r.id)}
        getRowKey={(r: any) => r.id}
        columns={[
          {
            key: "__sel", header: "✓", align: "center", className: "w-[40px]",
            render: (r: any) => (
              <input type="checkbox" className="h-4 w-4 accent-primary cursor-pointer" checked={selected.has(r.id)}
                     onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(r)} aria-label={`تحديد ${r.name}`} />
            ),
          },
          {
            key: "name",
            header: "الاسم",
            render: (r: any) => {
              const open = expandedId === r.id;
              return (
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={open ? `إغلاق تفاصيل ${r.name}` : `عرض تفاصيل ${r.name}`}
                    className="mt-0.5 rounded-md p-1 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                    onClick={(e) => { e.stopPropagation(); setExpandedId(open ? null : r.id); }}
                  >
                    {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  <div>
                    <div className="font-semibold">{r.name}</div>
                    {r.contact_person && <div className="text-xs text-muted-foreground">{r.contact_person}</div>}
                  </div>
                </div>
              );
            },
          },
          {
            key: "type",
            header: "النوع",
            render: (r: any) => {
              const t = r.type as ContactType;
              const variant = t === "customer" ? "default" : t === "supplier" ? "secondary" : "outline";
              return <Badge variant={variant as any}>{TYPE_LABELS[t]}</Badge>;
            },
          },
          { key: "phone", header: "التليفون", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
          { key: "email", header: "الإيميل", render: (r: any) => <span dir="ltr" className="text-xs">{r.email ?? "—"}</span> },
          { key: "address", header: "العنوان", render: (r: any) => r.address ?? "—" },
          {
            key: "notes",
            header: "الملاحظات",
            render: (r: any) => (
              <div className="flex items-start gap-1 max-w-[16rem]" onClick={(e) => e.stopPropagation()}>
                <span className="text-xs whitespace-pre-wrap break-words line-clamp-3" title={r.notes ?? ""}>{r.notes || "—"}</span>
                <button type="button" aria-label={`تعديل ملاحظات ${r.name}`} className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => openEdit(r)}>
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            ),
          },
          {
            key: "customer_balance",
            header: "حساب العميل",
            render: (r: any) => {
              if (r.type === "supplier") return <span className="text-muted-foreground">—</span>;
              const b = Number(r.customer_balance ?? 0), all = Number(r.customer_balance_all ?? 0);
              const main = Math.abs(b) <= 0.005 ? <span className="text-muted-foreground">مسدد</span>
                : b > 0 ? <span className="text-success font-bold">{formatEGP(b)} <span className="text-xs">(لنا عليه)</span></span>
                : <span className="text-primary font-bold">{formatEGP(-b)} <span className="text-xs">(مقدم منه)</span></span>;
              return <div>{main}{Math.abs(all - b) > 0.005 && <div className="text-[11px] text-muted-foreground">كل الفروع: {formatEGP(Math.abs(all))} {all > 0 ? "لنا" : all < 0 ? "مقدم" : ""}</div>}</div>;
            },
          },
          {
            key: "supplier_balance",
            header: "حساب المورد",
            render: (r: any) => {
              if (r.type === "customer") return <span className="text-muted-foreground">—</span>;
              const b = Number(r.supplier_balance ?? 0), all = Number(r.supplier_balance_all ?? 0);
              const main = Math.abs(b) <= 0.005 ? <span className="text-muted-foreground">مسدد</span>
                : b > 0 ? <span className="text-destructive font-bold">{formatEGP(b)} <span className="text-xs">(علينا له)</span></span>
                : <span className="text-primary font-bold">{formatEGP(-b)} <span className="text-xs">(مقدم لينا)</span></span>;
              return <div>{main}{Math.abs(all - b) > 0.005 && <div className="text-[11px] text-muted-foreground">كل الفروع: {formatEGP(Math.abs(all))} {all > 0 ? "علينا" : all < 0 ? "مقدم" : ""}</div>}</div>;
            },
          },
          {
            key: "__owed_us",
            header: "لينا عنده",
            render: (r: any) => {
              const o = owes(r).us; const t = o.fromCustomer + o.supplierAdvance;
              if (t <= 0.005) return <span className="text-muted-foreground">—</span>;
              return (
                <div className="tabular-nums">
                  <span className="font-bold text-success">{formatEGP(t)}</span>
                  {o.fromCustomer > 0.005 && o.supplierAdvance > 0.005 && (
                    <div className="text-[11px] text-muted-foreground">عليه كعميل {formatEGP(o.fromCustomer)} • مقدم عنده كمورد {formatEGP(o.supplierAdvance)}</div>
                  )}
                  {o.fromCustomer <= 0.005 && <div className="text-[11px] text-muted-foreground">مقدم دفعناه له</div>}
                </div>
              );
            },
          },
          {
            key: "__we_owe",
            header: "علينا له",
            render: (r: any) => {
              const o = owes(r).them; const t = o.toSupplier + o.customerAdvance;
              if (t <= 0.005) return <span className="text-muted-foreground">—</span>;
              return (
                <div className="tabular-nums">
                  <span className="font-bold text-destructive">{formatEGP(t)}</span>
                  {o.toSupplier > 0.005 && o.customerAdvance > 0.005 && (
                    <div className="text-[11px] text-muted-foreground">له كمورد {formatEGP(o.toSupplier)} • مقدم منه كعميل {formatEGP(o.customerAdvance)}</div>
                  )}
                  {o.toSupplier <= 0.005 && <div className="text-[11px] text-muted-foreground">مقدم دفعه لنا</div>}
                </div>
              );
            },
          },
          {
            key: "actions",
            header: "إجراءات",
            width: "16rem",
            className: "min-w-[16rem]",
            render: (r: any) => {
              const t = r.type as ContactType;
              return (
                <div className="flex min-w-max items-center justify-center gap-1.5 px-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="outline" title="كشف حساب" onClick={() => nav(`/branch/${branchId}/contacts/${r.id}/statement`)}>
                    <FileText className="w-3.5 h-3.5" />
                  </Button>
                  {/* سند قبض: يظهر للعميل وللجهة المشتركة ويفتح النافذة ببيانات الجهة الحالية */}
                  {(r.type === "customer" || r.type === "both") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-success/50 bg-success/10 text-success hover:bg-success/20 hover:text-success"
                      title="سند قبض"
                      aria-label={`إنشاء سند قبض لـ ${r.name}`}
                      data-voucher-action="receipt"
                      onClick={() => setVoucherCtx({ type: "receipt", contact: r })}
                    >
                      <Receipt className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  )}
                  {/* سند صرف: يظهر للمورد وللجهة المشتركة ويفتح النافذة ببيانات الجهة الحالية */}
                  {(r.type === "supplier" || r.type === "both") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
                      title="سند صرف"
                      aria-label={`إنشاء سند صرف لـ ${r.name}`}
                      data-voucher-action="payment"
                      onClick={() => setVoucherCtx({ type: "payment", contact: r })}
                    >
                      <Wallet className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  )}
                  {t === "customer" && (
                    <Button size="sm" variant="outline" title="إضافة كمورد أيضاً" onClick={() => promoteToBoth(r, "supplier")}>
                      <TruckIcon className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {t === "supplier" && (
                    <Button size="sm" variant="outline" title="إضافة كعميل أيضاً" onClick={() => promoteToBoth(r, "customer")}>
                      <UserPlus className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {(isAdmin || isManager) && (
                    <Button size="sm" variant="outline" title={isAdmin ? "تعديل" : "طلب تعديل"} onClick={() => openEdit(r)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {(isAdmin || isManager) && (
                    <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" title={isAdmin ? "أرشفة" : "طلب أرشفة"} onClick={() => { setDeleteTarget(r); setReqReason(""); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              );
            },
          },
        ]}
      />
      {total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground tabular-nums">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} من {total}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>السابق</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage((p) => p + 1)}>التالي</Button>
          </div>
        </div>
      )}

      {voucherCtx && branchId && (
        <VoucherDialog
          open
          onOpenChange={(o) => { if (!o) setVoucherCtx(null); }}
          branchId={branchId}
          type={voucherCtx.type}
          initialParty={{
            type: voucherCtx.contact.type === "both"
              ? (voucherCtx.type === "payment" ? "supplier" : "customer")
              : (voucherCtx.contact.type === "supplier" ? "supplier" : "customer"),
            id: voucherCtx.contact.id,
            name: voucherCtx.contact.name,
          }}
          onSuccess={() => { setVoucherCtx(null); load(); }}
        />
      )}

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? (isAdmin ? "تعديل جهة" : "طلب تعديل جهة") : "إضافة جهة جديدة"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {!editing && (
              <div>
                <Label>النوع *</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as ContactType })}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">عميل</SelectItem>
                    <SelectItem value="supplier">مورد</SelectItem>
                    <SelectItem value="both">عميل ومورد</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>الاسم *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>المسؤول</Label>
              <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>التليفون</Label>
              <Input dir="ltr" className="text-right mt-1.5" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <Label>الإيميل <span className="text-xs text-muted-foreground">(اختياري — لإرسال الفواتير وكشف الحساب)</span></Label>
              <Input type="email" dir="ltr" className="text-right mt-1.5" placeholder="name@example.com"
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>العنوان</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>ملاحظات</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1.5" />
            </div>
            {editing && isManager && !isAdmin && (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                <Label>سبب التعديل (للموافقة) *</Label>
                <Textarea value={reqReason} onChange={(e) => setReqReason(e.target.value)} className="mt-1.5" placeholder="سيُرسل لمدير الشركة للموافقة" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={submit}>{editing ? (isAdmin ? "حفظ" : "إرسال طلب التعديل") : "إضافة"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setReqReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isManager && !isAdmin ? "طلب أرشفة للموافقة" : "أرشفة الجهة"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isManager && !isAdmin ? (
                <>سيتم إرسال طلب أرشفة <b>{deleteTarget?.name}</b> لمدير الشركة للموافقة.</>
              ) : (
                <>هتتأرشف <b>{deleteTarget?.name}</b> وتختفي من القوائم — مفيش حذف نهائي، ومستنداتها وحركاتها محفوظة. مش مسموح لو عليها أو ليها رصيد مفتوح.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {isManager && !isAdmin && (
            <div className="px-1">
              <Label>سبب الأرشفة *</Label>
              <Textarea className="mt-1.5" value={reqReason} onChange={(e) => setReqReason(e.target.value)} placeholder="اكتب سبب طلب الأرشفة..." />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={onDelete}>
              {isManager && !isAdmin ? "إرسال طلب الأرشفة" : "أرشفة"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {tenantId && branchId && (
        <ContactDetailsDrawer
          contact={drawerContact}
          tenantId={tenantId}
          branchId={branchId}
          canSettle={isAdmin || isManager || hasRole("cashier") || hasRole("accountant")}
          onClose={() => setExpandedId(null)}
          onSettled={load}
        />
      )}
    </BranchLayout>
  );
}
