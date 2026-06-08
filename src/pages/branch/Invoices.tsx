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
import { Plus, ShoppingCart, PackagePlus, RotateCcw, Undo2, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, FileText, ClipboardList, FileSpreadsheet, Printer, Search, X, Eye, Trash2, Calendar as CalendarIcon, Check, ChevronsUpDown } from "lucide-react";
import { exportToExcel, printReport } from "@/lib/export";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

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
  { key: "adjustment", label: "تسوية المخزون", icon: ClipboardList, color: "text-muted-foreground" },
];

// Which filters apply to each tab
const FILTERS: Record<TabKey, { search?: boolean; date?: boolean; status?: boolean; amount?: boolean; payment?: boolean; category?: boolean; transferBranch?: boolean; party?: "customer" | "supplier" }> = {
  sale:            { search: true, date: true, status: true,  amount: true,  payment: true },
  purchase:        { search: true, date: true,                 amount: true },
  sale_return:     { search: true, date: true,                 amount: true, party: "customer" },
  purchase_return: { search: true, date: true, status: true,  amount: true, party: "supplier" },
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
  partyId: string;
};
const EMPTY_FILTERS: Filters = { q: "", from: "", to: "", status: "", amountMin: "", amountMax: "", payment: "", categoryId: "", fromBranch: "", toBranch: "", partyId: "" };

export default function Invoices() {
  const { id: branchId } = useParams<{ id: string }>();
  const { branches, isAdmin, hasRole, tenantId, user, profile } = useAuth();
  const isManager = hasRole("branch_manager");
  const [delTarget, setDelTarget] = useState<any>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delReason, setDelReason] = useState("");
  const canDeleteInvoice = isAdmin || isManager;

  const handleDeleteInvoice = async () => {
    if (!delTarget) return;
    setDelBusy(true);
    if (isAdmin) {
      const { error } = await supabase.rpc("hard_delete_invoice" as any, { _invoice_id: delTarget.id });
      setDelBusy(false);
      if (error) return toast.error(error.message);
      toast.success(`تم حذف الفاتورة ${delTarget.invoice_number} نهائياً`);
    } else if (isManager) {
      if (!delReason.trim()) { setDelBusy(false); return toast.error("اكتب سبب الحذف"); }
      const ok = await (await import("@/lib/approvalRequests")).createApprovalRequest({
        tenantId: tenantId!, branchId: branchId ?? null,
        entityType: "invoice", entityId: delTarget.id, entityLabel: `فاتورة ${delTarget.invoice_number}`,
        action: "delete", reason: delReason,
        requestedBy: user!.id, requestedByName: profile?.name ?? "—",
      });
      setDelBusy(false);
      if (!ok) return;
    } else { setDelBusy(false); return; }
    setDelTarget(null); setDelReason(""); load();
  };

  // Shipment delete (purchase tab)
  const [delShipment, setDelShipment] = useState<any>(null);
  const [delShipReason, setDelShipReason] = useState("");
  const [delShipBusy, setDelShipBusy] = useState(false);
  const handleDeleteShipment = async () => {
    if (!delShipment) return;
    setDelShipBusy(true);
    const label = `شحنة ${delShipment.shipment_number ?? ""} - ${delShipment.contacts?.name ?? ""}`;
    if (isAdmin) {
      const { error } = await supabase.from("shipments").delete().eq("id", delShipment.id);
      setDelShipBusy(false);
      if (error) return toast.error(error.message);
      toast.success(`تم حذف ${label}`);
    } else if (isManager) {
      if (!delShipReason.trim()) { setDelShipBusy(false); return toast.error("اكتب سبب الحذف"); }
      const ok = await (await import("@/lib/approvalRequests")).createApprovalRequest({
        tenantId: tenantId!, branchId: branchId ?? null,
        entityType: "shipment", entityId: delShipment.id, entityLabel: label,
        action: "delete", reason: delShipReason,
        requestedBy: user!.id, requestedByName: profile?.name ?? "—",
      });
      setDelShipBusy(false);
      if (!ok) return;
    } else { setDelShipBusy(false); return toast.error("غير مصرح"); }
    setDelShipment(null); setDelShipReason(""); load();
  };

  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const tab = (params.get("tab") as TabKey) || "sale";
  const setTab = (k: string) => {
    const next = new URLSearchParams();
    next.set("tab", k);
    setParams(next);
    setFilters(EMPTY_FILTERS);
    setDraftFilters(EMPTY_FILTERS);
  };

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [parties, setParties] = useState<{ id: string; name: string; phone?: string }[]>([]);
  const [partyOpen, setPartyOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const active = FILTERS[tab];
  const isReturnTab = tab === "sale_return" || tab === "purchase_return";

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

  // Load parties (customers / suppliers) for return tabs
  const loadParties = useCallback(async () => {
    if (!active.party || !branchId) { setParties([]); return; }
    if (active.party === "customer") {
      const { data } = await supabase.from("contacts").select("id, name, phone").eq("branch_id", branchId).order("name");
      setParties((data ?? []) as any);
    } else {
      const { data } = await supabase.from("contacts").select("id, name, phone").order("name");
      setParties((data ?? []).map((d: any) => ({ id: d.id, name: d.name, phone: d.phone })));
    }
  }, [active.party, branchId]);
  useEffect(() => { loadParties(); }, [loadParties]);
  useRealtimeRefresh(["contacts"], loadParties);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    let data: any[] = [];
    if (tab === "sale") {
      const r = await supabase.from("invoices").select("*, contacts:contact_id(name)").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(500);
      data = r.data ?? [];
    } else if (tab === "purchase") {
      const r = await supabase.from("shipments").select("*, contacts:contact_id(name)").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(500);
      data = r.data ?? [];
    } else if (tab === "sale_return") {
      const r = await supabase.from("returns").select("*, invoices(invoice_number, contact_id, contacts:contact_id(name, phone))").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(500);
      data = r.data ?? [];
    } else if (tab === "purchase_return") {
      const r = await supabase.from("purchase_returns" as any).select("*, contacts:contact_id(name, phone)").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(500);
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
      const r = await supabase.from("quotes" as any).select("*, contacts:contact_id(name)").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(500);
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
        case "sale": return [r.invoice_number, r.contacts?.name].filter(Boolean).join(" ").toLowerCase();
        case "purchase": return [r.contacts?.name, r.received_by, r.shipment_number].filter(Boolean).join(" ").toLowerCase();
        case "sale_return": return [r.invoices?.invoice_number, r.invoices?.contacts?.name, r.invoices?.contacts?.phone, r.reason].filter(Boolean).join(" ").toLowerCase();
        case "purchase_return": return [r.return_number, r.contacts?.name, r.contacts?.phone, r.reason].filter(Boolean).join(" ").toLowerCase();
        case "income":
        case "expense": return [r.voucher_number, r.description, r.category, r.party_name].filter(Boolean).join(" ").toLowerCase();
        case "quote": return [r.quote_number, r.contacts?.name, r.customer_name].filter(Boolean).join(" ").toLowerCase();
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
      if (filters.partyId && active.party) {
        if (active.party === "customer" && r.invoices?.contact_id !== filters.partyId) return false;
        if (active.party === "supplier" && r.contact_id !== filters.partyId) return false;
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
          { key: "customer", header: "العميل", render: (r: any) => r.contacts?.name ?? "نقدي" },
          { key: "total", header: "المبلغ", render: (r: any) => formatEGP(r.total) },
          { key: "status", header: "الحالة", render: (r: any) => r.status === "active" ? "نشطة" : "ملغاة" },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
          {
            key: "actions", header: "إجراءات", render: (r: any) => (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="عرض / إدارة" onClick={() => nav(`${base}/sales/${r.id}`)}>
                  <Eye className="w-4 h-4" />
                </Button>
                {canDeleteInvoice && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" title="حذف نهائي" onClick={() => setDelTarget(r)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ),
          },
        ],
        onClick: (r: any) => nav(`${base}/sales/${r.id}`),
      };
      case "purchase": return {
        newLink: `${base}/shipments/new`, newLabel: "شحنة شراء جديدة", newPerm: "shipments.create",
        columns: [
          { key: "shipment_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary">{r.shipment_number ?? "—"}</span> },
          { key: "supplier", header: "المورد", render: (r: any) => r.contacts?.name ?? "—" },
          { key: "received_by", header: "استلم بواسطة" },
          { key: "arrival_date", header: "تاريخ الوصول", render: (r: any) => formatDate(r.arrival_date) },
          { key: "total_cost", header: "الإجمالي", render: (r: any) => formatEGP(r.total_cost) },
          {
            key: "actions", header: "إجراءات", render: (r: any) => (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="عرض / تعديل" onClick={() => nav(`${base}/shipments/${r.id}`)}>
                  <Eye className="w-4 h-4" />
                </Button>
                {canDeleteInvoice && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" title={isAdmin ? "حذف الشحنة" : "طلب حذف"} onClick={() => setDelShipment(r)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ),
          },
        ],
        onClick: (r: any) => nav(`${base}/shipments/${r.id}`),
      };
      case "sale_return": return {
        newLink: `${base}/sale-returns/new`, newLabel: "مرتجع بيع جديد", newPerm: "sales.create",
        columns: [
          { key: "return_number", header: "رقم المرتجع", render: (r: any) => <span className="font-mono text-primary">{r.return_number ?? "—"}</span> },
          { key: "inv", header: "رقم الفاتورة", render: (r: any) => r.invoices?.invoice_number ?? "—" },
          { key: "customer", header: "العميل", render: (r: any) => r.invoices?.contacts?.name ?? "نقدي" },
          { key: "reason", header: "السبب" },
          { key: "total_refund", header: "المرتجع", render: (r: any) => formatEGP(r.total_refund) },
          { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
        ],
      };
      case "purchase_return": return {
        newLink: `${base}/purchase-returns/new`, newLabel: "مرتجع شراء جديد", newPerm: "shipments.create",
        columns: [
          { key: "return_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary">{r.return_number}</span> },
          { key: "supplier", header: "المورد", render: (r: any) => r.contacts?.name ?? "—" },
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
          { key: "customer", header: "العميل", render: (r: any) => r.contacts?.name ?? r.customer_name ?? "—" },
          { key: "total", header: "الإجمالي", render: (r: any) => formatEGP(r.total) },
          { key: "valid_until", header: "صالح حتى", render: (r: any) => r.valid_until ? formatDate(r.valid_until) : "—" },
          { key: "status", header: "الحالة" },
        ],
      };
      case "adjustment": return {
        newLink: `${base}/adjustments/new`, newLabel: "تسوية مخزون جديدة", newPerm: "inventory.update",
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
    filters.categoryId || filters.fromBranch || filters.toBranch || filters.partyId;

  // For return tabs: use draft filters (apply only when search button clicked)
  const inputF = isReturnTab ? draftFilters : filters;
  const setInputF = (next: Filters) => (isReturnTab ? setDraftFilters(next) : setFilters(next));

  const applySearch = () => {
    setFilters(draftFilters);
    setSuggestOpen(false);
  };
  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    setDraftFilters(EMPTY_FILTERS);
    setSuggestOpen(false);
  };

  // Quick date presets
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const applyQuickDate = (preset: "today" | "yesterday" | "7d" | "thisMonth" | "lastMonth") => {
    const now = new Date();
    let from = "", to = "";
    if (preset === "today") { from = to = ymd(now); }
    else if (preset === "yesterday") {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      from = to = ymd(y);
    } else if (preset === "7d") {
      const s = new Date(now); s.setDate(s.getDate() - 6);
      from = ymd(s); to = ymd(now);
    } else if (preset === "thisMonth") {
      from = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
      to = ymd(now);
    } else if (preset === "lastMonth") {
      from = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      to = ymd(new Date(now.getFullYear(), now.getMonth(), 0));
    }
    setInputF({ ...inputF, from, to });
  };

  // Autocomplete suggestions for return tabs (uses already-loaded rows)
  const suggestions = useMemo(() => {
    if (!isReturnTab) return [];
    const q = draftFilters.q.trim().toLowerCase();
    if (q.length < 2) return [];
    const text = (r: any) => {
      if (tab === "sale_return") return [r.invoices?.invoice_number, r.invoices?.contacts?.name, r.invoices?.contacts?.phone, r.reason].filter(Boolean).join(" ").toLowerCase();
      return [r.return_number, r.contacts?.name, r.contacts?.phone, r.reason].filter(Boolean).join(" ").toLowerCase();
    };
    return rows.filter((r) => text(r).includes(q)).slice(0, 8);
  }, [isReturnTab, tab, draftFilters.q, rows]);

  // Summary (count + total) for return tabs
  const summary = useMemo(() => {
    if (!isReturnTab) return null;
    const total = filteredRows.reduce((s, r) => s + Number(tab === "sale_return" ? r.total_refund ?? 0 : r.total_amount ?? 0), 0);
    return { count: filteredRows.length, total };
  }, [isReturnTab, tab, filteredRows]);

  const selectedParty = parties.find((p) => p.id === inputF.partyId);

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
            {cfg.newLink && (
              <PermGate perm={(cfg as any).newPerm ?? ""}>
                <Button asChild className="gap-2">
                  <Link to={cfg.newLink}><Plus className="w-4 h-4" /> {cfg.newLabel}</Link>
                </Button>
              </PermGate>
            )}
          

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
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Search className="w-4 h-4 text-muted-foreground" />
            <span>فلاتر {currentTabLabel}</span>
            <span className="text-xs text-muted-foreground font-normal">
              ({filteredRows.length} من {rows.length})
            </span>
          </div>
          {hasAnyFilter && (
            <Button variant="ghost" size="sm" onClick={clearAll} className="gap-1 h-7">
              <X className="w-3 h-3" /> مسح الفلاتر
            </Button>
          )}
        </div>

        {/* Quick date presets (return tabs only) */}
        {isReturnTab && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <CalendarIcon className="w-3 h-3" /> اختصارات:
            </span>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyQuickDate("today")}>النهاردة</Button>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyQuickDate("yesterday")}>امبارح</Button>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyQuickDate("7d")}>آخر 7 أيام</Button>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyQuickDate("thisMonth")}>الشهر ده</Button>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyQuickDate("lastMonth")}>الشهر اللي فات</Button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {active.search && (
            <div className="space-y-1 lg:col-span-2 relative">
              <Label className="text-xs">بحث (رقم / اسم / تليفون / سبب)</Label>
              <Input
                value={inputF.q}
                onChange={(e) => { setInputF({ ...inputF, q: e.target.value }); if (isReturnTab) setSuggestOpen(true); }}
                onFocus={() => isReturnTab && setSuggestOpen(true)}
                onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
                onKeyDown={(e) => { if (e.key === "Enter" && isReturnTab) applySearch(); }}
                placeholder="رقم الفاتورة، اسم العميل، المورد، تليفون..."
                className="h-9"
              />
              {/* Autocomplete dropdown */}
              {isReturnTab && suggestOpen && suggestions.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-72 overflow-y-auto">
                  {suggestions.map((r: any) => {
                    const num = r.return_number ?? (tab === "sale_return" ? r.invoices?.invoice_number : null);
                    const party = tab === "sale_return" ? (r.invoices?.contacts?.name ?? "نقدي") : (r.contacts?.name ?? "—");
                    const amt = Number(tab === "sale_return" ? r.total_refund ?? 0 : r.total_amount ?? 0);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className="w-full text-right px-3 py-2 hover:bg-accent border-b last:border-b-0 flex items-center justify-between gap-2"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setDraftFilters({ ...draftFilters, q: String(num ?? "") });
                          setFilters({ ...draftFilters, q: String(num ?? "") });
                          setSuggestOpen(false);
                        }}
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="font-mono text-primary text-sm truncate">{num ?? "—"}</span>
                          <span className="text-xs text-muted-foreground truncate">{party} • {formatDate(r.created_at)}</span>
                        </div>
                        <span className="text-xs font-semibold whitespace-nowrap">{formatEGP(amt)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {active.date && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">من تاريخ</Label>
                <Input type="date" value={inputF.from} onChange={(e) => setInputF({ ...inputF, from: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">إلى تاريخ</Label>
                <Input type="date" value={inputF.to} onChange={(e) => setInputF({ ...inputF, to: e.target.value })} className="h-9" />
              </div>
            </>
          )}
          {active.party && (
            <div className="space-y-1">
              <Label className="text-xs">{active.party === "customer" ? "العميل" : "المورد"}</Label>
              <Popover open={partyOpen} onOpenChange={setPartyOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal h-9">
                    <span className="truncate">{selectedParty?.name ?? "الكل"}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="ابحث بالاسم أو التليفون..." />
                    <CommandList>
                      <CommandEmpty>لا توجد نتائج</CommandEmpty>
                      <CommandGroup>
                        <CommandItem value="__all__" onSelect={() => { setInputF({ ...inputF, partyId: "" }); setPartyOpen(false); }}>
                          <Check className={cn("ml-2 h-4 w-4", !inputF.partyId ? "opacity-100" : "opacity-0")} />
                          الكل
                        </CommandItem>
                        {parties.map((p) => (
                          <CommandItem key={p.id} value={`${p.name} ${p.phone ?? ""}`} onSelect={() => { setInputF({ ...inputF, partyId: p.id }); setPartyOpen(false); }}>
                            <Check className={cn("ml-2 h-4 w-4", inputF.partyId === p.id ? "opacity-100" : "opacity-0")} />
                            <div className="flex flex-col">
                              <span>{p.name}</span>
                              {p.phone && <span className="text-xs text-muted-foreground">{p.phone}</span>}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}
          {active.status && statusOptions.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">الحالة</Label>
              <Select value={inputF.status || "__all__"} onValueChange={(v) => setInputF({ ...inputF, status: v === "__all__" ? "" : v })}>
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
                <Input type="number" min="0" value={inputF.amountMin} onChange={(e) => setInputF({ ...inputF, amountMin: e.target.value })} className="h-9" placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">المبلغ إلى</Label>
                <Input type="number" min="0" value={inputF.amountMax} onChange={(e) => setInputF({ ...inputF, amountMax: e.target.value })} className="h-9" placeholder="—" />
              </div>
            </>
          )}
          {active.payment && (
            <div className="space-y-1">
              <Label className="text-xs">طريقة الدفع</Label>
              <Select value={inputF.payment || "__all__"} onValueChange={(v) => setInputF({ ...inputF, payment: v === "__all__" ? "" : v })}>
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
              <Select value={inputF.categoryId || "__all__"} onValueChange={(v) => setInputF({ ...inputF, categoryId: v === "__all__" ? "" : v })}>
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
                <Select value={inputF.fromBranch || "__all__"} onValueChange={(v) => setInputF({ ...inputF, fromBranch: v === "__all__" ? "" : v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="الكل" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">الكل</SelectItem>
                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">إلى فرع</Label>
                <Select value={inputF.toBranch || "__all__"} onValueChange={(v) => setInputF({ ...inputF, toBranch: v === "__all__" ? "" : v })}>
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

        {/* Search / Clear buttons (return tabs only) */}
        {isReturnTab && (
          <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t">
            <Button type="button" variant="outline" size="sm" onClick={clearAll} className="gap-1">
              <X className="w-4 h-4" /> مسح
            </Button>
            <Button type="button" size="sm" onClick={applySearch} className="gap-1">
              <Search className="w-4 h-4" /> بحث
            </Button>
          </div>
        )}
      </div>

      {/* Summary (return tabs only) */}
      {isReturnTab && summary && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-card border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">عدد المرتجعات</div>
            <div className="text-xl font-bold text-primary">{summary.count}</div>
          </div>
          <div className="bg-card border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">إجمالي المبلغ المسترد</div>
            <div className="text-xl font-bold text-warning">{formatEGP(summary.total)}</div>
          </div>
        </div>
      )}

      <DataTable
        loading={loading}
        rows={filteredRows}
        onRowClick={cfg.onClick}
        empty="لا توجد سجلات"
        columns={cfg.columns as any}
      />


      <AlertDialog open={!!delTarget} onOpenChange={(o) => { if (!o) { setDelTarget(null); setDelReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              {isManager && !isAdmin ? "طلب حذف فاتورة للموافقة" : "حذف الفاتورة نهائياً"}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-1">
              {isManager && !isAdmin ? (
                <div>سيتم إرسال طلب حذف الفاتورة <span className="font-mono text-primary">{delTarget?.invoice_number}</span> لمدير الشركة للموافقة.</div>
              ) : (
                <>
                  <div>هتمسح الفاتورة <span className="font-mono text-primary">{delTarget?.invoice_number}</span> نهائياً.</div>
                  <div>• كل البضاعة هترجع للمخزن • الفلوس هتتشال من الخزنة • الأقساط هتتمسح</div>
                  <div className="text-destructive font-semibold">العملية دي مش بترجع.</div>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {isManager && !isAdmin && (
            <div className="px-1">
              <Label>سبب الحذف *</Label>
              <Input className="mt-1.5" value={delReason} onChange={(e) => setDelReason(e.target.value)} placeholder="اكتب سبب طلب الحذف..." />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delBusy}>تراجع</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteInvoice} disabled={delBusy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {delBusy ? "جاري..." : (isManager && !isAdmin ? "إرسال الطلب" : "احذف نهائياً")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!delShipment} onOpenChange={(o) => { if (!o) { setDelShipment(null); setDelShipReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              {isManager && !isAdmin ? "طلب حذف شحنة للموافقة" : "حذف الشحنة"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isManager && !isAdmin
                ? <>سيتم إرسال طلب حذف الشحنة <span className="font-mono text-primary">{delShipment?.shipment_number}</span> لمدير الشركة للموافقة.</>
                : <>هل أنت متأكد من حذف الشحنة <span className="font-mono text-primary">{delShipment?.shipment_number}</span>؟ لن يمكن التراجع.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {isManager && !isAdmin && (
            <div className="px-1">
              <Label>سبب الحذف *</Label>
              <Input className="mt-1.5" value={delShipReason} onChange={(e) => setDelShipReason(e.target.value)} placeholder="اكتب السبب..." />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delShipBusy}>تراجع</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteShipment} disabled={delShipBusy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {delShipBusy ? "جاري..." : (isManager && !isAdmin ? "إرسال الطلب" : "احذف")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </BranchLayout>
  );
}
