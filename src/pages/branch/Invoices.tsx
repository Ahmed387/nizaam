import { ContactLookup } from "@/components/ContactLookup";
import { PermTable } from "@/components/PermTable";
import { DocAnnotationsButton } from "@/components/DocAnnotationsDialog";
import { PermPart, usePartVisible } from "@/contexts/PermCustomize";
import { applyCairoRange, cairoTodayDay } from "@/lib/cairoDate";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NumberedPagination } from "@/components/NumberedPagination";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { Link, useParams, useSearchParams, useNavigate } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PermGate } from "@/components/ProtectedRoute";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CancelInvoiceDialog } from "@/components/CancelInvoiceDialog";
import { CancelPurchaseDialog } from "@/components/CancelPurchaseDialog";
import { formatEGP, formatDate, formatDateTime } from "@/lib/format";
import { Plus, ShoppingCart, PackagePlus, PackageCheck, AlertTriangle, RotateCcw, Undo2, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, FileText, ClipboardList, FileSpreadsheet, Printer, Search, X, Eye, Pencil, XCircle, Calendar as CalendarIcon, Check, ChevronDown, ChevronsUpDown } from "lucide-react";
import { exportToExcel, printReport } from "@/lib/export";
import { fetchAllRows } from "@/lib/fetchAll";
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
import { CancelReturnButton, CancelReturnDialog, type CancelReturnTarget } from "@/components/CancelReturnButton";
import { InlineVoucherDate } from "@/components/InlineVoucherDate";
import { ReturnEditDialog } from "@/components/ReturnEditDialog";
import { fetchDocumentPayView } from "@/lib/ledger";
import { methodsForFilter, SETTLE_COLS, type SalePayState } from "@/hooks/useSalesInvoices";
import { UnifiedDocumentFilters, EMPTY_DOCUMENT_FILTERS, type DocumentFilters } from "@/components/documents/UnifiedDocumentFilters";
import { UnifiedDocumentMetrics } from "@/components/documents/UnifiedDocumentMetrics";
import { TransferDetails } from "@/components/documents/TransferDetails";
import { MetricCardWithHint } from "@/components/MetricCardWithHint";
import { useDocumentMetrics } from "@/hooks/useDocumentMetrics";
import { enrichSettled, isDocKind, matchesDocCard, type DocCardKey } from "@/lib/documentMetrics";
import { ConvertClassDialog, type ClassTarget } from "@/components/documents/ConvertClassDialog";
import { BulkActionsBar } from "@/components/documents/BulkActionsBar";
import { AccountCell, SourceCell, PrintDocButton } from "@/components/documents/MoneyCells";
import { fetchTreasuryLinks, payMethodLabel, SRC_LABEL, srcPath } from "@/lib/treasuryLinks";
import type { BulkKind } from "@/lib/bulkDocs";

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
const FILTERS: Record<TabKey, { search?: boolean; date?: boolean; status?: boolean; amount?: boolean; payment?: boolean; category?: boolean; transferBranch?: boolean; party?: "customer" | "supplier"; settle?: boolean }> = {
  sale:            { search: true, date: true,                amount: true,  payment: true, settle: true },
  purchase:        { search: true, date: true,                amount: true,  payment: true, settle: true },
  sale_return:     { search: true, date: true,                amount: true, party: "customer" },
  purchase_return: { search: true, date: true,                amount: true, party: "supplier" },
  income:          { search: true, date: true,                amount: true, payment: true, category: true },
  expense:         { search: true, date: true,                amount: true, payment: true, category: true },
  transfer:        {              date: true, status: true,                                            transferBranch: true },
  quote:           { search: true, date: true, status: true,  amount: true },
};

type Filters = DocumentFilters;

/** Payment filter of the sale / purchase screens → the column of invoice_settlement / shipment_settlement. */
const SETTLE_PAY_COL: Record<string, string> = { cash: "cash", instapay: "instapay", wallet: "wallet", bank: "bank", account: "from_account", return: "from_return" };
const EMPTY_FILTERS: Filters = EMPTY_DOCUMENT_FILTERS;

export default function Invoices() {
  const { id: branchId } = useParams<{ id: string }>();
  const { branches, isAdmin, hasRole, tenantId, user, profile, can } = useAuth();
  const isManager = hasRole("branch_manager");
  // No hard delete (owner rule): sale and purchase invoices are cancelled, never deleted.
  const [cancelSale, setCancelSale] = useState<any>(null);
  const [cancelPurchase, setCancelPurchase] = useState<any>(null);
  const canCancelDoc = isAdmin || isManager;
  const [editVoucher, setEditVoucher] = useState<{ v: any; focus: boolean } | null>(null);
  const [selectedReturnForCancel, setSelectedReturnForCancel] = useState<CancelReturnTarget | null>(null);

  const [returnEdit, setReturnEdit] = useState<{ kind: "sale_return" | "purchase_return"; rec: any } | null>(null);
  // Voucher actions (income/expense tabs)
  const [viewVoucher, setViewVoucher] = useState<any>(null);
  const [cancelVoucher, setCancelVoucher] = useState<any>(null);
  const [cancelVoucherReason, setCancelVoucherReason] = useState("");
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);

  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const tabOn = usePartVisible("invoices");
  const askedTab = (params.get("tab") as TabKey) || "sale";
  // a document type hidden for this person (permissions 0114) falls back to the first one he can see
  const tab: TabKey = tabOn(`tab_${askedTab}`) ? askedTab : (TABS.find((t) => tabOn(`tab_${t.key}`))?.key ?? askedTab);
  // Cancelled documents never appear in the main table: they live in their own «الملغاة» view.
  const view: "active" | "cancelled" = params.get("view") === "cancelled" ? "cancelled" : "active";
  const hasCancelledView = isDocKind(tab) || tab === "transfer";
  const setView = (v: "active" | "cancelled") => {
    const next = new URLSearchParams(params);
    if (v === "cancelled") next.set("view", "cancelled"); else next.delete("view");
    setParams(next);
  };
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


  // ===== Server-side pagination engine =====
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const tableTopRef = useRef<HTMLDivElement>(null);
  // 300ms debounce on the text search; other filters apply instantly.
  const [debounced, setDebounced] = useState({ q: filters.q, recipient: filters.recipient, notes: filters.notes });
  useEffect(() => { const t = setTimeout(() => setDebounced({ q: filters.q, recipient: filters.recipient, notes: filters.notes }), 300); return () => clearTimeout(t); }, [filters.q, filters.recipient, filters.notes]);
  const queryFilters = useMemo(() => ({ ...filters, ...debounced }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify({ ...filters, q: "", recipient: "", notes: "" }), JSON.stringify(debounced)]);
  useEffect(() => { setPage(1); }, [tab, branchId, queryFilters]);
  // Paid / open of a past period is shown as of the period's last day (the ledger rule replayed to that day).
  const statusAsOf = queryFilters.to && queryFilters.to < cairoTodayDay() ? queryFilters.to : null;

  /** Applies every active filter directly to the Supabase query (database-level). */
  const buildQuery = useCallback(async (select: string, withCount: boolean) => {
    const f = queryFilters;
    const q = f.q.trim().replace(/[,()%*]/g, " ").trim();
    const opts = withCount ? { count: "exact" as const } : undefined;
    const looksLikeDocumentNumber = /\d/.test(q) || /^(IN|SH|RT|PR|RV|PV|QT)/i.test(q);
    const contactSearch = `name.ilike.%${q}%,phone.ilike.%${q}%`;
    const inList = (ids: string[]) => `(${(ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).join(",")})`;
    /** dateOnly = true for SQL `date` columns; timestamps get Cairo 00:00 → 23:59:59.999. */
    const dateRange = (qb: any, col: string, dateOnly: boolean) => applyCairoRange(qb, col, f.from, f.to, dateOnly);
    const clean = (v: string) => v.trim().replace(/[,()%*]/g, " ").trim();
    const textCols = (qb: any, recipientCol: string | null, notesCol: string | null) => {
      const rc = clean(f.recipient), nc = clean(f.notes);
      if (rc && recipientCol) qb = qb.ilike(recipientCol, `%${rc}%`);
      if (nc && notesCol) qb = qb.ilike(notesCol, `%${nc}%`);
      return qb;
    };
    const amountRange = (qb: any, col: string) => {
      if (f.amountMin) qb = qb.gte(col, Number(f.amountMin));
      if (f.amountMax) qb = qb.lte(col, Number(f.amountMax));
      return qb;
    };
    let qb: any;
    if (tab === "sale" || tab === "purchase") {
      // How each document was settled (0083) comes embedded one-to-one; its filters run in the database.
      const settleOn = Boolean(f.settleClass || f.payState || f.payment);
      const embed = `settle:${tab === "sale" ? "invoice_settlement" : "shipment_settlement"}${settleOn ? "!inner" : ""}(${SETTLE_COLS})`;
      const projection = q && !looksLikeDocumentNumber ? `${select}, ${embed}, search_contact:contact_id!inner(id)` : `${select}, ${embed}`;
      qb = supabase.from(tab === "sale" ? "invoices" : "shipments").select(projection, opts).eq("branch_id", branchId!);
      if (q) qb = looksLikeDocumentNumber
        ? (tab === "sale" ? qb.ilike("invoice_number", `%${q}%`) : qb.or(`shipment_number.ilike.%${q}%,received_by.ilike.%${q}%`))
        : qb.or(contactSearch, { referencedTable: "search_contact" });
      qb = dateRange(qb, "invoice_date", false);
      qb = amountRange(qb, tab === "sale" ? "total" : "total_cost");
      qb = tab === "sale" ? textCols(qb, "recipient_name", "notes") : textCols(qb, "received_by", "notes");
      if (f.status) qb = qb.eq("status", f.status);
      if (f.settleClass) qb = qb.eq("settle.class", f.settleClass);
      if (f.payState) qb = qb.eq("settle.state", f.payState);
      if (f.payment && SETTLE_PAY_COL[f.payment]) qb = qb.gt(`settle.${SETTLE_PAY_COL[f.payment]}`, 0);
      qb = qb.order("invoice_date", { ascending: false }).order("created_at", { ascending: false });
    } else if (tab === "sale_return") {
      const projection = q && !looksLikeDocumentNumber ? `${select}, search_invoice:invoice_id!inner(search_contact:contact_id!inner(id))` : select;
      qb = supabase.from("returns").select(projection, opts).eq("branch_id", branchId!);
      if (q) qb = looksLikeDocumentNumber
        ? qb.or(`return_number.ilike.%${q}%,reason.ilike.%${q}%`)
        : qb.or(contactSearch, { referencedTable: "search_invoice.search_contact" });
      if (f.partyId) {
        const invs = await fetchAllRows<any>(() => supabase.from("invoices").select("id").eq("branch_id", branchId!).eq("contact_id", f.partyId).order("id"));
        qb = qb.in("invoice_id", (invs ?? []).map((i: any) => i.id).concat(["00000000-0000-0000-0000-000000000000"]));
      }
      if (f.status) qb = qb.eq("status", f.status);
      qb = dateRange(qb, "invoice_date", false); qb = amountRange(qb, "total_refund"); qb = textCols(qb, "recipient_name", "notes");
      qb = qb.order("invoice_date", { ascending: false }).order("created_at", { ascending: false });
    } else if (tab === "purchase_return") {
      const projection = q && !looksLikeDocumentNumber ? `${select}, search_contact:contact_id!inner(id)` : select;
      qb = supabase.from("purchase_returns" as any).select(projection, opts).eq("branch_id", branchId!);
      if (q) qb = looksLikeDocumentNumber
        ? qb.or(`return_number.ilike.%${q}%,reason.ilike.%${q}%`)
        : qb.or(contactSearch, { referencedTable: "search_contact" });
      if (f.partyId) qb = qb.eq("contact_id", f.partyId);
      if (f.status) qb = qb.eq("status", f.status);
      qb = dateRange(qb, "invoice_date", false); qb = amountRange(qb, "total_amount"); qb = textCols(qb, "recipient_name", "notes");
      qb = qb.order("invoice_date", { ascending: false }).order("created_at", { ascending: false });
    } else if (tab === "income" || tab === "expense") {
      qb = supabase.from("vouchers" as any).select(select, opts).eq("branch_id", branchId!)
        .eq("type", tab === "income" ? "receipt" : "payment");
      // Cancelled vouchers stay visible (badge + their own card); every money card counts active only.
      if (f.status) qb = qb.eq("status", f.status);
      if (q) qb = qb.or(`voucher_number.ilike.%${q}%,description.ilike.%${q}%,party_name.ilike.%${q}%`);
      qb = dateRange(qb, "voucher_date", true); qb = amountRange(qb, "amount"); qb = textCols(qb, "recipient_name", "description");
      if (f.payment) qb = qb.in("payment_method", methodsForFilter(f.payment));
      if (f.categoryId) qb = qb.eq("category_id", f.categoryId);
      qb = qb.order("voucher_date", { ascending: false }).order("created_at", { ascending: false });
    } else if (tab === "transfer") {
      qb = supabase.from("stock_transfers").select(select, opts).or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`);
      qb = dateRange(qb, "transfer_date", true); qb = textCols(qb, "recipient_name", "notes");
      if (f.status) qb = qb.eq("status", f.status);
      if (f.fromBranch) qb = qb.eq("from_branch_id", f.fromBranch);
      if (f.toBranch) qb = qb.eq("to_branch_id", f.toBranch);
      qb = qb.order("transfer_date", { ascending: false }).order("created_at", { ascending: false });
    } else {
      const projection = q && !looksLikeDocumentNumber ? `${select}, search_contact:contact_id!inner(id)` : select;
      qb = supabase.from("quotes" as any).select(projection, opts).eq("branch_id", branchId!);
      if (q) qb = looksLikeDocumentNumber
        ? qb.or(`quote_number.ilike.%${q}%,customer_name.ilike.%${q}%`)
        : qb.or(contactSearch, { referencedTable: "search_contact" });
      qb = dateRange(qb, "created_at", false); qb = amountRange(qb, "total");
      if (f.status) qb = qb.eq("status", f.status);
      qb = qb.order("created_at", { ascending: false });
    }
    // Active view never shows cancelled documents; the «الملغاة» view shows only them.
    if (isDocKind(tab)) qb = view === "cancelled" ? qb.eq("status", "cancelled") : qb.neq("status", "cancelled");
    else if (tab === "transfer") qb = view === "cancelled" ? qb.eq("status", "rejected") : qb.neq("status", "rejected");
    // Wrap: PostgREST builders are thenables — returning one from an async fn would execute it.
    return { qb };
  }, [tab, branchId, queryFilters, view]);

  const SELECTS: Record<TabKey, string> = {
    sale: "*, contacts:contact_id(name)",
    purchase: "*, contacts:contact_id(name)",
    sale_return: "*, invoices(invoice_number, invoice_date, contact_id, contacts:contact_id(name, phone))",
    purchase_return: "*, contacts:contact_id(name, phone), shipments(shipment_number)",
    income: "*, voucher_categories(name, system_key)",
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
    const joinedDupes = false;
    if (tab === "income" || tab === "expense") {
      // what each voucher paid (0097): invoices it settled and what is still on account
      const split = new Map<string, any>();
      if (data.length) {
        const { data: sp } = await supabase.rpc("voucher_money_split" as any, { p_ids: data.map((v: any) => v.id) } as any).abortSignal(ctrl.signal);
        for (const x of (sp ?? []) as any[]) split.set(x.voucher_id, x);
        if (stale()) return;
      }
      data = data.map((v: any) => {
        const x = split.get(v.id);
        return {
          ...v,
          __enteredAt: v.created_at,
          created_at: v.voucher_date ?? v.created_at,
          category: v.voucher_categories?.name ?? "—",
          description: v.description ?? v.voucher_number,
          __inLedger: !!x?.in_ledger, __alloc: Number(x?.allocated) || 0, __onAcc: Number(x?.on_account) || 0, __docs: x?.docs ?? null,
        };
      });
      // «اسم الحساب» / «المصدر»: an automatic voucher takes the customer / supplier of its document (0099)
      const links = await fetchTreasuryLinks(data.map((v: any) => v.treasury_id), ctrl.signal).catch(() => new Map());
      if (stale()) return;
      data = data.map((v: any) => {
        const l: any = v.treasury_id ? links.get(v.treasury_id) : null;
        return { ...v, __link: l ?? null, __account: l?.account_name ?? v.party_name ?? null };
      });
    }
    if ((tab === "sale" || tab === "purchase") && data.length) {
      // Paid / remaining from the unified ledger (as of the period's last day for a past period);
      // «التصنيف» and the payment columns from the document's settlement row (0083).
      // a past period: status AND the method columns as of its last day (0091); later money is a note on the row
      const pv = await fetchDocumentPayView(tab === "sale" ? "invoice" : "shipment", data.map((x: any) => x.id), statusAsOf, ctrl.signal)
        .catch(() => ({ status: new Map(), asOf: new Map() }));
      if (stale()) return;
      data = data.map((x: any) => enrichSettled(x, tab === "sale" ? x.total : x.total_cost, pv.status.get(x.id), pv.asOf.get(x.id)));
    }
    setRows(data);
    if (joinedDupes) {
      // Exact distinct-invoice count for the joined query (r.count would count join rows).
      const { qb: cq } = await buildQuery("id", false);
      const idRows = await fetchAllRows<{ id: string }>(() => cq.abortSignal(ctrl.signal)).catch(() => [] as { id: string }[]);
      if (stale()) return;
      setTotalCount(new Set(idRows.map((x) => x.id)).size);
    } else {
      setTotalCount(r.count ?? data.length);
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, branchId, page, buildQuery]);

  const [metricsTick, setMetricsTick] = useState(0);
  const docKind = isDocKind(tab) ? tab : null;
  const { metrics: docMetrics, loading: docMetricsLoading } = useDocumentMetrics(docKind, buildQuery, { branchId, from: queryFilters.from, to: queryFilters.to }, metricsTick);
  const [transferMetrics, setTransferMetrics] = useState({ totalCount: 0, totalQuantity: 0, confirmedCount: 0, confirmedQuantity: 0, unresolvedCount: 0, unresolvedQuantity: 0, totalValue: 0, acceptedValue: 0, rejectedValue: 0, pendingValue: 0 });
  // value of each transfer at the sender's moving average (0080), shared by the cards, the column and the details row
  const [transferValues, setTransferValues] = useState<Record<string, { unit: number; sent: number; received: number; rejected: number }>>({});
  const [transferMetricsLoading, setTransferMetricsLoading] = useState(false);
  useEffect(() => {
    if (tab !== "transfer" || !branchId) return;
    let active = true;
    setTransferMetricsLoading(true);
    (async () => {
      const all: any[] = [];
      const pageSize = 1000;
      for (let from = 0; from < 100_000; from += pageSize) {
        const { qb } = await buildQuery("id, quantity, status", false);
        const { data, error } = await qb.order("id").range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = data ?? [];
        all.push(...batch);
        if (batch.length < pageSize) break;
      }
      if (!active) return;
      const vals: Record<string, { unit: number; sent: number; received: number; rejected: number }> = {};
      const ids = all.map((r) => r.id);
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 1000) chunks.push(ids.slice(i, i + 1000));
      await Promise.all(chunks.map(async (chunk) => {
        const { data } = await supabase.rpc("stock_transfer_values" as any, { p_ids: chunk } as any);
        for (const v of (data ?? []) as any[]) vals[v.transfer_id] = { unit: Number(v.unit_cost) || 0, sent: Number(v.sent_value) || 0, received: Number(v.received_value) || 0, rejected: Number(v.rejected_value) || 0 };
      }));
      if (!active) return;
      setTransferValues(vals);
      const r2v = (x: number) => Math.round(x * 100) / 100;
      const sumV = (items: any[], f: (v: { sent: number; received: number; rejected: number }) => number) => r2v(items.reduce((s2, row) => s2 + (vals[row.id] ? f(vals[row.id]) : 0), 0));
      const summarize = (items: any[]) => ({ count: items.length, quantity: items.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0) });
      const total = summarize(all);
      const confirmed = summarize(all.filter((row) => row.status === "confirmed"));
      const unresolved = summarize(all.filter((row) => row.status === "rejected" || row.status === "pending"));
      setTransferMetrics({
        totalCount: total.count,
        totalQuantity: total.quantity,
        confirmedCount: confirmed.count,
        confirmedQuantity: confirmed.quantity,
        unresolvedCount: unresolved.count,
        unresolvedQuantity: unresolved.quantity,
        totalValue: sumV(all, (v) => v.sent),
        acceptedValue: sumV(all.filter((row) => row.status === "confirmed"), (v) => v.received),
        rejectedValue: sumV(all.filter((row) => row.status === "rejected"), (v) => v.rejected),
        pendingValue: sumV(all.filter((row) => row.status === "pending"), (v) => v.sent),
      });
    })().catch((error) => {
      if (active) toast.error(error?.message ?? "تعذر تحميل ملخص التحويلات");
    }).finally(() => {
      if (active) setTransferMetricsLoading(false);
    });
    return () => { active = false; };
  }, [tab, branchId, buildQuery, metricsTick]);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["invoices", "invoice_payments", "shipments", "returns", "purchase_returns", "vouchers", "stock_transfers"], () => setMetricsTick((t) => t + 1));
  useRealtimeRefresh(["invoices", "invoice_payments", "shipments", "returns", "purchase_returns", "vouchers", "stock_transfers", "quotes", "stock_adjustments"], load);

  const branchName = (bid?: string) => branches.find((b) => b.id === bid)?.name ?? bid ?? "—";

  // Filtering now happens in the database; the current page is what we show.
  const enrichedRows = rows;
  const [cardFilter, setCardFilter] = useState<DocCardKey | null>(null);
  useEffect(() => { setCardFilter(null); }, [tab, branchId, view]);
  // «تحويل لنقدي / لآجل» (0093): one invoice from its badge, or a selection of the page
  const canConvert = (tab === "sale" || tab === "purchase") && can("doc_class.update");
  // Selection + bulk actions on every document tab (open as tabs, print, export, edit, cancel, convert).
  // It survives paging («تحديد كل النتائج» spans pages) and clears when the tab / filters change.
  const bulkKind: BulkKind | null = (["sale", "purchase", "sale_return", "purchase_return", "income", "expense"] as const).includes(tab as any) ? tab as BulkKind : null;
  const [selected, setSelected] = useState<Map<string, any>>(new Map());
  const [convert, setConvert] = useState<{ ids: string[]; target: ClassTarget } | null>(null);
  useEffect(() => { setSelected(new Map()); }, [tab, branchId, view, queryFilters]);
  const toggleSel = (r: any) => setSelected((prev) => { const n = new Map(prev); if (n.has(r.id)) n.delete(r.id); else n.set(r.id, r); return n; });
  const filteredRows = useMemo(() => docKind && cardFilter ? enrichedRows.filter((r: any) => matchesDocCard(docKind, r, cardFilter)) : enrichedRows, [enrichedRows, cardFilter, docKind]);
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

  /** The shared columns of the sale / purchase tables: «التصنيف», paid / remaining, «حالة السداد», then how it was paid. */
  const settleColumns = (k: "sale" | "purchase") => [
    { key: "__class", header: "التصنيف", align: "center", className: "min-w-[90px]", render: (r: any) => r.status === "cancelled" ? <span className="text-muted-foreground">—</span>
        : canConvert ? (
          <button type="button" title={r.__class === "cash" ? "تحويل لآجل" : "تحويل لنقدي"} className="rounded-full hover:ring-2 hover:ring-primary/40"
                  onClick={(e) => { e.stopPropagation(); setConvert({ ids: [r.id], target: r.__class === "cash" ? "credit" : "cash" }); }}>
            <ClassBadge value={r.__class} />
          </button>
        ) : <ClassBadge value={r.__class} /> },
    { key: "__paid_rem", header: "المدفوع / المتبقي", align: "center", className: "min-w-[150px]", render: (r: any) => r.status !== "cancelled" ? (
      <span className="flex flex-col items-center gap-1 text-xs tabular-nums leading-tight">
        <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-0.5 font-bold text-success">
          <span className="text-[10px] font-extrabold text-muted-foreground">مدفوع</span>
          {formatEGP(r.__paid ?? 0)}
        </span>
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-bold ${Number(r.__remaining) > 0 ? "bg-warning/10 text-warning" : "text-muted-foreground"}`}>
          <span className="text-[10px] font-extrabold text-muted-foreground">متبقي</span>
          {formatEGP(r.__remaining ?? 0)}
        </span>
        {Number(r.__after) > 0.01 && (
          <span className="text-[10px] text-info font-semibold whitespace-nowrap" title="اتدفع بعد آخر يوم في الفترة — مش محسوب في المدفوع ولا في أعمدة طريقة الدفع">
            اتدفع بعد الفترة {formatEGP(r.__after)}{r.__afterFrom ? ` من ${formatDate(r.__afterFrom)}` : ""}
          </span>
        )}
      </span>
    ) : <span className="text-muted-foreground">—</span> },
    { key: "__pay_state", header: "حالة السداد", align: "center", className: "min-w-[130px]", render: (r: any) => r.status !== "cancelled" ? <SalePayBadge state={r.__payState} remaining={Number(r.__remaining) || 0} /> : <span className="text-muted-foreground">—</span> },
    { key: "__b_cash", header: "كاش", align: "center", className: "min-w-[100px]", numeric: true, render: (r: any) => bucketCell(r.__byBucket?.cash) },
    { key: "__b_instapay", header: "انستاباي", align: "center", className: "min-w-[100px]", numeric: true, render: (r: any) => bucketCell(r.__byBucket?.instapay) },
    { key: "__b_wallet", header: "محفظة", align: "center", className: "min-w-[100px]", numeric: true, render: (r: any) => bucketCell(r.__byBucket?.wallet) },
    { key: "__b_bank", header: "بنكي", align: "center", className: "min-w-[100px]", numeric: true, render: (r: any) => bucketCell(r.__byBucket?.bank) },
    { key: "__b_account", header: k === "sale" ? "من تحت حسابه" : "من تحت حسابنا", align: "center", className: "min-w-[110px]", numeric: true, render: (r: any) => bucketCell(r.__byBucket?.account) },
    { key: "__b_other", header: "من مرتجع", align: "center", className: "min-w-[100px]", numeric: true, render: (r: any) => bucketCell(r.__byBucket?.other) },
  ];
  const bucketCell = (v: number | undefined) => Number(v) > 0 ? <span className="tabular-nums">{formatEGP(Number(v))}</span> : <span className="text-muted-foreground">—</span>;
  const textCell = (v: any) => v ? <span className="block truncate max-w-[12rem] mx-auto" title={String(v)}>{v}</span> : <span className="text-muted-foreground">—</span>;
  const statusCell = (r: any) => r.status === "cancelled"
    ? <span className="font-semibold text-destructive" title={r.cancel_reason ?? undefined}>ملغي</span>
    : <span>نشط</span>;
  /** Which method column a payment method belongs to (same four columns as the sale table). */
  const methodBucket = (m?: string | null): "cash" | "instapay" | "wallet" | "bank" => {
    const v = String(m ?? "cash").toLowerCase();
    if (v.includes("insta")) return "instapay";
    if (v.includes("vodafone") || v.includes("wallet") || v.includes("etisalat") || v.includes("orange")) return "wallet";
    if (v.includes("bank") || v.includes("transfer") || v.includes("visa")) return "bank";
    return "cash";
  };
  const methodCols = (pick: (r: any) => Record<string, number>) => ([
    { key: "__m_cash", header: "كاش", align: "center", className: "min-w-[100px]", numeric: true, render: (r: any) => bucketCell(pick(r).cash) },
    { key: "__m_instapay", header: "انستاباي", align: "center", className: "min-w-[100px]", numeric: true, render: (r: any) => bucketCell(pick(r).instapay) },
    { key: "__m_wallet", header: "محفظة", align: "center", className: "min-w-[100px]", numeric: true, render: (r: any) => bucketCell(pick(r).wallet) },
    { key: "__m_bank", header: "بنكي", align: "center", className: "min-w-[100px]", numeric: true, render: (r: any) => bucketCell(pick(r).bank) },
  ]);
  /** A return's refund: money given back (cash / transfer by method) and what went to his account. */
  const returnSplit = (r: any) => {
    const cash = Number(r.refund_cash_amount) || 0, transfer = Number(r.refund_transfer_amount) || 0;
    const b: Record<string, number> = { cash: 0, instapay: 0, wallet: 0, bank: 0 };
    b.cash += cash;
    if (transfer > 0) { const k = methodBucket(r.refund_method); b[k === "cash" ? "bank" : k] += transfer; }
    return { out: cash + transfer, account: Number(r.refund_balance_amount) || 0, buckets: b };
  };
  const returnColumns = (k: "sale_return" | "purchase_return") => [
    { key: "__class", header: "التصنيف", align: "center", className: "min-w-[90px]", render: (r: any) => {
      if (r.status === "cancelled") return <span className="text-muted-foreground">—</span>;
      const x = returnSplit(r);
      const [t, c] = x.out > 0.005 && x.account <= 0.005 ? ["نقدي", "bg-success/10 text-success"]
        : x.out <= 0.005 ? ["على الحساب", "bg-warning/10 text-warning"] : ["نقدي + حساب", "bg-info/10 text-info"];
      return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${c}`}>{t}</span>;
    } },
    { key: "__refund_split", header: k === "sale_return" ? "اترد له / على حسابه" : "رجعلنا / على حسابنا", align: "center", className: "min-w-[150px]", render: (r: any) => {
      if (r.status === "cancelled") return <span className="text-muted-foreground">—</span>;
      const x = returnSplit(r);
      return (
        <span className="flex flex-col items-center gap-1 text-xs tabular-nums leading-tight">
          <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-0.5 font-bold text-success">
            <span className="text-[10px] font-extrabold text-muted-foreground">{k === "sale_return" ? "اترد" : "رجع"}</span>{formatEGP(x.out)}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-bold ${x.account > 0 ? "bg-warning/10 text-warning" : "text-muted-foreground"}`}>
            <span className="text-[10px] font-extrabold text-muted-foreground">حساب</span>{formatEGP(x.account)}
          </span>
        </span>
      );
    } },
    ...methodCols((r: any) => r.status === "cancelled" ? {} : returnSplit(r).buckets),
    { key: "__r_account", header: k === "sale_return" ? "على حسابه" : "على حسابنا عنده", align: "center", className: "min-w-[110px]", numeric: true, render: (r: any) => bucketCell(r.status === "cancelled" ? 0 : returnSplit(r).account) },
  ];
  const cfg = useMemo(() => {
    const base = `/branch/${branchId}`;
    switch (tab) {
      case "sale": return {
        newLink: `${base}/sales/new`, newLabel: "فاتورة بيع جديدة", newPerm: "sales.create",
        columns: [
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
          { key: "customer", header: "العميل", align: "right", className: "min-w-[190px] text-right", render: (r: any) => {
            const name = r.contacts?.name ?? "نقدي";
            return <span className="block max-w-[190px] truncate font-semibold" title={name}>{name}</span>;
          } },
          { key: "total", header: "المبلغ", align: "center", className: "min-w-[110px]", numeric: true, render: (r: any) => formatEGP(r.total) },
          ...settleColumns("sale"),
          { key: "status", header: "الحالة", align: "center", className: "min-w-[80px]", render: (r: any) => r.status === "active" ? "نشطة" : "ملغاة" },
          { key: "__recipient", header: "المستلم", align: "center", className: "min-w-[120px]", render: (r: any) => textCell(r.recipient_name) },
          { key: "__notes", header: "الملاحظات", align: "center", className: "min-w-[150px]", render: (r: any) => textCell(r.notes) },
          { key: "invoice_date", header: "تاريخ الفاتورة", align: "center", className: "min-w-[150px]", render: (r: any) => <EditableInvoiceDate table="invoices" recordId={r.id} value={r.invoice_date} fallback={r.created_at} onSaved={() => load()} /> },
          {
            key: "actions", header: "إجراءات", align: "center", width: "15rem", render: (r: any) => (
              <div className="flex items-center justify-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="عرض / إدارة" onClick={() => nav(`${base}/sales/${r.id}`)}>
                  <Eye className="w-4 h-4" />
                </Button>
                <PrintDocButton kind="sale" id={r.id} title="طباعة الفاتورة" />
                {can("sales.create") && r.status === "active" && (
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="تعديل الفاتورة" onClick={() => nav(`${base}/sales/${r.id}/edit`)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                )}
                <DocAnnotationsButton kind="invoice" id={r.id} recipient={r.recipient_name} notes={r.notes} onSaved={() => load()} />
                <AttachmentsDialogButton recordType="invoice" recordId={r.id} count={attCounts[r.id] ?? 0} />
                {canCancelDoc && r.status === "active" && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" title="إلغاء الفاتورة (مع رد المدفوع)" onClick={() => setCancelSale(r)}>
                    <XCircle className="w-4 h-4" />
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
          { key: "shipment_number", header: "رقم", align: "center", width: "8rem", render: (r: any) => (
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
          { key: "supplier", header: "المورد", align: "right", className: "min-w-[190px] text-right", render: (r: any) => {
            const name = r.contacts?.name ?? "—";
            return <span className="block max-w-[190px] truncate font-semibold" title={name}>{name}</span>;
          } },
          { key: "total_cost", header: "المبلغ", align: "center", className: "min-w-[110px]", numeric: true, render: (r: any) => formatEGP(r.total_cost) },
          ...settleColumns("purchase"),
          { key: "status", header: "الحالة", align: "center", className: "min-w-[80px]", render: (r: any) => r.status === "cancelled" ? <span className="text-destructive font-semibold" title={r.cancel_reason ?? undefined}>ملغاة</span> : "نشطة" },
          { key: "__recipient", header: "المستلم", align: "center", className: "min-w-[120px]", render: (r: any) => textCell(r.received_by) },
          { key: "__notes", header: "الملاحظات", align: "center", className: "min-w-[150px]", render: (r: any) => textCell(r.notes) },
          { key: "invoice_date", header: "تاريخ الفاتورة", align: "center", className: "min-w-[150px]", render: (r: any) => <EditableInvoiceDate table="shipments" recordId={r.id} value={r.invoice_date} fallback={r.created_at} onSaved={() => load()} /> },
          { key: "arrival_date", header: "تاريخ الوصول", align: "center", className: "min-w-[110px]", render: (r: any) => formatDate(r.arrival_date) },
          {
            key: "actions", header: "إجراءات", align: "center", width: "15rem", render: (r: any) => (
              <div className="flex items-center justify-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="عرض / تعديل" onClick={() => nav(`${base}/shipments/${r.id}`)}>
                  <Eye className="w-4 h-4" />
                </Button>
                <PrintDocButton kind="purchase" id={r.id} title="طباعة الفاتورة" />
                {can("shipments.create") && (r.status ?? "active") === "active" && (
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="تعديل الفاتورة" onClick={() => nav(`${base}/shipments/${r.id}/edit`)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                )}
                <DocAnnotationsButton kind="shipment" id={r.id} recipient={r.received_by} notes={r.notes} onSaved={() => load()} />
                <AttachmentsDialogButton recordType="shipment" recordId={r.id} count={attCounts[r.id] ?? 0} />
                {canCancelDoc && (r.status ?? "active") === "active" && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" title={isAdmin ? "إلغاء فاتورة الشراء" : "طلب إلغاء"} onClick={() => setCancelPurchase(r)}>
                    <XCircle className="w-4 h-4" />
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
          { key: "return_number", header: "رقم", align: "center", width: "8rem", render: (r: any) => (
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
          { key: "customer", header: "العميل", align: "right", className: "min-w-[190px] text-right", render: (r: any) => {
            const name = r.invoices?.contacts?.name ?? "نقدي";
            return <span className="block max-w-[190px] truncate font-semibold" title={name}>{name}</span>;
          } },
          { key: "inv", header: "رقم الفاتورة", align: "center", className: "min-w-[100px]", render: (r: any) => <span className="font-mono">{r.invoices?.invoice_number ?? "—"}</span> },
          { key: "reason", header: "السبب", align: "center", className: "min-w-[130px]", render: (r: any) => textCell(r.reason) },
          { key: "total_refund", header: "المبلغ", align: "center", className: "min-w-[110px]", numeric: true, render: (r: any) => formatEGP(r.total_refund) },
          ...returnColumns("sale_return"),
          { key: "status", header: "الحالة", align: "center", className: "min-w-[80px]", render: statusCell },
          { key: "__recipient", header: "المستلم", align: "center", className: "min-w-[120px]", render: (r: any) => textCell(r.recipient_name) },
          { key: "__notes", header: "الملاحظات", align: "center", className: "min-w-[150px]", render: (r: any) => textCell(r.notes) },
          { key: "invoice_date", header: "تاريخ المرتجع", align: "center", className: "min-w-[150px]", render: (r: any) => <EditableInvoiceDate table="returns" recordId={r.id} value={r.invoice_date} fallback={r.created_at} onSaved={() => load()} /> },
          {
            key: "actions", header: "إجراءات", align: "center", width: "15rem", render: (r: any) => (
              <div className="flex items-center justify-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="عرض" onClick={() => nav(`${base}/sale-returns/${r.id}`)}>
                  <Eye className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="تعديل التاريخ والمستلم والملاحظات" onClick={() => setReturnEdit({ kind: "sale_return", rec: r })}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <PrintDocButton kind="sale_return" id={r.id} title="طباعة المرتجع" />
                <DocAnnotationsButton kind="sale_return" id={r.id} recipient={r.recipient_name} notes={r.notes} onSaved={() => load()} />
                <AttachmentsDialogButton recordType="sale_return" recordId={r.id} count={attCounts[r.id] ?? 0} />
                <CancelReturnButton iconOnly kind="sale" returnId={r.id} returnNumber={r.return_number ?? ""} total={Number(r.total_refund ?? 0)} status={r.status ?? "active"} onRequest={setSelectedReturnForCancel} />
              </div>
            ),
          },
        ],
        onClick: (r: any) => nav(`${base}/sale-returns/${r.id}`),
      };
      case "purchase_return": return {
        newLink: `${base}/purchase-returns/new`, newLabel: "مرتجع شراء جديد", newPerm: "shipments.create",
        columns: [
          { key: "return_number", header: "رقم", align: "center", width: "8rem", render: (r: any) => (
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
          { key: "supplier", header: "المورد", align: "right", className: "min-w-[190px] text-right", render: (r: any) => {
            const name = r.contacts?.name ?? "—";
            return <span className="block max-w-[190px] truncate font-semibold" title={name}>{name}</span>;
          } },
          { key: "ship", header: "رقم الفاتورة", align: "center", className: "min-w-[100px]", render: (r: any) => <span className="font-mono">{r.shipments?.shipment_number ?? "—"}</span> },
          { key: "reason", header: "السبب", align: "center", className: "min-w-[130px]", render: (r: any) => textCell(r.reason) },
          { key: "total_amount", header: "المبلغ", align: "center", className: "min-w-[110px]", numeric: true, render: (r: any) => formatEGP(r.total_amount) },
          ...returnColumns("purchase_return"),
          { key: "status", header: "الحالة", align: "center", className: "min-w-[80px]", render: statusCell },
          { key: "__recipient", header: "المستلم", align: "center", className: "min-w-[120px]", render: (r: any) => textCell(r.recipient_name) },
          { key: "__notes", header: "الملاحظات", align: "center", className: "min-w-[150px]", render: (r: any) => textCell(r.notes) },
          { key: "invoice_date", header: "تاريخ المرتجع", align: "center", className: "min-w-[150px]", render: (r: any) => <EditableInvoiceDate table="purchase_returns" recordId={r.id} value={r.invoice_date} fallback={r.created_at} onSaved={() => load()} /> },
          {
            key: "actions", header: "إجراءات", align: "center", width: "15rem", render: (r: any) => (
              <div className="flex items-center justify-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="عرض" onClick={() => nav(`${base}/purchase-returns/${r.id}`)}>
                  <Eye className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="تعديل التاريخ والمستلم والملاحظات" onClick={() => setReturnEdit({ kind: "purchase_return", rec: r })}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <PrintDocButton kind="purchase_return" id={r.id} title="طباعة المرتجع" />
                <DocAnnotationsButton kind="purchase_return" id={r.id} recipient={r.recipient_name} notes={r.notes} onSaved={() => load()} />
                <AttachmentsDialogButton recordType="purchase_return" recordId={r.id} count={attCounts[r.id] ?? 0} />
                <CancelReturnButton iconOnly kind="purchase" returnId={r.id} returnNumber={r.return_number ?? ""} total={Number(r.total_amount ?? 0)} status={r.status ?? "active"} onRequest={setSelectedReturnForCancel} />
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
          // owner order 2026-10-16: رقم السند · اسم الحساب · المبلغ · التصنيف · طريقة الدفع · التاريخ · الحالة · المصدر · … · إجراءات
          { key: "voucher_number", header: "رقم السند", align: "center", width: "9rem", render: (r: any) => (
            <span className="inline-flex items-center justify-end gap-1.5">
              <button
                type="button"
                aria-label={expandedInvoiceId === r.id ? "إخفاء تفاصيل السند" : "عرض تفاصيل السند"}
                aria-expanded={expandedInvoiceId === r.id}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                onClick={(event) => { event.stopPropagation(); setExpandedInvoiceId((current) => current === r.id ? null : r.id); }}
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${expandedInvoiceId === r.id ? "rotate-180" : ""}`} />
              </button>
              <span className={`font-mono font-semibold ${r.status === "cancelled" ? "line-through text-muted-foreground" : "text-primary"}`}>{r.voucher_number ?? "—"}</span>
            </span>
          ) },
          { key: "__account", header: "اسم الحساب", align: "right", className: "min-w-[180px] text-right", render: (r: any) => <AccountCell name={r.__account} /> },
          { key: "amount", header: "المبلغ", align: "center", className: "min-w-[110px]", numeric: true, render: (r: any) => (
            <span className={`font-bold tabular-nums ${tab === "income" ? "text-success" : "text-destructive"}`}>{formatEGP(r.amount)}</span>
          ) },
          { key: "category", header: "التصنيف", align: "center", className: "min-w-[130px]", render: (r: any) => textCell(r.category) },
          { key: "payment_method", header: "طريقة الدفع", align: "center", className: "min-w-[100px]", render: (r: any) => payMethodLabel(r.payment_method) },
          { key: "created_at", header: "التاريخ", align: "center", className: "min-w-[120px]", render: (r: any) => r.voucher_date ? <InlineVoucherDate voucher={r} onSaved={() => load()} /> : formatDateTime(r.created_at) },
          { key: "status", header: "الحالة", align: "center", className: "min-w-[80px]", render: statusCell },
          { key: "__source", header: "المصدر", align: "center", className: "min-w-[150px]", render: (r: any) => <SourceCell link={r.__link} branchId={branchId!} source={r.source} /> },
          { key: "__recipient", header: "المستلم", align: "center", className: "min-w-[120px]", render: (r: any) => textCell(r.recipient_name) },
          { key: "description", header: "البيان", align: "center", className: "min-w-[200px]", render: (r: any) => textCell(r.description) },
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
                  <PrintDocButton kind={tab === "income" ? "income" : "expense"} id={r.id} title="طباعة السند" />
                  <DocAnnotationsButton kind="voucher" id={r.id} recipient={r.recipient_name} notes={r.description} onSaved={() => load()} />
<AttachmentsDialogButton recordType="voucher" recordId={r.id} count={attCounts[r.id] ?? 0} />
                  {canCancel && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-warning" title="إلغاء السند — يفضل ظاهر في السجلات كـ (ملغي) ويعكس أثره المحاسبي." onClick={() => setCancelVoucher(r)}>
                      <XCircle className="w-4 h-4" />
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
          { key: "from_branch_id", header: "من", align: "right", width: "11rem", render: (r: any) => (
            <span className="inline-flex items-center justify-end gap-1.5">
              <button
                type="button"
                aria-label={expandedInvoiceId === r.id ? "إخفاء تفاصيل التحويل" : "عرض تفاصيل التحويل"}
                aria-expanded={expandedInvoiceId === r.id}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                onClick={(event) => { event.stopPropagation(); setExpandedInvoiceId((current) => current === r.id ? null : r.id); }}
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${expandedInvoiceId === r.id ? "rotate-180" : ""}`} />
              </button>
              {branchName(r.from_branch_id)}
            </span>
          ) },
          { key: "to_branch_id", header: "إلى", align: "right", width: "10rem", render: (r: any) => branchName(r.to_branch_id) },
          {
            key: "status", header: "الحالة", align: "center", width: "7rem", render: (r: any) => (
              <Badge variant="outline" className={r.status === "confirmed"
                ? "border-success/40 bg-success/10 text-success"
                : r.status === "rejected"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-warning/40 bg-warning/10 text-warning"}>
                {r.status === "confirmed" ? "مؤكد" : r.status === "rejected" ? "مرفوض" : "معلق"}
              </Badge>
            ),
          },
          { key: "__value", header: "القيمة", align: "center", width: "9rem", render: (r: any) => {
            const v = transferValues[r.id];
            if (!v) return <span className="text-muted-foreground">—</span>;
            return (
              <div className="text-xs tabular-nums leading-5">
                <div className="font-bold text-sm">{formatEGP(v.sent)}</div>
                {r.status === "confirmed" && <div className="text-success">اتقبل {formatEGP(v.received)}</div>}
                {r.status === "rejected" && <div className="text-destructive">اترفض {formatEGP(v.rejected)}</div>}
                {r.status === "pending" && <div className="text-warning">معلق</div>}
              </div>
            );
          } },
{ key: "__recipient", header: "المستلم", align: "center", width: "9rem", render: (r: any) => textCell(r.recipient_name) },
          { key: "__notes", header: "الملاحظات", align: "center", width: "11rem", render: (r: any) => textCell(r.notes) },
          { key: "created_at", header: "التاريخ", align: "right", width: "10rem", render: (r: any) => r.transfer_date ? formatDate(r.transfer_date) : formatDateTime(r.created_at) },
          {
            key: "actions", header: "إجراءات", align: "center", width: "10rem", render: (r: any) => (
              <div className="flex items-center justify-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="عرض" onClick={() => nav(`${base}/transfers/${r.id}`)}>
                  <Eye className="w-4 h-4" />
                </Button>
                <DocAnnotationsButton kind="stock_transfer" id={r.id} recipient={r.recipient_name} notes={r.notes} onSaved={() => load()} />
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
  }, [tab, branchId, nav, branches, attCounts, canCancelDoc, isAdmin, isManager, expandedInvoiceId, transferValues]);

  const currentTabLabel = TABS.find((t) => t.key === tab)?.label ?? "";

  const [isExporting, setIsExporting] = useState(false);
  // Excel exports every document matching the active filters — not just the visible page.
  const handleExportExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    const t = toast.loading("جاري تصدير كافة البيانات...");
    let all: any[];
    try {
      const { qb } = await buildQuery(SELECTS[tab], false);
      all = await fetchAllRows<any>(() => qb.order("id"));
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر التصدير", { id: t });
      setIsExporting(false);
      return;
    }
    const settled = tab === "sale" || tab === "purchase";
    // same reading as the table: a past period as of its last day (0091)
    let pv: { status: Map<string, any>; asOf: Map<string, any> } = { status: new Map(), asOf: new Map() };
    if (settled) {
      try {
        pv = await fetchDocumentPayView(tab === "sale" ? "invoice" : "shipment", all.filter((x) => x.status !== "cancelled").map((x) => x.id), statusAsOf);
      } catch { /* the settlement row stays the fallback */ }
    }
    const BUCKET_KEY: Record<string, string> = { __b_cash: "cash", __b_instapay: "instapay", __b_wallet: "wallet", __b_bank: "bank", __b_account: "account", __b_other: "other" };
    const exportRows = all.map((raw) => {
      const r = settled ? enrichSettled(raw, tab === "sale" ? raw.total : raw.total_cost, pv.status.get(raw.id), pv.asOf.get(raw.id)) : raw;
      const out: any = {};
      for (const c of cfg.columns as any[]) {
        if (c.key === "actions") continue;
        let v: any;
        if (settled && BUCKET_KEY[c.key]) { out[c.header] = Number(r.__byBucket?.[BUCKET_KEY[c.key]]) || 0; continue; }
        if (settled && c.key === "__class") { out[c.header] = r.status === "cancelled" ? "" : r.__class === "cash" ? "نقدي" : "آجل"; continue; }
        if (settled && c.key === "__pay_state") { out[c.header] = r.status === "cancelled" ? "" : r.__payState === "paid" ? "مدفوعة بالكامل" : r.__payState === "partial" ? "سداد جزئي" : "لم يتم الدفع"; continue; }
        if (settled && c.key === "__paid_rem") {
          out["المدفوع"] = r.__paid ?? 0; out["المتبقي"] = r.__remaining ?? 0;
          if (statusAsOf) { out["اتدفع بعد الفترة"] = r.__after ?? 0; out["من يوم"] = r.__afterFrom ?? ""; }
          continue;
        }
        try { v = c.render ? c.render(r) : r[c.key]; } catch { v = r[c.key]; }
        if (v && typeof v === "object") v = r[c.key] ?? "";
        out[c.header] = v ?? "";
      }
      return out;
    });
    exportToExcel(currentTabLabel, [{ name: currentTabLabel, rows: exportRows }]);
    toast.success(`تم تصدير ${all.length} مستند`, { id: t });
    setIsExporting(false);
  };

  const handleExportPDF = async () => {
    if (isExporting) return;
    setIsExporting(true);
    const t = toast.loading("جاري تصدير كافة البيانات...");
    try {
      const { qb } = await buildQuery(SELECTS[tab], false);
      const all = await fetchAllRows<any>(() => qb.order("id"));
      await exportPdfRows(all);
      toast.success(`تم تجهيز ${all.length} مستند`, { id: t });
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر التصدير", { id: t });
    } finally {
      setIsExporting(false);
    }
  };

  const exportPdfRows = async (filteredRows: any[]) => {
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
    printReport(currentTabLabel, `<PermTable><thead>${head}</thead><tbody>${body}</tbody></PermTable>`);
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
      case "sale":
      case "purchase": return [{ value: "active", label: "نشطة" }, { value: "cancelled", label: "ملغاة" }];
      case "sale_return":
      case "purchase_return":
      case "income":
      case "expense": return [{ value: "active", label: "نشط" }, { value: "cancelled", label: "ملغي" }];
      case "transfer": return view === "cancelled" ? [] : [{ value: "pending", label: "معلق" }, { value: "confirmed", label: "مؤكد" }];
      case "quote": return [{ value: "draft", label: "مسودة" }, { value: "sent", label: "مُرسل" }, { value: "accepted", label: "مقبول" }, { value: "rejected", label: "مرفوض" }];
      default: return [];
    }
  }, [tab, view]);

  const paymentOptions = [
    { value: "cash", label: "كاش" },
    { value: "instapay", label: "انستاباي" },
    { value: "wallet", label: "محفظة" },
    { value: "bank", label: "بنكي" },
    ...(tab === "sale" ? [{ value: "account", label: "من تحت حسابه" }, { value: "return", label: "من مرتجع" }] : []),
    ...(tab === "purchase" ? [{ value: "account", label: "من تحت حسابنا عند المورد" }, { value: "return", label: "من مرتجع" }] : []),
  ];
  const classOptions = [{ value: "cash", label: "نقدي (اتدفعت كلها وقت البيع)" }, { value: "credit", label: "آجل" }];
  const payStateOptions = [{ value: "paid", label: "مدفوعة بالكامل" }, { value: "partial", label: "سداد جزئي" }, { value: "unpaid", label: "لم يتم الدفع" }];

  const hasAnyFilter =
    filters.q || filters.from || filters.to || filters.status ||
    filters.amountMin || filters.amountMax || filters.payment || filters.settleClass || filters.payState ||
    filters.categoryId || filters.fromBranch || filters.toBranch || filters.partyId || filters.recipient || filters.notes;

  // For return tabs: the text search stays draft until بحث/Enter; the status dropdown applies to the
  // table instantly (database-level, so pagination and the metric cards stay in step with the rows).
  const inputF = isReturnTab ? draftFilters : filters;
  const setInputF = (next: Filters) => {
    if (!isReturnTab) return setFilters(next);
    setDraftFilters(next);
    if (next.status !== draftFilters.status) setFilters((f) => ({ ...f, status: next.status }));
  };

  const applySearch = () => {
    setFilters(draftFilters);
    setSuggestOpen(false);
  };
  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    setDraftFilters(EMPTY_FILTERS);
    setSuggestOpen(false);
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


  return (
    <BranchLayout>
      <PageHeader
        title="الفواتير والمستندات"
        subtitle="كل فواتير ومستندات الفرع في مكان واحد"
        actions={
          <div className="flex flex-wrap gap-2">
            <PermPart page="invoices" part="excel_button"><Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!filteredRows.length || isExporting} className="gap-2">
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </Button></PermPart>
            <PermPart page="invoices" part="pdf_button"><Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!filteredRows.length || isExporting} className="gap-2">
              <Printer className="w-4 h-4" /> {pdfBtnLabel}
            </Button></PermPart>
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
          <PermPart key={t.key} page="invoices" part={`tab_${t.key}`}><button onClick={() => setTab(t.key)}
            className={`w-full h-full flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
              tab === t.key ? "border-primary bg-primary/5 shadow-md" : "border-border hover:border-primary/50"
            }`}>
            <t.icon className={`w-5 h-5 ${t.color}`} />
            <span className="text-[11px] font-semibold text-center leading-tight">{t.label}</span>
          </button></PermPart>
        ))}
      </div>

      {hasCancelledView && (
        <PermPart page="invoices" part="cancelled_view"><div className="flex items-center gap-2 mb-3" role="tablist" aria-label="عرض المستندات">
          {(["active", "cancelled"] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-full text-sm font-bold border transition-colors ${view === v
                ? (v === "cancelled" ? "bg-destructive text-destructive-foreground border-destructive" : "bg-primary text-primary-foreground border-primary")
                : "bg-background border-border text-muted-foreground hover:border-primary/50"}`}>
              {v === "active" ? (tab === "transfer" ? "التحويلات" : "المستندات النشطة") : (tab === "transfer" ? "المرفوضة" : "الملغاة")}
            </button>
          ))}
          {view === "cancelled" && <span className="text-xs text-muted-foreground">مستندات اتلغت وأثرها اتعكس بالكامل — للمراجعة بس، ومش داخلة في أي رقم.</span>}
        </div></PermPart>
      )}

      <PermPart page="invoices" part="filters"><UnifiedDocumentFilters
        title={currentTabLabel}
        shown={{ from: totalCount ? (page - 1) * PAGE_SIZE + 1 : 0, to: Math.min(page * PAGE_SIZE, totalCount), total: totalCount }}
        value={inputF}
        onChange={setInputF}
        onReset={() => { clearAll(); setCardFilter(null); }}
        hasAnyFilter={Boolean(hasAnyFilter || cardFilter)}
        showSearch={!!active.search}
        showDate={!!active.date}
        showAmount={!!active.amount}
        onSearchTyped={() => { if (isReturnTab) setSuggestOpen(true); }}
        searchInputProps={{
          onFocus: () => isReturnTab && setSuggestOpen(true),
          onBlur: () => setTimeout(() => setSuggestOpen(false), 150),
          onKeyDown: (e) => { if (e.key === "Enter" && isReturnTab) applySearch(); },
        }}
        searchAddon={<>
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
        </>}
        statusOptions={active.status ? statusOptions : undefined}
        paymentOptions={active.payment ? paymentOptions : undefined}
        classOptions={active.settle ? classOptions : undefined}
        payStateOptions={active.settle ? payStateOptions : undefined}
        customField={active.category ? (
          <UnifiedDocumentFilters.Field label="نوع السند / التصنيف">
            <UnifiedDocumentFilters.Select value={inputF.categoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => setInputF({ ...inputF, categoryId: v })} />
          </UnifiedDocumentFilters.Field>
        ) : tab !== "quote" ? (
          <UnifiedDocumentFilters.Field label={tab === "sale" ? "اسم المستلم / البائع" : "اسم المستلم"}>
            <Input value={inputF.recipient} onChange={(e) => setInputF({ ...inputF, recipient: e.target.value })} className="h-10 bg-background" placeholder="اسم المستلم" />
          </UnifiedDocumentFilters.Field>
        ) : undefined}
        extraFields={<>
          {active.party && (
            <div className="space-y-1">
              <Label className="text-xs">{active.party === "customer" ? "العميل" : "المورد"}</Label>
              <ContactLookup
                branchId={branchId}
                kind={active.party === "customer" ? "customer" : "supplier"}
                value={inputF.partyId}
                onChange={(id) => setInputF({ ...inputF, partyId: id })}
                placeholder="الكل"
                emptyLabel="الكل"
                triggerClassName="h-9"
              />
            </div>
          )}
          {active.category && (
            <UnifiedDocumentFilters.Field label="اسم المستلم">
              <Input value={inputF.recipient} onChange={(e) => setInputF({ ...inputF, recipient: e.target.value })} className="h-10 bg-background" placeholder="اسم المستلم" />
            </UnifiedDocumentFilters.Field>
          )}
          {tab !== "quote" && (
            <UnifiedDocumentFilters.Field label="بحث الملاحظات">
              <Input value={inputF.notes} onChange={(e) => setInputF({ ...inputF, notes: e.target.value })} className="h-10 bg-background" placeholder="نص في الملاحظات" />
            </UnifiedDocumentFilters.Field>
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
        </>}
        footer={isReturnTab ? (
          <div className="flex items-center justify-end gap-2 pt-3 border-t">
            <Button type="button" variant="outline" size="sm" onClick={clearAll} className="gap-1"><X className="w-4 h-4" /> مسح</Button>
            <Button type="button" size="sm" onClick={applySearch} className="gap-1"><Search className="w-4 h-4" /> بحث</Button>
          </div>
        ) : undefined}
      /></PermPart>

      {tab === "transfer" && (
        <div className={`mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 transition-opacity ${transferMetricsLoading ? "opacity-60" : ""}`} aria-label="ملخص تحويلات المخازن">
          <MetricCardWithHint
            label="إجمالي قيمة التحويلات"
            value={transferMetrics.totalValue}
            icon={<ArrowLeftRight />}
            tone="primary"
            footer={
              <div className="space-y-0.5">
                <div className="flex justify-between gap-2"><span>اتقبل</span><b className="tabular-nums text-success">{formatEGP(transferMetrics.acceptedValue)}</b></div>
                <div className="flex justify-between gap-2"><span>اترفض</span><b className="tabular-nums text-destructive">{formatEGP(transferMetrics.rejectedValue)}</b></div>
                <div className="flex justify-between gap-2"><span>معلق</span><b className="tabular-nums text-warning">{formatEGP(transferMetrics.pendingValue)}</b></div>
              </div>
            }
            metricHint={{
              meaning: "قيمة التحويلات المعروضة بتكلفة الفرع المرسل وقت التحويل (متوسط التكلفة)، ومقسومة: اتقبل، اترفض ورجع، ولسه معلق.",
              source: "كل تحويلات المخزون المطابقة للفلاتر، وقيمتها من متوسط تكلفة الصنف في الفرع المرسل.",
              formula: "Σ الكمية × متوسط تكلفة الصنف عند المرسل وقت التحويل",
            }}
          />
          <MetricCardWithHint
            label="إجمالي التحويلات"
            value={transferMetrics.totalQuantity}
            currency={false}
            icon={<ArrowLeftRight />}
            tone="primary"
            footer={<span className="tabular-nums">{transferMetrics.totalCount.toLocaleString("en-US")} حركة • {transferMetrics.totalQuantity.toLocaleString("en-US")} وحدة</span>}
            metricHint={{
              meaning: "عدد التحويلات وإجمالي كمياتها حسب الفلاتر الحالية.",
              source: "كل تحويلات المخزون المطابقة للتاريخ والفرع المرسل والمستلم والحالة.",
              formula: "عدد التحويلات = عدد الصفوف؛ إجمالي الكمية = Σ الكمية",
            }}
          />
          <MetricCardWithHint
            label="التحويلات المؤكدة"
            value={transferMetrics.confirmedQuantity}
            currency={false}
            icon={<PackageCheck />}
            tone="success"
            footer={<span className="tabular-nums">{transferMetrics.confirmedCount.toLocaleString("en-US")} حركة • {transferMetrics.confirmedQuantity.toLocaleString("en-US")} وحدة</span>}
            metricHint={{
              meaning: "التحويلات المؤكدة ضمن النتائج المطابقة للفلاتر.",
              source: "تحويلات المخزون ذات الحالة confirmed.",
              formula: "العدد = عدد التحويلات المؤكدة؛ الكمية = Σ كمياتها",
            }}
          />
          <MetricCardWithHint
            label="التحويلات المرفوضة / المعلقة"
            value={transferMetrics.unresolvedQuantity}
            currency={false}
            icon={<AlertTriangle />}
            tone="warning"
            footer={<span className="tabular-nums">{transferMetrics.unresolvedCount.toLocaleString("en-US")} حركة • {transferMetrics.unresolvedQuantity.toLocaleString("en-US")} وحدة</span>}
            metricHint={{
              meaning: "التحويلات المرفوضة أو التي ما زالت معلقة ضمن الفلاتر الحالية.",
              source: "تحويلات المخزون ذات الحالة rejected أو pending.",
              formula: "العدد = المرفوضة + المعلقة؛ الكمية = Σ كمياتها",
            }}
          />
        </div>
      )}

      {docKind && <UnifiedDocumentMetrics kind={docKind} metrics={docMetrics} loading={docMetricsLoading} selected={cardFilter} onSelect={setCardFilter} view={view} />}
      {statusAsOf && (docKind === "sale" || docKind === "purchase") && (
        <div className="text-xs text-muted-foreground -mt-2 mb-3">المدفوع والمتبقي وحالة السداد وأعمدة طريقة الدفع والكروت محسوبين لحد {formatDate(statusAsOf)} (آخر يوم في الفترة)، مش لحد النهارده. اللي اتدفع بعد كده ظاهر لوحده «اتدفع بعد الفترة».</div>
      )}

      <div ref={tableTopRef} className="scroll-mt-4" />
      {bulkKind && branchId && (
        <PermPart page="invoices" part="bulk_bar"><BulkActionsBar
          kind={bulkKind}
          branchId={branchId}
          rows={Array.from(selected.values())}
          totalCount={totalCount}
          onSelectPage={() => setSelected((prev) => { const n = new Map(prev); filteredRows.forEach((r: any) => n.set(r.id, r)); return n; })}
          onSelectAll={async () => {
            if (totalCount > 2000) throw new Error(`النتائج ${totalCount.toLocaleString("en-US")} — ضيّق الفلتر لـ 2,000 أو أقل عشان تحددهم كلهم`);
            const all: any[] = [];
            for (let from = 0; from < totalCount; from += 1000) {
              const { qb } = await buildQuery(SELECTS[tab], false);
              const { data, error } = await qb.order("id").range(from, from + 999);
              if (error) throw error;
              all.push(...(data ?? []));
              if ((data ?? []).length < 1000) break;
            }
            setSelected(new Map(all.map((r: any) => [r.id, r])));
          }}
          onClear={() => setSelected(new Map())}
          onDone={() => { setSelected(new Map()); load(); setMetricsTick((t) => t + 1); }}
          extra={canConvert ? (() => {
            const ids = Array.from(selected.values()).filter((r: any) => r.status !== "cancelled").map((r: any) => r.id);
            return ids.length ? (<>
              <Button size="sm" className="h-7" onClick={() => setConvert({ ids, target: "cash" })}>تحويل لنقدي</Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setConvert({ ids, target: "credit" })}>تحويل لآجل</Button>
            </>) : null;
          })() : undefined}
        /></PermPart>
      )}
      {convert && (tab === "sale" || tab === "purchase") && (
        <ConvertClassDialog open={!!convert} onOpenChange={(o) => { if (!o) setConvert(null); }}
                            docType={tab === "sale" ? "invoice" : "shipment"} ids={convert.ids} target={convert.target}
                            onDone={() => { setSelected(new Map()); load(); setMetricsTick((t) => t + 1); }} />
      )}
      <DataTable
        permPage="invoices"
        permTable={tab}
        loading={loading}
        rows={filteredRows}
        indexColumn={{ offset: (page - 1) * PAGE_SIZE }}
        onRowClick={cfg.onClick}
        empty="لا توجد سجلات"
        columns={(bulkKind ? [{
          key: "__sel", header: "✓", align: "center", className: "w-[40px]",
          render: (r: any) => (
            <input type="checkbox" className="h-4 w-4 accent-primary cursor-pointer" checked={selected.has(r.id)}
                   onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(r)} aria-label="تحديد" />
          ),
        }, ...cfg.columns] : cfg.columns) as any}
        minTableWidth={tab === "sale" || tab === "purchase" ? "1900px" : bulkKind ? "1800px" : docKind ? "1100px" : undefined}
        getRowKey={(row: any) => row.id}
        isRowExpanded={DOC_ITEMS_TABS.includes(tab) || tab === "transfer" || tab === "income" || tab === "expense" ? (row: any) => expandedInvoiceId === row.id : undefined}
        renderExpandedRow={tab === "transfer" ? (row: any) => (
          <TransferDetails transfer={row} value={transferValues[row.id]} fromName={branchName(row.from_branch_id)} toName={branchName(row.to_branch_id)} />
        ) : tab === "income" || tab === "expense" ? (row: any) => <VoucherDetailsRow v={row} income={tab === "income"} branchId={branchId!} /> : DOC_ITEMS_TABS.includes(tab) && tenantId && branchId ? (row: any) => (
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

      <CancelInvoiceDialog open={!!cancelSale} onOpenChange={(o) => { if (!o) setCancelSale(null); }} invoice={cancelSale} onDone={() => { setCancelSale(null); load(); }} />
      <CancelPurchaseDialog open={!!cancelPurchase} onOpenChange={(o) => { if (!o) setCancelPurchase(null); }} shipment={cancelPurchase} onDone={() => { setCancelPurchase(null); load(); }} />

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
              <b>أثره المحاسبي على الخزينة هيترجع تلقائياً</b> على يوم السند نفسه.<br />
              لو السند ده سند دفعة على فاتورة أو قسط، <b>الدفعة نفسها هتتلغي معاه</b> والفاتورة ترجع مفتوحة بالمبلغ ده. ولو سند رد فلوس فاتورة ملغاة، الفلوس ترجع تحت حساب العميل.
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


      <ReturnEditDialog
        kind={returnEdit?.kind ?? "sale_return"}
        record={returnEdit?.rec ?? null}
        originalInvoiceDate={returnEdit?.kind === "sale_return" ? returnEdit?.rec?.invoices?.invoice_date : null}
        canEditDate={isAdmin}
        onOpenChange={(o) => !o && setReturnEdit(null)}
        onSaved={() => load()}
      />

      {/* One hoisted cancel-return window for every row (portal to <body>, no scroll lock). */}
      <CancelReturnDialog target={selectedReturnForCancel} onClose={() => setSelectedReturnForCancel(null)} onDone={() => load()} />

    </BranchLayout>
  );
}

function ClassBadge({ value }: { value?: string | null }) {
  return value === "cash"
    ? <span className="inline-flex rounded-full border border-success/40 bg-success/15 px-2.5 py-0.5 text-[11px] font-bold text-success">نقدي</span>
    : <span className="inline-flex rounded-full border border-warning/40 bg-warning/15 px-2.5 py-0.5 text-[11px] font-bold text-warning">آجل</span>;
}

function SalePayBadge({ state, remaining }: { state: SalePayState; remaining: number }) {
  const cls = state === "paid" ? "bg-success/15 text-success border-success/40"
    : state === "partial" ? "bg-warning/15 text-warning border-warning/40"
    : "bg-destructive/15 text-destructive border-destructive/40";
  const label = state === "paid" ? "مدفوعة بالكامل" : state === "partial" ? "سداد جزئي" : "لم يتم الدفع";
  return (
    <span className={`inline-flex flex-col items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${cls}`}>
      {label}
      {state === "partial" && <span className="font-semibold tabular-nums opacity-90">متبقي {formatEGP(remaining)}</span>}
    </span>
  );
}

/** The arrow under a voucher: whose account, which document, what it paid and what stayed on account. */
function VoucherDetailsRow({ v, income, branchId }: { v: any; income: boolean; branchId: string }) {
  const nav = useNavigate();
  const l = v.__link;
  const path = l ? srcPath(branchId, l) : null;
  const Item = ({ k, children }: { k: string; children: ReactNode }) => (
    <div className="flex gap-2"><span className="text-muted-foreground whitespace-nowrap">{k}:</span><span className="font-semibold">{children}</span></div>
  );
  return (
    <div className="grid gap-2 bg-muted/30 p-3 text-xs sm:grid-cols-2 lg:grid-cols-3" dir="rtl">
      <Item k="اسم الحساب">{v.__account ?? "—"}</Item>
      <Item k="المصدر">
        {path && l?.src_type
          ? <button type="button" className="text-primary hover:underline" onClick={() => nav(path)}>{SRC_LABEL[l.src_type]} {l.src_number}</button>
          : v.source === "manual" ? "سند يدوي" : "سند تلقائي"}
      </Item>
      <Item k="طريقة الدفع">{payMethodLabel(v.payment_method)}{v.reference_number ? ` • رقم العملية ${v.reference_number}` : ""}</Item>
      {v.__inLedger && v.status !== "cancelled" && (
        <>
          <Item k={income ? "اتخصم من فواتير" : "اتدفع على فواتير"}>{formatEGP(v.__alloc ?? 0)}{v.__docs ? ` (${v.__docs})` : ""}</Item>
          <Item k={income ? "فضل مقدم تحت حسابه" : "فضل مقدم لينا عنده"}>{formatEGP(v.__onAcc ?? 0)}</Item>
        </>
      )}
      {Number(v.fee_amount) > 0 && <Item k="العمولة">{formatEGP(v.fee_amount)}</Item>}
      <Item k="سجّله">{v.created_by_name ?? "—"} • {formatDateTime(v.__enteredAt ?? v.created_at)}</Item>
      {v.status === "cancelled" && <Item k="اتلغى">{v.cancelled_at ? formatDateTime(v.cancelled_at) : "—"}{v.cancel_reason ? ` — ${v.cancel_reason}` : ""}</Item>}
    </div>
  );
}
