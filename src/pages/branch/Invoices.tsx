import { useCallback, useEffect, useMemo, useState } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { Link, useParams, useSearchParams, useNavigate } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PermGate } from "@/components/ProtectedRoute";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDate, formatDateTime } from "@/lib/format";
import { Plus, ShoppingCart, PackagePlus, RotateCcw, Undo2, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, FileText, ClipboardList, FileSpreadsheet, Printer, Search, X, Eye, Trash2 } from "lucide-react";
import { exportToExcel, printReport } from "@/lib/export";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

type TabKey = "sale" | "purchase" | "sale_return" | "purchase_return" | "income" | "expense" | "transfer" | "quote" | "adjustment";

const TABS: { key: TabKey; label: string; icon: any; color: string }[] = [
  { key: "sale", label: "فواتير البيع", icon: ShoppingCart, color: "text-success" },
  { key: "purchase", label: "فواتير الشراء", icon: PackagePlus, color: "text-primary" },
  { key: "sale_return", label: "مرتجع بيع", icon: RotateCcw, color: "text-warning" },
  { key: "purchase_return", label: "مرتجع شراء", icon: Undo2, color: "text-warning" },
  { key: "income", label: "سندات القبض", icon: ArrowDownCircle, color: "text-success" },
  { key: "expense", label: "سندات الصرف", icon: ArrowUpCircle, color: "text-destructive" },
  { key: "transfer", label: "تحويل المخازن", icon: ArrowLeftRight, color: "text-primary" },
  { key: "quote", label: "عروض الأسعار", icon: FileText, color: "text-secondary" },
  { key: "adjustment", label: "تسوية المخزن", icon: ClipboardList, color: "text-muted-foreground" },
];

// Which filters apply to each tab
const FILTERS: Record<TabKey, { search?: boolean; date?: boolean; status?: boolean; amount?: boolean; payment?: boolean; category?: boolean; transferBranch?: boolean }> = {
  sale:            { search: true, date: true, status: true,  amount: true,  payment: true },
  purchase:        { search: true, date: true,                 amount: true },
  sale_return:     { search: true, date: true,                 amount: true },
  purchase_return: { search: true, date: true, status: true,  amount: true },
  income:          { search: true, date: true,                 amount: true, payment: true, category: true },
  expense:         { search: true, date: true,                 amount: true, payment: true, category: true },
  transfer:        {              date: true, status: true,                                            transferBranch: true },
  quote:           { search: true, date: true, status: true,  amount: true },
  adjustment:      { search: true, date: true },
};

type Filters = {
  q: string;
  from: string;
  to: string;
  status: string;
  amountMin: string;
  amountMax: string;
  payment: string;
  categoryId: string;
  fromBranch: string;
  toBranch: string;
};
const EMPTY_FILTERS: Filters = { q: "", from: "", to: "", status: "", amountMin: "", amountMax: "", payment: "", categoryId: "", fromBranch: "", toBranch: "" };

export default function Invoices() {
  const { id: branchId } = useParams<{ id: string }>();
  const { branches, isAdmin, hasRole } = useAuth();
  const [delTarget, setDelTarget] = useState<any>(null);
  const [delBusy, setDelBusy] = useState(false);
  const canDeleteInvoice = isAdmin || hasRole("branch_manager");

  const handleDeleteInvoice = async () => {
    if (!delTarget) return;
    setDelBusy(true);
    const { error } = await supabase.rpc("hard_delete_invoice" as any, { _invoice_id: delTarget.id });
    setDelBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`تم حذف الفاتورة ${delTarget.invoice_number} نهائياً`);
    setDelTarget(null);
    load();
  };
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const tab = (params.get("tab") as TabKey) || "sale";
  const setTab = (k: string) => {
    const next = new URLSearchParams();
    next.set("tab", k);
    setParams(next);
    setFilters(EMPTY_FILTERS);
  };

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);

  const active = FILTERS[tab];

  // Load voucher categories when needed
  useEffect(() => {
    if (!active.category) return;
    (async () => {
      const r = await supabase
        .from("voucher_categories" as any)
        .select("id, name, type")
        .eq("type", tab === "income" ? "receipt" : "payment")
        .order("name");
      setCategories((r.data as any) ?? []);
    })();
  }, [tab, active.category]);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    let data: any[] = [];
    if (tab === "sale") {
      const r = await supabase.from("invoices").select("*, customers(name)").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(500);
      data = r.data ?? [];
    } else if (tab === "purchase") {
      const r = await supabase.from("shipments").select("*, suppliers(company_name)").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(500);
      data = r.data ?? [];
    } else if (tab === "sale_return") {
      const r = await supabase.from("returns").select("*, invoices(invoice_number)").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(500);
      data = r.data ?? [];
    } else if (tab === "purchase_return") {
      const r = await supabase.from("purchase_returns" as any).select("*, suppliers(company_name)").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(500);
      data = r.data ?? [];
    } else if (tab === "income") {
      const r = await supabase.from("vouchers" as any).select("*, voucher_categories(name)").eq("branch_id", branchId).eq("type", "receipt").eq("status", "active").order("voucher_date", { ascending: false }).limit(500);
      data = (r.data ?? []).map((v: any) => ({
        ...v,
        created_at: v.voucher_date ?? v.created_at,
        category: v.voucher_categories?.name ?? "—",
        description: v.description ?? v.voucher_number,
      }));
    } else if (tab === "expense") {
      const r = await supabase.from("vouchers" as any).select("*, voucher_categories(name)").eq("branch_id", branchId).eq("type", "payment").eq("status", "active").order("voucher_date", { ascending: false }).limit(500);
      data = (r.data ?? []).map((v: any) => ({
        ...v,
        created_at: v.voucher_date ?? v.created_at,
        category: v.voucher_categories?.name ?? "—",
        description: v.description ?? v.voucher_number,
      }));
    } else if (tab === "transfer") {
      const r = await supabase.from("stock_transfers").select("*").or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`).order("created_at", { ascending: false }).limit(500);
      data = r.data ?? [];
    } else if (tab === "quote") {
      const r = await supabase.from("quotes" as any).select("*, customers(name)").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(500);
      data = r.data ?? [];
    } else if (tab === "adjustment") {
      const r = await supabase.from("stock_adjustments" as any).select("*").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(500);
      data = r.data ?? [];
    }
    setRows(data);
    setLoading(false);
  }, [tab, branchId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["invoices", "shipments", "returns", "purchase_returns", "vouchers", "stock_transfers", "quotes", "stock_adjustments"], load);


  const branchName = (bid?: string) => branches.find((b) => b.id === bid)?.name ?? bid ?? "—";

  // Apply filters client-side
  const filteredRows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const fromTs = filters.from ? new Date(filters.from + "T00:00:00").getTime() : null;
    const toTs = filters.to ? new Date(filters.to + "T23:59:59").getTime() : null;
    const min = filters.amountMin ? Number(filters.amountMin) : null;
    const max = filters.amountMax ? Number(filters.amountMax) : null;

    const searchableText = (r: any): string => {
      switch (tab) {
        case "sale": return [r.invoice_number, r.customers?.name].filter(Boolean).join(" ").toLowerCase();
        case "purchase": return [r.suppliers?.company_name, r.received_by, r.shipment_number].filter(Boolean).join(" ").toLowerCase();
        case "sale_return": return [r.invoices?.invoice_number, r.reason].filter(Boolean).join(" ").toLowerCase();
        case "purchase_return": return [r.return_number, r.suppliers?.company_name, r.reason].filter(Boolean).join(" ").toLowerCase();
        case "income":
        case "expense": return [r.voucher_number, r.description, r.category, r.party_name].filter(Boolean).join(" ").toLowerCase();
        case "quote": return [r.quote_number, r.customers?.name, r.customer_name].filter(Boolean).join(" ").toLowerCase();
        case "adjustment": return [r.adjustment_number, r.reason, r.notes].filter(Boolean).join(" ").toLowerCase();
        default: return "";
      }
    };

    const getAmount = (r: any): number | null => {
      switch (tab) {
        case "sale": case "quote": return Number(r.total ?? 0);
        case "purchase": return Number(r.total_cost ?? 0);
        case "sale_return": return Number(r.total_refund ?? 0);
        case "purchase_return": return Number(r.total_amount ?? 0);
        case "income": case "expense": return Number(r.amount ?? 0);
        default: return null;
      }
    };

    const getDate = (r: any): number => {
      const d = r.arrival_date ?? r.created_at;
      return d ? new Date(d).getTime() : 0;
    };

    return rows.filter((r) => {
      if (q && active.search && !searchableText(r).includes(q)) return false;
      if ((fromTs || toTs) && active.date) {
        const d = getDate(r);
        if (fromTs && d < fromTs) return false;
        if (toTs && d > toTs) return false;
      }
      if (filters.status && active.status && r.status !== filters.status) return false;
      if (active.amount && (min !== null || max !== null)) {
        const a = getAmount(r) ?? 0;
        if (min !== null && a < min) return false;
        if (max !== null && a > max) return false;
      }
      if (filters.payment && active.payment && r.payment_method !== filters.payment) return false;
      if (filters.categoryId && active.category && r.category_id !== filters.categoryId) return false;
      if (active.transferBranch) {
        if (filters.fromBranch && r.from_branch_id !== filters.fromBranch) return false;
        if (filters.toBranch && r.to_branch_id !== filters.toBranch) return false;
      }
      return true;
    });
  }, [rows, filters, tab, active]);

  const cfg = useMemo(() => {
    const base = `/branch/${branchId}`;
    switch (tab) {
      case "sale": return {
        newLink: `${base}/sales/new`, newLabel: "فاتورة بيع جديدة", newPerm: "sales.create",
        columns: [
          { key: "invoice_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary">{r.invoice_number}</span> },
          { key: "customer", header: "العميل", render: (r: any) => r.customers?.name ?? "نقدي" },
          { key: "total", header: "المبلغ", render: (r: any) => formatEGP(r.total) },
          { key: "status", header: "الحالة", render: (r: any) => r.status === "active" ? "نشطة" : "ملغاة" },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ],
        onClick: (r: any) => nav(`${base}/sales/${r.id}`),
      };
      case "purchase": return {
        newLink: `${base}/shipments/new`, newLabel: "شحنة شراء جديدة", newPerm: "shipments.create",
        columns: [
          { key: "supplier", header: "المورد", render: (r: any) => r.suppliers?.company_name ?? "—" },
          { key: "received_by", header: "استلم بواسطة" },
          { key: "arrival_date", header: "تاريخ الوصول", render: (r: any) => formatDate(r.arrival_date) },
          { key: "total_cost", header: "الإجمالي", render: (r: any) => formatEGP(r.total_cost) },
        ],
        onClick: (r: any) => nav(`${base}/shipments/${r.id}`),
      };
      case "sale_return": return {
        newLink: `${base}/sales/returns/new`, newLabel: "مرتجع بيع جديد", newPerm: "sales.create",
        columns: [
          { key: "inv", header: "رقم الفاتورة", render: (r: any) => r.invoices?.invoice_number ?? "—" },
          { key: "reason", header: "السبب" },
          { key: "total_refund", header: "المرتجع", render: (r: any) => formatEGP(r.total_refund) },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ],
      };
      case "purchase_return": return {
        newLink: `${base}/purchase-returns/new`, newLabel: "مرتجع شراء جديد", newPerm: "shipments.create",
        columns: [
          { key: "return_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary">{r.return_number}</span> },
          { key: "supplier", header: "المورد", render: (r: any) => r.suppliers?.company_name ?? "—" },
          { key: "reason", header: "السبب" },
          { key: "total_amount", header: "الإجمالي", render: (r: any) => formatEGP(r.total_amount) },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ],
      };
      case "income":
      case "expense": return {
        newLink: `${base}/treasury`, newLabel: tab === "income" ? "سند قبض جديد" : "سند صرف جديد", newPerm: tab === "income" ? "receipt_vouchers.create" : "payment_vouchers.create",
        columns: [
          { key: "description", header: "البيان" },
          { key: "amount", header: "المبلغ", render: (r: any) => formatEGP(r.amount) },
          { key: "category", header: "التصنيف" },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ],
      };
      case "transfer": return {
        newLink: `${base}/transfers`, newLabel: "تحويل مخازن جديد", newPerm: "transfers.create",
        columns: [
          { key: "from_branch_id", header: "من", render: (r: any) => branchName(r.from_branch_id) },
          { key: "to_branch_id", header: "إلى", render: (r: any) => branchName(r.to_branch_id) },
          { key: "status", header: "الحالة" },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ],
      };
      case "quote": return {
        newLink: `${base}/quotes/new`, newLabel: "عرض سعر جديد", newPerm: "sales.create",
        columns: [
          { key: "quote_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary">{r.quote_number}</span> },
          { key: "customer", header: "العميل", render: (r: any) => r.customers?.name ?? r.customer_name ?? "—" },
          { key: "total", header: "الإجمالي", render: (r: any) => formatEGP(r.total) },
          { key: "valid_until", header: "صالح حتى", render: (r: any) => r.valid_until ? formatDate(r.valid_until) : "—" },
          { key: "status", header: "الحالة" },
        ],
      };
      case "adjustment": return {
        newLink: `${base}/adjustments/new`, newLabel: "تسوية مخزن جديدة", newPerm: "inventory.update",
        columns: [
          { key: "adjustment_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary">{r.adjustment_number}</span> },
          { key: "reason", header: "السبب" },
          { key: "notes", header: "ملاحظات" },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ],
      };
    }
  }, [tab, branchId, nav, branches]);

  const currentTabLabel = TABS.find((t) => t.key === tab)?.label ?? "";

  const handleExportExcel = () => {
    const exportRows = filteredRows.map((r) => {
      const out: any = {};
      for (const c of cfg.columns as any[]) {
        let v: any;
        try { v = c.render ? c.render(r) : r[c.key]; } catch { v = r[c.key]; }
        if (v && typeof v === "object") v = r[c.key] ?? "";
        out[c.header] = v ?? "";
      }
      return out;
    });
    exportToExcel(currentTabLabel, [{ name: currentTabLabel, rows: exportRows }]);
  };

  const handleExportPDF = () => {
    const cols = cfg.columns as any[];
    const head = `<tr>${cols.map((c) => `<th>${c.header}</th>`).join("")}</tr>`;
    const body = filteredRows.map((r) => `<tr>${cols.map((c) => {
      let v: any;
      try { v = c.render ? c.render(r) : r[c.key]; } catch { v = r[c.key]; }
      if (v && typeof v === "object") v = r[c.key] ?? "";
      return `<td>${v ?? ""}</td>`;
    }).join("")}</tr>`).join("");
    printReport(currentTabLabel, `<table><thead>${head}</thead><tbody>${body}</tbody></table>`);
  };

  // Status options per tab
  const statusOptions: { value: string; label: string }[] = useMemo(() => {
    switch (tab) {
      case "sale": return [{ value: "active", label: "نشطة" }, { value: "cancelled", label: "ملغاة" }];
      case "purchase_return": return [{ value: "active", label: "نشط" }, { value: "cancelled", label: "ملغي" }];
      case "transfer": return [{ value: "pending", label: "قيد التنفيذ" }, { value: "completed", label: "مكتمل" }, { value: "cancelled", label: "ملغي" }];
      case "quote": return [{ value: "draft", label: "مسودة" }, { value: "sent", label: "مُرسل" }, { value: "accepted", label: "مقبول" }, { value: "rejected", label: "مرفوض" }];
      default: return [];
    }
  }, [tab]);

  const paymentOptions = [
    { value: "cash", label: "نقدي" },
    { value: "transfer", label: "تحويل بنكي" },
    { value: "card", label: "فيزا" },
    { value: "wallet", label: "محفظة" },
    { value: "instapay", label: "انستا باي" },
  ];

  const hasAnyFilter =
    filters.q || filters.from || filters.to || filters.status ||
    filters.amountMin || filters.amountMax || filters.payment ||
    filters.categoryId || filters.fromBranch || filters.toBranch;

  return (
    <BranchLayout>
      <PageHeader
        title="الفواتير والمستندات"
        subtitle="كل فواتير ومستندات الفرع في مكان واحد"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!filteredRows.length} className="gap-2">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!filteredRows.length} className="gap-2">
              <Printer className="w-4 h-4" /> PDF
            </Button>
            <PermGate perm={(cfg as any).newPerm ?? ""}>
              <Button asChild className="gap-2">
                <Link to={cfg.newLink}><Plus className="w-4 h-4" /> {cfg.newLabel}</Link>
              </Button>
            </PermGate>

          </div>
        }
      />

      {/* Quick action grid */}
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2 mb-5">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
              tab === t.key ? "border-primary bg-primary/5 shadow-md" : "border-border hover:border-primary/50"
            }`}>
            <t.icon className={`w-5 h-5 ${t.color}`} />
            <span className="text-[11px] font-semibold text-center leading-tight">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Filters bar */}
      <div className="bg-card border rounded-lg p-3 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Search className="w-4 h-4 text-muted-foreground" />
            <span>فلاتر {currentTabLabel}</span>
            <span className="text-xs text-muted-foreground font-normal">
              ({filteredRows.length} من {rows.length})
            </span>
          </div>
          {hasAnyFilter && (
            <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)} className="gap-1 h-7">
              <X className="w-3 h-3" /> مسح الفلاتر
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {active.search && (
            <div className="space-y-1 lg:col-span-2">
              <Label className="text-xs">بحث (رقم / اسم / بيان)</Label>
              <Input
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                placeholder="رقم الفاتورة، اسم العميل، المورد..."
                className="h-9"
              />
            </div>
          )}
          {active.date && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">من تاريخ</Label>
                <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">إلى تاريخ</Label>
                <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="h-9" />
              </div>
            </>
          )}
          {active.status && statusOptions.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">الحالة</Label>
              <Select value={filters.status || "__all__"} onValueChange={(v) => setFilters({ ...filters, status: v === "__all__" ? "" : v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">الكل</SelectItem>
                  {statusOptions.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {active.amount && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">المبلغ من</Label>
                <Input type="number" min="0" value={filters.amountMin} onChange={(e) => setFilters({ ...filters, amountMin: e.target.value })} className="h-9" placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">المبلغ إلى</Label>
                <Input type="number" min="0" value={filters.amountMax} onChange={(e) => setFilters({ ...filters, amountMax: e.target.value })} className="h-9" placeholder="—" />
              </div>
            </>
          )}
          {active.payment && (
            <div className="space-y-1">
              <Label className="text-xs">طريقة الدفع</Label>
              <Select value={filters.payment || "__all__"} onValueChange={(v) => setFilters({ ...filters, payment: v === "__all__" ? "" : v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">الكل</SelectItem>
                  {paymentOptions.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {active.category && (
            <div className="space-y-1">
              <Label className="text-xs">التصنيف</Label>
              <Select value={filters.categoryId || "__all__"} onValueChange={(v) => setFilters({ ...filters, categoryId: v === "__all__" ? "" : v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">الكل</SelectItem>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {active.transferBranch && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">من فرع</Label>
                <Select value={filters.fromBranch || "__all__"} onValueChange={(v) => setFilters({ ...filters, fromBranch: v === "__all__" ? "" : v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="الكل" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">الكل</SelectItem>
                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">إلى فرع</Label>
                <Select value={filters.toBranch || "__all__"} onValueChange={(v) => setFilters({ ...filters, toBranch: v === "__all__" ? "" : v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="الكل" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">الكل</SelectItem>
                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
      </div>

      <DataTable
        loading={loading}
        rows={filteredRows}
        onRowClick={cfg.onClick}
        empty="لا توجد سجلات"
        columns={cfg.columns as any}
      />
    </BranchLayout>
  );
}
