import { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { searchMatch } from "@/lib/search";
import { toast } from "sonner";
import { Plus, Users, UserCheck, Truck, UserPlus, TruckIcon, Pencil, Trash2, FileSpreadsheet, Printer, ArrowUpRight, ArrowDownLeft, FileText, Filter, Check, Scale, Receipt, Wallet, ChevronDown, ChevronUp } from "lucide-react";
import { ContactBranchAccordion } from "@/components/ContactBranchAccordion";
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
  type BalanceKey = "owe_us" | "we_owe" | "settled";
  const [balanceFilters, setBalanceFilters] = useState<BalanceKey[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleBalance = (k: BalanceKey) =>
    setBalanceFilters((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]);
  const BALANCE_LABELS: Record<BalanceKey, string> = {
    owe_us: "عملاء وموردين لنا عندهم",
    we_owe: "عملاء وموردين علينا لهم",
    settled: "متعادلين (مصفيين حسابهم)",
  };
  const isManager = hasRole("branch_manager");

  const load = async () => {
    setLoading(true);
    // دليل جهات موحّد: كل جهات الشركة غير المؤرشفة، والرصيد محسوب من تعاملات هذا الفرع فقط
    const [{ data }, balRes] = await Promise.all([
      supabase.from("contacts").select("*").eq("is_archived", false).order("created_at", { ascending: false }),
      supabase.rpc("contact_branch_balances" as any, { p_branch_id: branchId }),
    ]);
    const balMap = new Map<string, { balance: number; overdue: number }>();
    ((balRes.data ?? []) as any[]).forEach((b) => balMap.set(b.contact_id, { balance: Number(b.balance ?? 0), overdue: Number(b.overdue ?? 0) }));
    const list = ((data ?? []) as any[]).map((c) => ({ ...c, balance: balMap.get(c.id)?.balance ?? 0, overdue: balMap.get(c.id)?.overdue ?? 0 }));
    setRows(list);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [branchId]);
  // Realtime: refresh on contact changes AND on any transaction that affects balance (triggers will update contacts row)
  useRealtimeRefresh(["contacts", "invoices", "invoice_payments", "returns", "shipments", "supplier_payments", "purchase_returns", "vouchers"], load);

  const filtered = useMemo(() => {
    let r = rows;
    if (filter !== "all") {
      r = r.filter((x) => x.type === filter || x.type === "both");
    }
    if (balanceFilters.length > 0) {
      r = r.filter((x) => {
        const b = Number(x.balance ?? 0);
        const isOweUs = b > 0.01;
        const isWeOwe = b < -0.01;
        const isSettled = Math.abs(b) < 0.01;
        return (
          (balanceFilters.includes("owe_us") && isOweUs) ||
          (balanceFilters.includes("we_owe") && isWeOwe) ||
          (balanceFilters.includes("settled") && isSettled)
        );
      });
    }
    if (search.trim()) {
      r = r.filter((x) => searchMatch(search, x.name, x.phone, x.contact_person, (x as any).email, (x as any).address, (x as any).notes));
    }
    return r;
  }, [rows, filter, balanceFilters, search]);



  const counts = useMemo(() => ({
    all: rows.length,
    customer: rows.filter((r) => r.type === "customer" || r.type === "both").length,
    supplier: rows.filter((r) => r.type === "supplier" || r.type === "both").length,
    both: rows.filter((r) => r.type === "both").length,
  }), [rows]);

  // Balance totals for filtered list
  const balanceTotals = useMemo(() => {
    let oweUs = 0, weOwe = 0, overdue = 0;
    for (const r of filtered) {
      const b = Number(r.balance ?? 0);
      if (b > 0) oweUs += b; else if (b < 0) weOwe += -b;
      overdue += Number(r.overdue ?? 0);
    }
    return { oweUs, weOwe, net: oweUs - weOwe, overdue };
  }, [filtered]);

  // Excel / PDF export of the current filtered view
  const exportRows = () => filtered.map((r) => {
    const b = Number(r.balance ?? 0);
    return {
      "الاسم": r.name,
      "النوع": TYPE_LABELS[(r.type ?? "customer") as ContactType],
      "التليفون": r.phone ?? "",
      "الإيميل": r.email ?? "",
      "العنوان": r.address ?? "",
      "الرصيد": b,
      "الحالة": b > 0.01 ? "مستحق لنا" : b < -0.01 ? "علينا للجهة" : "متعادل",
    };
  });
  const filterSuffix = balanceFilters.length === 1
    ? (balanceFilters[0] === "owe_us" ? "_لنا" : balanceFilters[0] === "we_owe" ? "_علينا" : "_متعادلين")
    : "";
  const handleExportExcel = () => {
    const data = exportRows();
    if (!data.length) return toast.error("لا توجد بيانات للتصدير");
    exportToExcel("العملاء_والموردين" + filterSuffix, [{ name: "الأرصدة", rows: data }]);
  };
  const handleExportPDF = () => {
    const data = exportRows();
    if (!data.length) return toast.error("لا توجد بيانات للتصدير");
    const title = "أرصدة العملاء والموردين" + (filterSuffix ? ` (${BALANCE_LABELS[balanceFilters[0]]})` : "");
    const summary = `
      <div class="kpi">
        <div><span class="muted">مستحق لنا</span><b class="pos">${formatEGP(balanceTotals.oweUs)}</b></div>
        <div><span class="muted">علينا</span><b class="neg">${formatEGP(balanceTotals.weOwe)}</b></div>
        <div><span class="muted">الصافي</span><b class="${balanceTotals.net >= 0 ? "pos" : "neg"}">${formatEGP(balanceTotals.net)}</b></div>
      </div>`;
    const head = `<tr>${Object.keys(data[0]).map(k => `<th>${k}</th>`).join("")}</tr>`;
    const body = data.map(r => `<tr>${Object.values(r).map((v, i) => {
      if (i === 4) { // الرصيد column — color it
        const num = Number(v as any);
        const cls = num > 0 ? "pos" : num < 0 ? "neg" : "";
        return `<td class="${cls}"><b>${formatEGP(Math.abs(num))}</b></td>`;
      }
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
        const { error } = await supabase.from("contacts").update(payload).eq("id", editing.id);
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
    const { error } = await supabase.from("contacts").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("تمت الإضافة");
    setOpen(false);
    setForm({ name: "", type: "customer", contact_person: "", phone: "", email: "", address: "", notes: "" });
    load();
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    if (isAdmin) {
      const { error } = await supabase.from("contacts").delete().eq("id", deleteTarget.id);
      if (error) return toast.error(error.message);
      toast.success("تم الحذف");
    } else if (isManager) {
      if (!reqReason.trim()) return toast.error("اكتب سبب الحذف");
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

  const goToProfile = (r: any) => {
    nav(`/branch/${branchId}/contacts/${r.id}`);
  };

  const promoteToBoth = async (r: any, asWhat: "customer" | "supplier") => {
    if (r.type === "both") return;
    // لو حاليًا عميل وعايز نضيفه كمورد، أو العكس → النوع يصبح both
    const { error } = await supabase.from("contacts").update({ type: "both" } as any).eq("id", r.id);
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
            <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!filtered.length} className="gap-2">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!filtered.length} className="gap-2">
              <Printer className="w-4 h-4" /> PDF
            </Button>
            <Button className="btn-gradient" onClick={openNew}>
              <Plus className="w-4 h-4 ml-1" /> إضافة جهة
            </Button>
          </div>
        }
      />

      <div className="mb-4 text-base sm:text-lg font-semibold text-foreground/90">
        {counts.both > 0
          ? <>إجمالي <span className="text-primary">{counts.all}</span> جهة • <span className="text-primary">{counts.customer - counts.both}</span> عميل • <span className="text-primary">{counts.supplier - counts.both}</span> مورد • <span className="text-primary">{counts.both}</span> عميل ومورد</>
          : <>إجمالي <span className="text-primary">{counts.all}</span> جهة • <span className="text-primary">{counts.customer}</span> عميل • <span className="text-primary">{counts.supplier}</span> مورد</>
        }
      </div>


      {/* Balance KPIs — أرصدة هذا الفرع فقط، وتتبع الفلاتر الحالية */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <MetricCardWithHint
          label="مستحق لنا من العملاء"
          value={balanceTotals.oweUs}
          tone="success"
          icon={<ArrowDownLeft />}
          hint="طريقة الحساب: إجمالي مبيعات الفرع الآجلة غير المسددة لعملاء الفرع. لا يتضمن الفواتير المسددة نقداً أو عبر أرصدة تحت الحساب."
        />
        <MetricCardWithHint
          label="مستحق لموردي الفرع"
          value={balanceTotals.weOwe}
          tone="destructive"
          icon={<ArrowUpRight />}
          hint="طريقة الحساب: فواتير بضاعة ومشتريات هذا الفرع المستلمة ناقصاً المسدد عنها بسندات صرف. يعبر حصراً عن دين البضاعة الفعلي للفرع ولا يدمج الأرصدة العامة أو التسويات المعلقة."
        />
        <MetricCardWithHint
          label="مديونيات متأخرة السداد"
          value={balanceTotals.overdue}
          tone="warning"
          icon={<Clock />}
          hint="طريقة الحساب: مجموع مبالغ الأقساط والفواتير المستحقة على عملاء الفرع التي فات موعد سدادها المحدد بتوقيت القاهرة ولم تُحصّل حتى الآن."
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
              {(["owe_us", "we_owe", "settled"] as const).map((k) => (
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
          <Input
            placeholder="بحث بالاسم أو التليفون..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>
      </div>

      <DataTable
        loading={loading}
        rows={filtered}
        pageSize={50}
        indexColumn
        onRowClick={goToProfile}
        getRowKey={(r: any) => r.id}
        isRowExpanded={(r: any) => expandedId === r.id}
        renderExpandedRow={(r: any) => (
          tenantId && branchId ? (
            <ContactBranchAccordion
              contactId={r.id}
              contactName={r.name}
              contactType={r.type}
              tenantId={tenantId}
              receivingBranchId={branchId}
              expanded
              canSettle={isAdmin || isManager || hasRole("cashier") || hasRole("accountant")}
              onSettled={load}
            />
          ) : null
        )}
        columns={[
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
            key: "balance",
            header: "الرصيد",
            render: (r: any) => {
              const b = Number(r.balance ?? 0);
              if (Math.abs(b) < 0.01) return <span className="text-muted-foreground">—</span>;
              return b > 0
                ? <span className="text-success font-bold">{formatEGP(b)} <span className="text-xs">(لنا)</span></span>
                : <span className="text-destructive font-bold">{formatEGP(Math.abs(b))} <span className="text-xs">(علينا)</span></span>;
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
                    <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" title={isAdmin ? "حذف" : "طلب حذف"} onClick={() => { setDeleteTarget(r); setReqReason(""); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              );
            },
          },
        ]}
      />

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
            <AlertDialogTitle>{isManager && !isAdmin ? "طلب حذف للموافقة" : "حذف الجهة"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isManager && !isAdmin ? (
                <>سيتم إرسال طلب حذف <b>{deleteTarget?.name}</b> لمدير الشركة للموافقة.</>
              ) : (
                <>هل أنت متأكد من حذف <b>{deleteTarget?.name}</b>؟ لن يمكن التراجع.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {isManager && !isAdmin && (
            <div className="px-1">
              <Label>سبب الحذف *</Label>
              <Textarea className="mt-1.5" value={reqReason} onChange={(e) => setReqReason(e.target.value)} placeholder="اكتب سبب طلب الحذف..." />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={onDelete}>
              {isManager && !isAdmin ? "إرسال طلب الحذف" : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BranchLayout>
  );
}
