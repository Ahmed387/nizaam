import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NumberedPagination } from "@/components/NumberedPagination";
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
import { Plus, ShoppingCart, PackagePlus, RotateCcw, Undo2, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, FileText, ClipboardList, FileSpreadsheet, Printer, Search, X, Eye, Pencil, Trash2, XCircle, Calendar as CalendarIcon, Check, ChevronDown, ChevronsUpDown } from "lucide-react";
import { exportToExcel, printReport } from "@/lib/export";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useAttachmentCounts, type RecordType } from "@/hooks/useAttachmentCounts";
import { AttachmentsDialogButton } from "@/components/AttachmentsDialogButton";
import { EditableInvoiceDate } from "@/components/EditableInvoiceDate";
import { InvoiceItemsAccordion } from "@/components/InvoiceItemsAccordion";
import { DocumentItemsAccordion } from "@/components/DocumentItemsAccordion";
import { VoucherViewDialog } from "@/components/VoucherViewDialog";
import { searchMatch } from "@/lib/search";
import { VoucherDialog } from "@/components/VoucherDialog";
import { CancelReturnButton } from "@/components/CancelReturnButton";
import { InlineVoucherDate } from "@/components/InlineVoucherDate";
import { ReturnEditDialog } from "@/components/ReturnEditDialog";

type TabKey = "sale" | "purchase" | "sale_return" | "purchase_return" | "income" | "expense" | "transfer" | "quote";

// Tabs whose rows expand into a lazy line-items accordion sub-row
const DOC_ITEMS_TABS: TabKey[] = ["sale", "purchase", "sale_return", "purchase_return"];

const TABS: { key: TabKey; label: string; icon: any; color: string }[] = [
  { key: "sale", label: "فواتير البيع", icon: ShoppingCart, color: "text-success" },
  { key: "purchase", label: "فواتير الشراء", icon: PackagePlus, color: "text-primary" },
  { key: "sale_return", label: "مرتجع بيع", icon: RotateCcw, color: "text-warning" },
  { key: "purchase_return", label: "مرتجع شراء", icon: Undo2, color: "text-warning" },
  { key: "income", label: "سندات القبض", icon: ArrowDownCircle, color: "text-success" },
  { key: "expense", label: "سندات الصرف", icon: ArrowUpCircle, color: "text-destructive" },
  { key: "transfer", label: "تحويل المخازن", icon: ArrowLeftRight, color: "text-primary" },
  { key: "quote", label: "عروض الأسعار", icon: FileText, color: "text-secondary" },
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
  const [editVoucher, setEditVoucher] = useState<{ v: any; focus: boolean } | null>(null);
  const [returnEdit, setReturnEdit] = useState<{ kind: "sale_return" | "purchase_return"; rec: any } | null>(null);
  // Voucher actions (income/expense tabs)
  const [viewVoucher, setViewVoucher] = useState<any>(null);
  const [cancelVoucher, setCancelVoucher] = useState<any>(null);
  const [cancelVoucherReason, setCancelVoucherReason] = useState("");
  const [deleteVoucher, setDeleteVoucher] = useState<any>(null);
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);

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
    const label = `فاتورة شراء ${delShipment.shipment_number ?? ""} - ${delShipment.contacts?.name ?? ""}`;
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
  useEffect(() => { setExpandedInvoiceId(null); }, [tab, branchId]);
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
      const { data } = await supabase.from("contacts").select("id, name, phone").eq("is_archived", false).eq("branch_id", branchId).order("name");
      setParties((data ?? []) as any);
    } else {
      const { data } = await supabase.from("contacts").select("id, name, phone").eq("is_archived", false).order("name");
      setParties((data ?? []).map((d: any) => ({ id: d.id, name: d.name, phone: d.phone })));
    }
  }, [active.party, branchId]);
  useEffect(() => { loadParties(); }, [loadParties]);
  useRealtimeRefresh(["contacts"], loadParties);

  // ===== Server-side pagination engine =====
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [returnsTotal, setReturnsTotal] = useState(0);
  const tableTopRef = useRef<HTMLDivElement>(null);
  // 300ms debounce on the text search; other filters apply instantly.
  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  useEffect(() => { const t = setTimeout(() => setDebouncedQ(filters.q), 300); return () => clearTimeout(t); }, [filters.q]);
  const queryFilters = useMemo(() => ({ ...filters, q: debouncedQ }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify({ ...filters, q: "" }), debouncedQ]);
  useEffect(() => { setPage(1); }, [tab, branchId, queryFilters]);

  /** Applies every active filter directly to the Supabase query (database-level). */
  const buildQuery = useCallback(async (select: string, withCount: boolean) => {
    const f = queryFilters;
    const q = f.q.trim().replace(/[,()%*]/g, " ").trim();
    const opts = withCount ? { count: "exact" as const } : undefined;
    const contactIdsFor = async (text: string) => {
      const { data } = await supabase.from("contacts").select("id").or(`name.ilike.%${text}%,phone.ilike.%${text}%`).limit(500);
      return (data ?? []).map((d: any) => d.id as string);
    };
    const inList = (ids: string[]) => `(${(ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).join(",")})`;
    const dateRange = (qb: any, col: string, isDate: boolean) => {
      if (f.from) qb = qb.gte(col, isDate ? f.from : `${f.from}T00:00:00`);
      if (f.to) qb = qb.lte(col, isDate ? f.to : `${f.to}T23:59:59.999`);
      return qb;
    };
    const amountRange = (qb: any, col: string) => {
      if (f.amountMin) qb = qb.gte(col, Number(f.amountMin));
      if (f.amountMax) qb = qb.lte(col, Number(f.amountMax));
      return qb;
    };
    let qb: any;
    if (tab === "sale") {
      qb = supabase.from("invoices").select(select, opts).eq("branch_id", branchId!);
      if (q) { const ids = await contactIdsFor(q); qb = qb.or(`invoice_number.ilike.%${q}%,contact_id.in.${inList(ids)}`); }
      qb = dateRange(qb, "invoice_date", true); qb = amountRange(qb, "total");
      if (f.status) qb = qb.eq("status", f.status);
      if (f.payment) qb = qb.eq("payment_method", f.payment);
      qb = qb.order("invoice_date", { ascending: false }).order("created_at", { ascending: false });
    } else if (tab === "purchase") {
      qb = supabase.from("shipments").select(select, opts).eq("branch_id", branchId!);
      if (q) { const ids = await contactIdsFor(q); qb = qb.or(`shipment_number.ilike.%${q}%,received_by.ilike.%${q}%,contact_id.in.${inList(ids)}`); }
      qb = dateRange(qb, "invoice_date", true); qb = amountRange(qb, "total_cost");
      qb = qb.order("invoice_date", { ascending: false }).order("created_at", { ascending: false });
    } else if (tab === "sale_return") {
      qb = supabase.from("returns").select(select, opts).eq("branch_id", branchId!);
      if (q) {
        const ids = await contactIdsFor(q);
        const { data: invs } = await supabase.from("invoices").select("id").eq("branch_id", branchId!).or(`invoice_number.ilike.%${q}%,contact_id.in.${inList(ids)}`).limit(500);
        qb = qb.or(`return_number.ilike.%${q}%,reason.ilike.%${q}%,invoice_id.in.${inList((invs ?? []).map((i: any) => i.id))}`);
      }
      if (f.partyId) {
        const { data: invs } = await supabase.from("invoices").select("id").eq("branch_id", branchId!).eq("contact_id", f.partyId).limit(1000);
        qb = qb.in("invoice_id", (invs ?? []).map((i: any) => i.id).concat(["00000000-0000-0000-0000-000000000000"]));
      }
      qb = dateRange(qb, "invoice_date", true); qb = amountRange(qb, "total_refund");
      qb = qb.order("invoice_date", { ascending: false }).order("created_at", { ascending: false });
    } else if (tab === "purchase_return") {
      qb = supabase.from("purchase_returns" as any).select(select, opts).eq("branch_id", branchId!);
      if (q) { const ids = await contactIdsFor(q); qb = qb.or(`return_number.ilike.%${q}%,reason.ilike.%${q}%,contact_id.in.${inList(ids)}`); }
      if (f.partyId) qb = qb.eq("contact_id", f.partyId);
      if (f.status) qb = qb.eq("status", f.status);
      qb = dateRange(qb, "invoice_date", true); qb = amountRange(qb, "total_amount");
      qb = qb.order("invoice_date", { ascending: false }).order("created_at", { ascending: false });
    } else if (tab === "income" || tab === "expense") {
      qb = supabase.from("vouchers" as any).select(select, opts).eq("branch_id", branchId!)
        .eq("type", tab === "income" ? "receipt" : "payment").eq("status", "active");
      if (tab === "expense") {
        // Exclude system-managed payment types that aren't real business expenses
        const { data: ex } = await supabase.from("voucher_categories" as any).select("id").in("system_key", ["customer_return", "supplier_payment", "branch_transfer_out"]);
        const exIds = (ex ?? []).map((c: any) => c.id);
        if (exIds.length) qb = qb.or(`category_id.is.null,category_id.not.in.${inList(exIds)}`);
      }
      if (q) qb = qb.or(`voucher_number.ilike.%${q}%,description.ilike.%${q}%,party_name.ilike.%${q}%`);
      qb = dateRange(qb, "voucher_date", false); qb = amountRange(qb, "amount");
      if (f.payment) qb = qb.eq("payment_method", f.payment);
      if (f.categoryId) qb = qb.eq("category_id", f.categoryId);
      qb = qb.order("voucher_date", { ascending: false }).order("created_at", { ascending: false });
    } else if (tab === "transfer") {
      qb = supabase.from("stock_transfers").select(select, opts).or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`);
      qb = dateRange(qb, "created_at", false);
      if (f.status) qb = qb.eq("status", f.status);
      if (f.fromBranch) qb = qb.eq("from_branch_id", f.fromBranch);
      if (f.toBranch) qb = qb.eq("to_branch_id", f.toBranch);
      qb = qb.order("created_at", { ascending: false });
    } else {
      qb = supabase.from("quotes" as any).select(select, opts).eq("branch_id", branchId!);
      if (q) { const ids = await contactIdsFor(q); qb = qb.or(`quote_number.ilike.%${q}%,customer_name.ilike.%${q}%,contact_id.in.${inList(ids)}`); }
      qb = dateRange(qb, "created_at", false); qb = amountRange(qb, "total");
      if (f.status) qb = qb.eq("status", f.status);
      qb = qb.order("created_at", { ascending: false });
    }
    // Wrap: PostgREST builders are thenables — returning one from an async fn would execute it.
    return { qb };
  }, [tab, branchId, queryFilters]);

  const SELECTS: Record<TabKey, string> = {
    sale: "*, contacts:contact_id(name)",
    purchase: "*, contacts:contact_id(name)",
    sale_return: "*, invoices(invoice_number, invoice_date, contact_id, contacts:contact_id(name, phone))",
    purchase_return: "*, contacts:contact_id(name, phone)",
    income: "*, voucher_categories(name)",
    expense: "*, voucher_categories(name, system_key)",
    transfer: "*",
    quote: "*, contacts:contact_id(name)",
  };

  const reqRef = useRef<{ id: number; ctrl: AbortController | null }>({ id: 0, ctrl: null });
  const load = useCallback(async () => {
    if (!branchId) return;
    // Cancel any in-flight request; only the latest one may update state.
    reqRef.current.ctrl?.abort();
    const ctrl = new AbortController();
    const myId = ++reqRef.current.id;
    reqRef.current.ctrl = ctrl;
    const stale = () => myId !== reqRef.current.id;
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    let r: any;
    try {
      const { qb } = await buildQuery(SELECTS[tab], true);
      if (stale()) return;
      r = await qb.range(from, from + PAGE_SIZE - 1).abortSignal(ctrl.signal);
    } catch (e: any) {
      if (!stale() && e?.name !== "AbortError") { toast.error(e?.message ?? "تعذر تحميل البيانات"); setRows([]); setTotalCount(0); }
      if (!stale()) setLoading(false);
      return;
    }
    if (stale()) return;
    if (r.error && !/abort/i.test(r.error.message ?? "")) toast.error(r.error.message);
    let data: any[] = r.data ?? [];
    if (tab === "income" || tab === "expense") {
      data = data.map((v: any) => ({
        ...v,
        created_at: v.voucher_date ?? v.created_at,
        category: v.voucher_categories?.name ?? "—",
        description: v.description ?? v.voucher_number,
      }));
    }
    setRows(data);
    setTotalCount(r.count ?? data.length);
    setLoading(false);
    if (tab === "sale_return" || tab === "purchase_return") {
      const col = tab === "sale_return" ? "total_refund" : "total_amount";
      let sum = 0; let off = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { qb: sq } = await buildQuery(col, false);
        const { data: part } = await sq.range(off, off + 999).abortSignal(ctrl.signal);
        if (stale()) return;
        (part ?? []).forEach((x: any) => { sum += Number(x[col] ?? 0); });
        if (!part || part.length < 1000) break;
        off += 1000;
      }
      setReturnsTotal(sum);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, branchId, page, buildQuery]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["invoices", "shipments", "returns", "purchase_returns", "vouchers", "stock_transfers", "quotes", "stock_adjustments"], load);

  const branchName = (bid?: string) => branches.find((b) => b.id === bid)?.name ?? bid ?? "—";

  // Filtering now happens in the database; the current page is what we show.
  const filteredRows = rows;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const attRecordType = useMemo<RecordType | null>(() => {
    switch (tab) {
      case "sale": return "invoice";
      case "purchase": return "shipment";
      case "sale_return": return "sale_return";
      case "purchase_return": return "purchase_return";
      case "transfer": return "stock_transfer";
      case "income":
      case "expense": return "voucher";
      default: return null;
    }
  }, [tab]);
  const attIds = useMemo(() => attRecordType ? filteredRows.map((r: any) => r.id) : [], [attRecordType, filteredRows]);
  const attCounts = useAttachmentCounts((attRecordType ?? "voucher") as RecordType, attIds);

  // 1-based visual sequence index — pure UI helper, decoupled from document IDs/codes
  const rowIndexById = useMemo(() => {
    const m = new Map<string, number>();
    (filteredRows as any[]).forEach((r, i) => m.set(r.id, (page - 1) * PAGE_SIZE + i));
    return m;
  }, [filteredRows, page]);
  const seqColumn = {
    key: "row_seq", header: "#", align: "center" as const, width: "4rem",
    render: (r: any) => (
      <span className="font-mono text-xs font-semibold text-muted-foreground" title="ترتيب الصف">
        {(rowIndexById.get(r.id) ?? 0) + 1}
      </span>
    ),
  };

  const cfg = useMemo(() => {
    const base = `/branch/${branchId}`;
    switch (tab) {
      case "sale": return {
        newLink: `${base}/sales/new`, newLabel: "فاتورة بيع جديدة", newPerm: "sales.create",
        columns: [
          seqColumn,
          { key: "invoice_number", header: "رقم", align: "center", width: "8rem", render: (r: any) => (
            <span className="flex items-center justify-center gap-1.5">
              <button
                type="button"
                aria-label={expandedInvoiceId === r.id ? "إخفاء أصناف الفاتورة" : "عرض أصناف الفاتورة"}
                aria-expanded={expandedInvoiceId === r.id}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedInvoiceId((current) => current === r.id ? null : r.id);
                }}
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${expandedInvoiceId === r.id ? "rotate-180" : ""}`} />
              </button>
              <span className="font-mono text-primary font-semibold">{r.invoice_number}</span>
            </span>
          ) },
          { key: "customer", header: "العميل", align: "center", render: (r: any) => r.contacts?.name ?? "نقدي" },
          { key: "total", header: "المبلغ", align: "center", width: "9rem", numeric: true, render: (r: any) => formatEGP(r.total) },
          { key: "status", header: "الحالة", align: "center", width: "6rem", render: (r: any) => r.status === "active" ? "نشطة" : "ملغاة" },
          { key: "invoice_date", header: "تاريخ الفاتورة", align: "center", width: "10rem", render: (r: any) => <EditableInvoiceDate table="invoices" recordId={r.id} value={r.invoice_date} fallback={r.created_at} onSaved={() => load()} /> },
          {
            key: "actions", header: "إجراءات", align: "center", width: "10rem", render: (r: any) => (
              <div className="flex items-center justify-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="عرض / إدارة" onClick={() => nav(`${base}/sales/${r.id}`)}>
                  <Eye className="w-4 h-4" />
                </Button>
                <AttachmentsDialogButton recordType="invoice" recordId={r.id} count={attCounts[r.id] ?? 0} />
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
        newLink: `${base}/shipments/new`, newLabel: "فاتورة شراء جديدة", newPerm: "shipments.create",
        columns: [
          seqColumn,
          { key: "shipment_number", header: "رقم", align: "right", width: "8rem", render: (r: any) => (
            <span className="inline-flex items-center justify-end gap-1.5">
              <button
                type="button"
                aria-label={expandedInvoiceId === r.id ? "إخفاء أصناف فاتورة الشراء" : "عرض أصناف فاتورة الشراء"}
                aria-expanded={expandedInvoiceId === r.id}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedInvoiceId((current) => current === r.id ? null : r.id);
                }}
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${expandedInvoiceId === r.id ? "rotate-180" : ""}`} />
              </button>
              <span className="font-mono text-primary font-semibold">{r.shipment_number ?? "—"}</span>
            </span>
          ) },
          { key: "supplier", header: "المورد", align: "right", render: (r: any) => r.contacts?.name ?? "—" },
          { key: "received_by", header: "استلم بواسطة", align: "right" },
          { key: "invoice_date", header: "تاريخ الفاتورة", align: "right", width: "10rem", render: (r: any) => <EditableInvoiceDate table="shipments" recordId={r.id} value={r.invoice_date} fallback={r.created_at} onSaved={() => load()} /> },
          { key: "arrival_date", header: "تاريخ الوصول", align: "right", width: "10rem", render: (r: any) => formatDate(r.arrival_date) },
          { key: "total_cost", header: "الإجمالي", align: "right", width: "9rem", numeric: true, render: (r: any) => formatEGP(r.total_cost) },
          {
            key: "actions", header: "إجراءات", align: "center", width: "10rem", render: (r: any) => (
              <div className="flex items-center justify-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="عرض / تعديل" onClick={() => nav(`${base}/shipments/${r.id}`)}>
                  <Eye className="w-4 h-4" />
                </Button>
                <AttachmentsDialogButton recordType="shipment" recordId={r.id} count={attCounts[r.id] ?? 0} />
                {canDeleteInvoice && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" title={isAdmin ? "حذف فاتورة الشراء" : "طلب حذف"} onClick={() => setDelShipment(r)}>
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
          seqColumn,
          { key: "return_number", header: "رقم المرتجع", align: "right", width: "8rem", render: (r: any) => (
            <span className="inline-flex items-center justify-end gap-1.5">
              <button
                type="button"
                aria-label={expandedInvoiceId === r.id ? "إخفاء أصناف المرتجع" : "عرض أصناف المرتجع"}
                aria-expanded={expandedInvoiceId === r.id}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedInvoiceId((current) => current === r.id ? null : r.id);
                }}
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${expandedInvoiceId === r.id ? "rotate-180" : ""}`} />
              </button>
              <span className="font-mono text-primary font-semibold">{r.return_number ?? "—"}</span>
            </span>
          ) },
          { key: "inv", header: "رقم الفاتورة", align: "right", width: "8rem", render: (r: any) => r.invoices?.invoice_number ?? "—" },
          { key: "customer", header: "العميل", align: "right", render: (r: any) => r.invoices?.contacts?.name ?? "نقدي" },
          { key: "reason", header: "السبب", align: "right" },
          { key: "total_refund", header: "المرتجع", align: "right", width: "9rem", numeric: true, render: (r: any) => formatEGP(r.total_refund) },
          { key: "invoice_date", header: "تاريخ المرتجع", align: "right", width: "10rem", render: (r: any) => <EditableInvoiceDate table="returns" recordId={r.id} value={r.invoice_date} fallback={r.created_at} onSaved={() => load()} /> },
          {
            key: "actions", header: "إجراءات", align: "center", width: "10rem", render: (r: any) => (
              <div className="flex items-center justify-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="عرض" onClick={() => nav(`${base}/sale-returns/${r.id}`)}>
                  <Eye className="w-4 h-4" />
                </Button>
                {isAdmin && (
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="تعديل تاريخ وملاحظات المرتجع" onClick={() => setReturnEdit({ kind: "sale_return", rec: r })}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                )}
                <AttachmentsDialogButton recordType="sale_return" recordId={r.id} count={attCounts[r.id] ?? 0} />
                <CancelReturnButton iconOnly kind="sale" returnId={r.id} returnNumber={r.return_number ?? ""} total={Number(r.total_refund ?? 0)} status={r.status ?? "active"} onDone={() => load()} />
              </div>
            ),
          },
        ],
        onClick: (r: any) => nav(`${base}/sale-returns/${r.id}`),
      };
      case "purchase_return": return {
        newLink: `${base}/purchase-returns/new`, newLabel: "مرتجع شراء جديد", newPerm: "shipments.create",
        columns: [
          seqColumn,
          { key: "return_number", header: "رقم", align: "right", width: "8rem", render: (r: any) => (
            <span className="inline-flex items-center justify-end gap-1.5">
              <button
                type="button"
                aria-label={expandedInvoiceId === r.id ? "إخفاء أصناف المرتجع" : "عرض أصناف المرتجع"}
                aria-expanded={expandedInvoiceId === r.id}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedInvoiceId((current) => current === r.id ? null : r.id);
                }}
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${expandedInvoiceId === r.id ? "rotate-180" : ""}`} />
              </button>
              <span className="font-mono text-primary font-semibold">{r.return_number}</span>
            </span>
          ) },
          { key: "supplier", header: "المورد", align: "right", render: (r: any) => r.contacts?.name ?? "—" },
          { key: "reason", header: "السبب", align: "right" },
          { key: "total_amount", header: "الإجمالي", align: "right", width: "9rem", numeric: true, render: (r: any) => formatEGP(r.total_amount) },
          { key: "invoice_date", header: "تاريخ المرتجع", align: "right", width: "10rem", render: (r: any) => <EditableInvoiceDate table="purchase_returns" recordId={r.id} value={r.invoice_date} fallback={r.created_at} onSaved={() => load()} /> },
          {
            key: "actions", header: "إجراءات", align: "center", width: "10rem", render: (r: any) => (
              <div className="flex items-center justify-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="عرض" onClick={() => nav(`${base}/purchase-returns/${r.id}`)}>
                  <Eye className="w-4 h-4" />
                </Button>
                {isAdmin && (
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="تعديل تاريخ وملاحظات المرتجع" onClick={() => setReturnEdit({ kind: "purchase_return", rec: r })}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                )}
                <AttachmentsDialogButton recordType="purchase_return" recordId={r.id} count={attCounts[r.id] ?? 0} />
                <CancelReturnButton iconOnly kind="purchase" returnId={r.id} returnNumber={r.return_number ?? ""} total={Number(r.total_amount ?? 0)} status={r.status ?? "active"} onDone={() => load()} />
              </div>
            ),
          },
        ],
        onClick: (r: any) => nav(`${base}/purchase-returns/${r.id}`),
      };
      case "income":
      case "expense": return {
        newLink: `${base}/treasury`, newLabel: tab === "income" ? "سند قبض جديد" : "سند صرف جديد", newPerm: tab === "income" ? "receipt_vouchers.create" : "payment_vouchers.create",
        columns: [
          { key: "description", header: "البيان", align: "right" },
          { key: "amount", header: "المبلغ", align: "right", width: "9rem", numeric: true, render: (r: any) => formatEGP(r.amount) },
          { key: "category", header: "التصنيف", align: "right", width: "10rem" },
          { key: "created_at", header: "التاريخ", align: "right", width: "10rem", render: (r: any) => r.voucher_date ? <InlineVoucherDate voucher={r} onSaved={() => load()} /> : formatDateTime(r.created_at) },
          {
            key: "actions", header: "إجراءات", align: "center", width: "12rem", render: (r: any) => {
              const canCancel = r.status === "active" && (isAdmin || (isManager && r.source === "manual"));
              return (
                <div className="flex items-center justify-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="عرض السند" onClick={() => setViewVoucher(r)}>
                    <Eye className="w-4 h-4" />
                  </Button>
                  {isAdmin && r.status === "active" && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="تعديل السند" onClick={() => setEditVoucher({ v: r, focus: false })}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  )}
                  <AttachmentsDialogButton recordType="voucher" recordId={r.id} count={attCounts[r.id] ?? 0} />
                  {canCancel && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-warning" title="إلغاء السند — يفضل ظاهر في السجلات كـ (ملغي) ويعكس أثره المحاسبي." onClick={() => setCancelVoucher(r)}>
                      <XCircle className="w-4 h-4" />
                    </Button>
                  )}
                  {isAdmin && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" title="حذف نهائي — يمسح السند ومرفقاته من قاعدة البيانات بدون رجوع." onClick={() => setDeleteVoucher(r)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              );
            },
          },
        ],
        onClick: (r: any) => setViewVoucher(r),
      };
      case "transfer": return {
        newLink: `${base}/transfers`, newLabel: "تحويل مخازن جديد", newPerm: "transfers.create",
        columns: [
          { key: "from_branch_id", header: "من", align: "right", width: "10rem", render: (r: any) => <span className="inline-flex items-center justify-end gap-1.5">{branchName(r.from_branch_id)}</span> },
          { key: "to_branch_id", header: "إلى", align: "right", width: "10rem", render: (r: any) => branchName(r.to_branch_id) },
          { key: "status", header: "الحالة", align: "center", width: "7rem" },
          { key: "created_at", header: "التاريخ", align: "right", width: "10rem", render: (r: any) => formatDateTime(r.created_at) },
          {
            key: "actions", header: "إجراءات", align: "center", width: "10rem", render: (r: any) => (
              <div className="flex items-center justify-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="عرض" onClick={() => nav(`${base}/transfers/${r.id}`)}>
                  <Eye className="w-4 h-4" />
                </Button>
                <AttachmentsDialogButton recordType="stock_transfer" recordId={r.id} count={attCounts[r.id] ?? 0} />
              </div>
            ),
          },
        ],
        onClick: (r: any) => nav(`${base}/transfers/${r.id}`),
      };
      case "quote": return {
        newLink: `${base}/quotes/new`, newLabel: "عرض سعر جديد", newPerm: "sales.create",
        columns: [
          { key: "quote_number", header: "رقم", align: "right", width: "8rem", render: (r: any) => <span className="font-mono text-primary font-semibold">{r.quote_number}</span> },
          { key: "customer", header: "العميل", align: "right", render: (r: any) => r.contacts?.name ?? r.customer_name ?? "—" },
          { key: "total", header: "الإجمالي", align: "right", width: "9rem", numeric: true, render: (r: any) => formatEGP(r.total) },
          { key: "valid_until", header: "صالح حتى", align: "right", width: "10rem", render: (r: any) => r.valid_until ? formatDate(r.valid_until) : "—" },
          { key: "status", header: "الحالة", align: "center", width: "7rem" },
        ],
        onClick: (r: any) => nav(`${base}/quotes/${r.id}`),
      };
    }
  }, [tab, branchId, nav, branches, attCounts, canDeleteInvoice, isAdmin, isManager, expandedInvoiceId, rowIndexById]);

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

  const handleExportPDF = async () => {
    const branchName = branches.find((b) => b.id === branchId)?.name ?? "—";
    const userName = profile?.name ?? user?.email ?? "—";
    if (tab === "sale") {
      const { generateSalesReport } = await import("@/utils/generatePDFReport");
      await generateSalesReport({ branchId: branchId!, branchName, invoices: filteredRows, filters: { from: filters.from, to: filters.to }, userName });
      return;
    }
    if (tab === "sale_return") {
      const { generateSaleReturnsReport } = await import("@/utils/generatePDFReport");
      await generateSaleReturnsReport({ branchName, returns: filteredRows, filters: { from: filters.from, to: filters.to }, userName });
      return;
    }
    if (tab === "purchase_return") {
      const { generatePurchaseReturnsReport } = await import("@/utils/generatePDFReport");
      await generatePurchaseReturnsReport({ branchName, returns: filteredRows, filters: { from: filters.from, to: filters.to }, userName });
      return;
    }
    if (tab === "transfer") {
      const { generateStockTransfersReport } = await import("@/utils/generatePDFReport");
      const branchNames: Record<string, string> = {};
      branches.forEach((b: any) => { branchNames[b.id] = b.name; });
      await generateStockTransfersReport({ branchId: branchId!, branchName, transfers: filteredRows, branchNames, filters: { from: filters.from, to: filters.to }, userName });
      return;
    }

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

  // Descriptive PDF button label per tab
  const pdfBtnLabel =
    tab === "sale" ? "تقرير تفصيلي بالمبيعات" :
    tab === "purchase" ? "تقرير تفصيلي بالمشتريات" :
    tab === "sale_return" ? "تقرير تفصيلي بمرتجعات البيع" :
    tab === "purchase_return" ? "تقرير تفصيلي بمرتجعات الشراء" :
    tab === "income" ? "تقرير تفصيلي بسندات القبض" :
    tab === "expense" ? "تقرير تفصيلي بسندات الصرف" :
    tab === "transfer" ? "تقرير تفصيلي بتحويلات المخازن" :
    tab === "quote" ? "تقرير تفصيلي بعروض الأسعار" :
    "PDF";

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
    return rows.filter((r) => searchMatch(q, text(r))).slice(0, 20);
  }, [isReturnTab, tab, draftFilters.q, rows]);

  // Summary (count + total) for return tabs
  const summary = useMemo(() => {
    if (!isReturnTab) return null;
    return { count: totalCount, total: returnsTotal };
  }, [isReturnTab, totalCount, returnsTotal]);

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
              <Printer className="w-4 h-4" /> {pdfBtnLabel}
            </Button>
            <PermGate perm="preorders.view">
              <Button asChild variant="outline" size="sm" className="gap-2">
                <Link to={`/branch/${branchId}/pre-orders`}><FileText className="w-4 h-4" /> طلبات الحجز</Link>
              </Button>
            </PermGate>
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
              (يعرض {totalCount ? ((page - 1) * PAGE_SIZE + 1).toLocaleString("en-US") : 0} - {Math.min(page * PAGE_SIZE, totalCount).toLocaleString("en-US")} من أصل {totalCount.toLocaleString("en-US")} مستند)
            </span>
          </div>
          {hasAnyFilter && (
            <Button variant="ghost" size="sm" onClick={clearAll} className="gap-1 h-7">
              <X className="w-3 h-3" /> مسح الفلاتر
            </Button>
          )}
        </div>

        {/* Quick date presets */}
        {active.date && (
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
            <div className="text-xl font-bold text-primary">{summary.count.toLocaleString("en-US")}</div>
          </div>
          <div className="bg-card border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">إجمالي المبلغ المسترد</div>
            <div className="text-xl font-bold text-warning">{formatEGP(summary.total)}</div>
          </div>
        </div>
      )}

      <div ref={tableTopRef} className="scroll-mt-4" />
      <DataTable
        loading={loading}
        rows={filteredRows}
        onRowClick={cfg.onClick}
        empty="لا توجد سجلات"
        columns={cfg.columns as any}
        getRowKey={(row: any) => row.id}
        isRowExpanded={DOC_ITEMS_TABS.includes(tab) ? (row: any) => expandedInvoiceId === row.id : undefined}
        renderExpandedRow={DOC_ITEMS_TABS.includes(tab) && tenantId && branchId ? (row: any) => (
          tab === "sale" ? (
            <InvoiceItemsAccordion
              tenantId={tenantId}
              branchId={branchId}
              invoiceId={row.id}
              expanded={expandedInvoiceId === row.id}
            />
          ) : (
            <DocumentItemsAccordion
              docType={tab as "purchase" | "sale_return" | "purchase_return"}
              tenantId={tenantId}
              branchId={branchId}
              docId={row.id}
              expanded={expandedInvoiceId === row.id}
            />
          )
        ) : undefined}
      />

      <NumberedPagination
        page={page}
        pageCount={pageCount}
        disabled={loading}
        onChange={(p) => { setPage(p); tableTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
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
              {isManager && !isAdmin ? "طلب حذف فاتورة شراء للموافقة" : "حذف فاتورة الشراء"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isManager && !isAdmin
                ? <>سيتم إرسال طلب حذف فاتورة الشراء <span className="font-mono text-primary">{delShipment?.shipment_number}</span> لمدير الشركة للموافقة.</>
                : <>هل أنت متأكد من حذف فاتورة الشراء <span className="font-mono text-primary">{delShipment?.shipment_number}</span>؟ لن يمكن التراجع.</>}
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

      {/* Voucher view dialog */}
      <VoucherViewDialog voucher={viewVoucher} open={!!viewVoucher} onOpenChange={(o) => !o && setViewVoucher(null)}
        onEdit={isAdmin ? (v, focus) => { setViewVoucher(null); setEditVoucher({ v, focus: !!focus }); } : undefined} />
      {editVoucher && (
        <VoucherDialog open onOpenChange={(o) => !o && setEditVoucher(null)} branchId={editVoucher.v.branch_id}
          type={editVoucher.v.type} editingVoucher={editVoucher.v} focusDate={editVoucher.focus} onSuccess={() => load()} />
      )}

      {/* Cancel voucher */}
      <Dialog open={!!cancelVoucher} onOpenChange={(o) => { if (!o) { setCancelVoucher(null); setCancelVoucherReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>إلغاء السند {cancelVoucher?.voucher_number}</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed">
              <b>إلغاء السند ≠ حذف السند.</b><br />
              السند هيفضل ظاهر بحالة <b>«ملغي»</b> مع سبب الإلغاء — للتدقيق.<br />
              <b>أثره المحاسبي على الخزينة هيترجع تلقائياً.</b>
            </div>
            <Label>سبب الإلغاء *</Label>
            <Textarea value={cancelVoucherReason} onChange={(e) => setCancelVoucherReason(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelVoucher(null)} disabled={voucherBusy}>تراجع</Button>
            <Button variant="destructive" disabled={voucherBusy} onClick={async () => {
              if (!cancelVoucherReason.trim()) return toast.error("اكتب سبب الإلغاء");
              setVoucherBusy(true);
              const { error } = await supabase.rpc("cancel_voucher" as any, { p_voucher_id: cancelVoucher.id, p_reason: cancelVoucherReason.trim() });
              setVoucherBusy(false);
              if (error) return toast.error(error.message);
              toast.success("تم إلغاء السند");
              setCancelVoucher(null); setCancelVoucherReason(""); load();
            }}>تأكيد الإلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete voucher */}
      <Dialog open={!!deleteVoucher} onOpenChange={(o) => !o && setDeleteVoucher(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>حذف السند {deleteVoucher?.voucher_number} نهائياً</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2 text-sm">
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs leading-relaxed">
              <b>الفرق:</b><br />
              • <b>إلغاء</b> = السند يفضل بحالة «ملغي» مع تتبع السبب.<br />
              • <b>حذف نهائي</b> = السند ومرفقاته يتمسحوا خالص من قاعدة البيانات.
            </div>
            <p>لو السند نشط، أثره على الخزينة هيترجع أوتوماتيك قبل الحذف.</p>
            <p className="text-destructive font-semibold">العملية دي مالهاش رجوع.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteVoucher(null)} disabled={voucherBusy}>تراجع</Button>
            <Button variant="destructive" disabled={voucherBusy} onClick={async () => {
              setVoucherBusy(true);
              const { error } = await supabase.rpc("delete_voucher_admin" as any, { p_voucher_id: deleteVoucher.id, p_reason: "حذف من شاشة الفواتير والمستندات" });
              setVoucherBusy(false);
              if (error) return toast.error(error.message);
              toast.success("تم حذف السند نهائياً");
              setDeleteVoucher(null); load();
            }}>تأكيد الحذف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReturnEditDialog
        kind={returnEdit?.kind ?? "sale_return"}
        record={returnEdit?.rec ?? null}
        originalInvoiceDate={returnEdit?.kind === "sale_return" ? returnEdit?.rec?.invoices?.invoice_date : null}
        onOpenChange={(o) => !o && setReturnEdit(null)}
        onSaved={() => load()}
      />
    </BranchLayout>
  );
}
