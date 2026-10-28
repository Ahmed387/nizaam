import { cairoTodayDay, addDaysDay, monthStartDay } from "@/lib/cairoDate";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PermPart, usePartVisible } from "@/contexts/PermCustomize";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { NumberedPagination } from "@/components/NumberedPagination";

const PAGE_SIZE = 50;
/** Strip PostgREST or()/ilike metacharacters from free text. */
const safeLike = (s: string) => s.replace(/[,()%*\\]/g, " ").trim();
/** Cairo-day shortcut pills; SQL date bounds are applied directly to transaction_date. */
const DATE_SHORTCUTS: { label: string; range: () => [string, string] }[] = [
  { label: "النهاردة", range: () => { const d = cairoTodayDay(); return [d, d]; } },
  { label: "امبارح", range: () => { const d = addDaysDay(cairoTodayDay(), -1); return [d, d]; } },
  { label: "آخر 7 أيام", range: () => { const d = cairoTodayDay(); return [addDaysDay(d, -6), d]; } },
  { label: "الشهر ده", range: () => { const d = cairoTodayDay(); return [monthStartDay(d), d]; } },
  { label: "الشهر اللي فات", range: () => { const d = cairoTodayDay(); return [monthStartDay(d, -1), addDaysDay(monthStartDay(d), -1)]; } },
];
import { useEffect, useState, useMemo, type ReactNode } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { useListFilter, useRememberedFilter } from "@/hooks/useListFilter";
import { readAll, useWholeList } from "@/hooks/useWholeList";
import { EMPTY_STATE, periodOfFilter, singleValueOf, withPeriod, withSingleValue, type FilterState, type ListColumn } from "@/lib/tableFilter";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { TransferFeeCards } from "@/components/treasury/TransferFeeCards";
import { REVERSAL_CATEGORIES } from "@/lib/treasuryReversals";
import { DataTable } from "@/components/DataTable";
import { MetricHint } from "@/components/ui/MetricHint";
import { VouchersTable } from "@/components/VouchersTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate, formatEGP, formatDateTime, resolveTreasuryOperationNumber, sanitizeOperationalDescription, treasuryCategoryLabel } from "@/lib/format";
import { TreasuryMovementDialog, TreasuryMovement } from "@/components/TreasuryMovementDialog";
import { DetailsChevron } from "@/components/DetailsChevron";
import { notifyMany, getBranchManagers, getTenantAdmins } from "@/lib/notifications";
import { PaymentMethodPicker, emptyPaymentValue, PaymentMethodValue } from "@/components/PaymentMethodPicker";
import { PAYMENT_METHOD_LABELS, PaymentMethod } from "@/lib/paymentMethods";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { ArrowLeftRight, FileSpreadsheet, CheckCircle2, XCircle, Wallet, Smartphone, CreditCard, Landmark, AlertTriangle, ChevronDown } from "lucide-react";
import { AttachmentsDialogButton } from "@/components/AttachmentsDialogButton";
import { FinancialAmount } from "@/components/FinancialAmount";
import { RecordAttachments } from "@/components/RecordAttachments";
import { useAttachmentCounts } from "@/hooks/useAttachmentCounts";
import { TreasuryMetricsGrid, type PeriodTransaction, type TreasuryChannel } from "@/components/treasury/TreasuryMetricsGrid";
import { fetchTreasuryLinks, payMethodLabel, SRC_LABEL, type TreasuryLink } from "@/lib/treasuryLinks";
import { AccountCell, SourceCell, PrintDocButton } from "@/components/documents/MoneyCells";
import { DocAnnotationsButton } from "@/components/DocAnnotationsDialog";
import { openDocs, OPEN_DOCS_MAX } from "@/lib/openDocs";
import { printDocuments } from "@/lib/bulkPrint";
import { exportToExcel } from "@/lib/export";
import { Eye, Layers, Printer } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface WalletBalances {
  cash_balance: number;
  vodafone_balance: number;
  instapay_balance: number;
  bank_balance: number;
  other_balance: number;
  total_balance: number;
}

const REVERSAL_IN = `(${REVERSAL_CATEGORIES.map((c) => `"${c}"`).join(",")})`;

/** «طريقة الدفع» of a till row in words → its wallet */
const METHOD_OF_LABEL: Record<string, PaymentMethod> = { كاش: "cash", محفظة: "vodafone", انستاباي: "instapay", بنكي: "bank" };
/** «المصدر» of a till row in words, as its cell shows it */
function treasurySourceText(r: any): string {
  const l = r.__link;
  if (l?.cancelled_voucher_number) return `إلغاء سند ${l.cancelled_voucher_number}`;
  if (l?.src_type && l?.src_id) return `${SRC_LABEL[l.src_type] ?? ""} ${l.src_number ?? ""}`.trim();
  if (!r.voucher_id && !l?.src_type) return treasuryCategoryLabel(r.category);
  return r.voucher_source === "manual" ? "يدوي" : "تلقائي";
}
/** what each column of «حركات الخزنة» shows, for the Excel filters on every row (owner 2026-10-26) */
const MOVE_COLS: ListColumn<any>[] = [
  { key: "reference_number", label: "رقم السند", kind: "text", get: (r) => resolveTreasuryOperationNumber(r.voucher_number, r.invoice_number, r.reference_number) },
  { key: "account", label: "اسم الحساب", kind: "text", get: (r) => r.__account },
  // in + / out −, so the total is the net movement
  { key: "amount", label: "المبلغ", kind: "number", get: (r) => (r.type === "income" ? 1 : -1) * (Number(r.amount) || 0), sum: true, money: true },
  { key: "category", label: "التصنيف", kind: "text", get: (r) => `${treasuryCategoryLabel(r.category)}${r.is_fee ? " (عمولة)" : ""}` },
  { key: "payment_method", label: "طريقة الدفع", kind: "text", get: (r) => payMethodLabel(r.payment_method) },
  { key: "transaction_date", label: "التاريخ", kind: "date", get: (r) => r.transaction_date },
  { key: "status", label: "الحالة", kind: "text", get: (r) => (r.voucher_status === "cancelled" ? "سند ملغي" : "نشط") },
  { key: "source", label: "المصدر", kind: "text", get: treasurySourceText },
  { key: "balance_after", label: "الرصيد بعد الحركة", kind: "number", get: (r) => r.balance_after },
  { key: "recipient", label: "المستلم", kind: "text", get: (r) => r.recipient_name },
  { key: "description", label: "البيان", kind: "text", get: (r) => sanitizeOperationalDescription(r.description) },
];
/**
 * the period and ONE wallet run in the database for the page (the running balance is per wallet then); every other
 * filter on the whole list — which holds every wallet of the period, so the «طريقة الدفع» arrow lists them all
 */
const needsWholeTill = (s: FilterState) => !!s.sort || Object.entries(s.filters).some(([k, f]) =>
  !((k === "transaction_date" && f.kind === "date" && !f.days?.length) || (k === "payment_method" && f.kind === "values" && f.values.length === 1 && METHOD_OF_LABEL[f.values[0]])));

export default function Treasury() {
  const { id: branchId } = useParams<{ id: string }>();
  const tabOn = usePartVisible("treasury");
  const [searchParams, setSearchParams] = useSearchParams();
  const TABS = ["movements", "reversals", "receipts", "payments", "transfers"] as const;
  const askedTab = (searchParams.get("tab") as (typeof TABS)[number] | null) ?? "movements";
  // a tab hidden for this person (permissions 0114) falls back to the first one he can see
  const initialTab = tabOn(`tab_${askedTab}`) ? askedTab : (TABS.find((t) => tabOn(`tab_${t}`)) ?? askedTab);
  const reversalView = initialTab === "reversals";
  const { user, profile, branches, isAdmin, hasRole } = useAuth();
  const canTransfer = isAdmin || hasRole("branch_manager");
  const canSeeBalances = isAdmin || hasRole("branch_manager") || hasRole("viewer");

  const [rows, setRows] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [walletBalances, setWalletBalances] = useState<WalletBalances>({
    cash_balance: 0, vodafone_balance: 0, instapay_balance: 0, bank_balance: 0, other_balance: 0, total_balance: 0,
  });
  const [lowThreshold, setLowThreshold] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "income" | "expense">("all");
  // Excel filters of «حركات الخزنة» (owner 2026-10-26), remembered per tab. The bar's period and wallet ARE the
  // «التاريخ» / «طريقة الدفع» column filters (both stay, linked).
  const { pathname } = useLocation();
  const [colState, setColState] = useRememberedFilter(`xf:v1:${pathname}:${reversalView ? "reversals" : "movements"}`);
  const methodFilter: "all" | PaymentMethod = METHOD_OF_LABEL[singleValueOf(colState, "payment_method")] ?? "all";
  const setMethodFilter = (m: "all" | PaymentMethod) => setColState(withSingleValue(colState, "payment_method", m === "all" ? "" : payMethodLabel(m)));
  const [openTransfer, setOpenTransfer] = useState(false);
  const [openReject, setOpenReject] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [tForm, setTForm] = useState({ to: "", amount: "", reason: "" });
  const [tPayment, setTPayment] = useState<PaymentMethodValue>(emptyPaymentValue("cash"));
  const [tFeeCharged, setTFeeCharged] = useState(true);
  const [viewTransfer, setViewTransfer] = useState<any | null>(null);
  const [viewMovement, setViewMovement] = useState<TreasuryMovement | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, any>>(new Map());
  const toggleSel = (r: any) => setSelected((prev) => { const n = new Map(prev); if (n.has(r.id)) n.delete(r.id); else n.set(r.id, r); return n; });
  const { from: fromDate, to: toDate } = periodOfFilter(colState, "transaction_date");
  const setPeriod = (f: string, t: string) => setColState(withPeriod(colState, "transaction_date", f, t));
  const setFromDate = (v: string) => setPeriod(v, toDate);
  const setToDate = (v: string) => setPeriod(fromDate, v);
  const [searchText, setSearchText] = useState("");
  const [notesText, setNotesText] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [search, setSearch] = useState("");
  const [notesSearch, setNotesSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [periodRows, setPeriodRows] = useState<PeriodTransaction[]>([]);
  const [periodLoading, setPeriodLoading] = useState(true);
  useEffect(() => { const t = setTimeout(() => setSearch(searchText.trim()), 300); return () => clearTimeout(t); }, [searchText]);
  useEffect(() => { const t = setTimeout(() => setNotesSearch(notesText.trim()), 300); return () => clearTimeout(t); }, [notesText]);
  const colStateSig = JSON.stringify(colState);
  useEffect(() => { setPage(1); setSelected(new Map()); }, [fromDate, toDate, search, notesSearch, minAmount, maxAmount, tab, methodFilter, reversalView, colStateSig]);
  const resetFilters = () => {
    setColState(EMPTY_STATE); setSearchText(""); setNotesText("");
    setMinAmount(""); setMaxAmount(""); setTab("all");
  };

  /** Applies the page's filters to any treasury query (shared by table page + period totals; the whole list leaves the wallet out). */
  const applyFilters = (q: any, forTable = false, withMethod = true) => {
    let tq = q.eq("branch_id", branchId!);
    // the movements table leaves reversal rows to their own tab; period totals keep every row (true money)
    if (forTable) tq = reversalView ? tq.in("category", REVERSAL_CATEGORIES) : tq.not("category", "in", REVERSAL_IN);
    if (fromDate) tq = tq.gte("transaction_date", fromDate);
    if (toDate) tq = tq.lte("transaction_date", toDate);
    if (tab !== "all") tq = tq.eq("type", tab);
    if (withMethod && methodFilter !== "all") tq = tq.eq("payment_method", methodFilter);
    const s = safeLike(search);
    if (s) tq = tq.or(`reference_number.ilike.%${s}%,description.ilike.%${s}%,category.ilike.%${s}%`);
    const n = safeLike(notesSearch);
    if (n) tq = tq.ilike("description", `%${n}%`);
    if (minAmount !== "" && !isNaN(Number(minAmount))) tq = tq.gte("amount", Number(minAmount));
    if (maxAmount !== "" && !isNaN(Number(maxAmount))) tq = tq.lte("amount", Number(maxAmount));
    return tq;
  };

  // Period totals need every filtered row (table is paginated) — lean columns only, refetched only when filters change.
  const loadPeriod = async () => {
    setPeriodLoading(true);
    try {
      const data = await fetchAllRows<PeriodTransaction>(() =>
        applyFilters(supabase.from("treasury").select("id,type,payment_method,amount")).order("transaction_date").order("id"));
      setPeriodRows(data);
    } finally { setPeriodLoading(false); }
  };
  useEffect(() => { if (branchId) loadPeriod(); }, [branchId, fromDate, toDate, search, notesSearch, minAmount, maxAmount, tab, methodFilter]);

  /** what the table shows beyond the till row: its voucher / invoice, the till after it (0097) and its account / source (0099) */
  const enrichMovements = async (movements: any[], signal?: AbortSignal): Promise<any[]> => {
    const movementIds = movements.map((row) => row.id);
    const referenceIds = Array.from(new Set(movements.map((row) => row.reference_id).filter((id): id is string => Boolean(id))));
    const chunks = <T,>(a: T[], n = 200) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
    const inChunks = async (ids: string[], q: (c: string[]) => any) => (await Promise.all(chunks(ids).map(async (c) => {
      let b = q(c);
      if (signal) b = b.abortSignal(signal);
      return ((await b).data ?? []) as any[];
    }))).flat();
    const [vouchers, invoices] = await Promise.all([
      inChunks(movementIds, (c) => supabase.from("vouchers").select("id,treasury_id,voucher_number,status,party_name,recipient_name,description").in("treasury_id", c)),
      inChunks(referenceIds, (c) => supabase.from("invoices").select("id,invoice_number").in("id", c)),
    ]);
    const voucherByMovement = new Map(vouchers.map((voucher) => [voucher.treasury_id, voucher.voucher_number]));
    const voucherRowByMovement = new Map(vouchers.map((voucher: any) => [voucher.treasury_id, voucher]));
    const invoiceByReference = new Map(invoices.map((invoice) => [invoice.id, invoice.invoice_number]));
    // the till after each row (0097), in the table's own order
    let balQ: any = movementIds.length ? supabase.rpc("treasury_balance_after" as any, { p_branch: branchId, p_ids: movementIds, p_method: methodFilter === "all" ? null : methodFilter } as any) : null;
    if (balQ && signal) balQ = balQ.abortSignal(signal);
    const { data: bal } = balQ ? await balQ : { data: [] as any[] };
    const balanceAfter = new Map(((bal ?? []) as any[]).map((b) => [b.id, Number(b.balance_after)]));
    // «اسم الحساب» / «المصدر» of every row (0099)
    const links = await fetchTreasuryLinks(movementIds, signal).catch(() => new Map<string, TreasuryLink>());
    return movements.map((row) => ({
      ...row,
      party_name: (voucherRowByMovement.get(row.id) as any)?.party_name ?? null,
      __link: links.get(row.id) ?? null,
      __account: links.get(row.id)?.account_name ?? (voucherRowByMovement.get(row.id) as any)?.party_name ?? null,
      voucher_source: links.get(row.id)?.voucher_source ?? null,
      recipient_name: (voucherRowByMovement.get(row.id) as any)?.recipient_name ?? null,
      balance_after: balanceAfter.get(row.id) ?? null,
      voucher_number: voucherByMovement.get(row.id) ?? null,
      voucher_id: (voucherRowByMovement.get(row.id) as any)?.id ?? null,
      voucher_status: (voucherRowByMovement.get(row.id) as any)?.status ?? null,
      voucher_description: (voucherRowByMovement.get(row.id) as any)?.description ?? null,
      invoice_number: row.reference_id ? invoiceByReference.get(row.reference_id) ?? null : null,
    }));
  };

  const load = async () => {
    setLoading(true);
    const tq = applyFilters(supabase.from("treasury").select("*", { count: "exact" }), true);
    const offset = (page - 1) * PAGE_SIZE;
    const [tr, tt, wb, br] = await Promise.all([
      tq.order("transaction_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + PAGE_SIZE - 1),
      fetchAllRows<any>(() => supabase.from("treasury_transfers").select("*, from_branch:branches!from_branch_id(name), to_branch:branches!to_branch_id(name)").or(`from_branch_id.eq.${branchId},to_branch_id.eq.${branchId}`).order("created_at", { ascending: false }).order("id")).then((data) => ({ data, error: null })),
      supabase.rpc("get_branch_wallet_balances", { p_branch_id: branchId! }),
      supabase.from("branches").select("low_balance_threshold, tenant_id, name").eq("id", branchId!).maybeSingle(),
    ]);
    const movements = (tr.data ?? []) as TreasuryMovement[];
    setRows(await enrichMovements(movements));
    setTotalCount(tr.count ?? 0);
    setTransfers(tt.data ?? []);
    const balances = (wb.data && wb.data[0]) ? (wb.data[0] as any) : null;
    if (balances) setWalletBalances(balances);
    const threshold = Number((br.data as any)?.low_balance_threshold ?? 0);
    setLowThreshold(threshold);
    setLoading(false);
    // Low balance alert + once-per-day notification
    if (balances && threshold > 0 && Number(balances.total_balance) < threshold) {
      const key = `low_balance_notified_${branchId}_${cairoTodayDay()}`;
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, "1");
        const brName = (br.data as any)?.name ?? "الفرع";
        const tenantId = (br.data as any)?.tenant_id;
        const [managers, admins] = await Promise.all([
          getBranchManagers(branchId!),
          tenantId ? getTenantAdmins(tenantId) : Promise.resolve([] as string[]),
        ]);
        const recipients = Array.from(new Set([...(managers ?? []), ...(admins ?? [])]));
        if (recipients.length) {
          await notifyMany(recipients, {
            title: "⚠️ تنبيه: رصيد الخزينة منخفض",
            body: `${brName} — الرصيد الحالي ${formatEGP(Number(balances.total_balance))} أقل من الحد ${formatEGP(threshold)}`,
            type: "general",
            link: `/branch/${branchId}/treasury`,
            relatedEntity: "treasury_low_balance",
          });
        }
      }
    }
  };
  // ===== the whole list behind the 50-row pages (Excel filters, owner 2026-10-26) =====
  // A column filter (other than the period / one wallet) or a sort reads every row the bar's filters leave — enriched
  // like the page — and pages it here; otherwise the database pages it as before. The wallet stays out of that read
  // (applied in memory like any column filter) so its arrow still lists every wallet with its count, as in Excel; it
  // is in the signature only because the running balance is per wallet.
  const wholeSig = `${branchId}|${reversalView}|${fromDate}|${toDate}|${search}|${notesSearch}|${minAmount}|${maxAmount}|${tab}|${methodFilter}`;
  const whole = useWholeList<any>(wholeSig, async (signal) => {
    const all = await readAll<any>(() => applyFilters(supabase.from("treasury").select("*"), true, false)
      .order("transaction_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false }), signal);
    return enrichMovements(all, signal);
  }, { auto: needsWholeTill(colState) });
  const { result: listRes, adapter: listAdapter, state: colEff } = useListFilter({
    rows: whole.rows, columns: MOVE_COLS, state: colState, onChange: setColState, ensureRows: whole.ensure,
  });
  const wholeMode = needsWholeTill(colEff);
  useEffect(() => { load(); }, [branchId, fromDate, toDate, search, notesSearch, minAmount, maxAmount, tab, methodFilter, wholeMode ? 0 : page, reversalView]);
  useRealtimeRefresh(["vouchers", "treasury", "treasury_transfers"], () => { load(); loadPeriod(); whole.refresh(); });

  const filtered = wholeMode ? (listRes ? listRes.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : []) : rows;
  const shownCount = wholeMode ? (listRes ? listRes.rows.length : 0) : totalCount;
  const pageCount = Math.max(1, Math.ceil(shownCount / PAGE_SIZE));
  const tableAdapter = useMemo(() => ({ ...listAdapter, shown: listAdapter.shown ?? totalCount }), [listAdapter, totalCount]);
  /** in / out of what the table covers: the page, or every filtered row */
  const footerRows = wholeMode && listRes ? listRes.rows : filtered;


  const transfer = async () => {
    if (!tForm.to || !tForm.amount) return toast.error("املأ البيانات");
    const amt = Number(tForm.amount);
    if (amt <= 0) return toast.error("المبلغ لازم يكون أكبر من صفر");
    const tErr = (await import("@/lib/paymentMethods")).validateTransferPayment(tPayment);
    if (tErr) return toast.error(tErr);
    // also add transfer_from_account if set
    (tPayment as any).transfer_from_account = tPayment.transfer_from_account ?? null;

    const walletKey = `${tPayment.method}_balance` as keyof WalletBalances;
    const available = walletBalances[walletKey];
    if (available < amt + tPayment.fee_amount) {
      return toast.error(`رصيد وعاء ${PAYMENT_METHOD_LABELS[tPayment.method]} غير كافٍ — المتاح: ${formatEGP(available)}`);
    }

    const { error } = await supabase.rpc("transfer_treasury_atomic", {
      p_from_branch: branchId!,
      p_to_branch: tForm.to,
      p_amount: amt,
      p_reason: tForm.reason || null,
      p_payment_method: tPayment.method,
      p_fee_amount: tPayment.fee_amount,
      p_reference_number: tPayment.reference_number || null,
      p_transfer_to_account: tPayment.transfer_to_account || null,
      p_fee_actually_charged: tPayment.fee_amount > 0 ? tFeeCharged : true,
    } as any);
    if (error) return toast.error(error.message);

    // «إيصال التحويل» goes on the transfer itself (its 📎 in «تحويلات بين الفروع»)
    if ((tPayment.proof_files?.length ?? 0) > 0 && tPayment.method !== "cash") {
      const { data: tr } = await supabase.from("treasury_transfers").select("id")
        .eq("from_branch_id", branchId!).eq("to_branch_id", tForm.to).eq("amount", amt)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (tr?.id) {
        const { uploadRecordAttachment } = await import("@/lib/attachmentUpload");
        for (const f of tPayment.proof_files!) {
          try { await uploadRecordAttachment("treasury_transfer", tr.id, f, user?.id); }
          catch (e: any) { toast.error(`إيصال ${f.name}: ${e?.message ?? "فشل الرفع"}`); }
        }
      } else toast.warning("الإيصال ما اترفعش — ارفعه من 📎 على التحويل");
    }

    const toBr = branches.find((b) => b.id === tForm.to);
    const recipients = await getBranchManagers(tForm.to);
    await notifyMany(recipients, {
      title: "💰 طلب استلام تحويل خزنة",
      body: `${formatEGP(amt)} عبر ${PAYMENT_METHOD_LABELS[tPayment.method]}${tPayment.reference_number ? ` — رقم: ${tPayment.reference_number}` : ""}`,
      type: "general",
      link: `/branch/${tForm.to}/treasury`,
      relatedEntity: "treasury_transfer",
    });

    toast.success(`تم تحويل ${formatEGP(amt)} لـ ${toBr?.name ?? "الفرع"}`);
    setOpenTransfer(false);
    setTForm({ to: "", amount: "", reason: "" });
    setTPayment(emptyPaymentValue("cash"));
    setTFeeCharged(true);
    load();
  };


  const acknowledge = async (t: any) => {
    const { error } = await supabase.rpc("acknowledge_treasury_transfer", { p_transfer_id: t.id });
    if (error) return toast.error(error.message);
    toast.success("تم تأكيد الاستلام"); load();
  };

  const reject = async () => {
    if (!openReject) return;
    if (!rejectReason.trim()) return toast.error("اكتب سبب الرفض");
    const { error } = await supabase.rpc("reject_treasury_transfer", {
      p_transfer_id: openReject.id, p_reason: rejectReason,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("تم رفض التحويل وإرجاع المبلغ للمرسِل");
    setOpenReject(null); setRejectReason(""); load();
  };

  const otherBranches = branches.filter((b) => b.id !== branchId);
  const canAck = isAdmin || hasRole("branch_manager");
  const transferAttCounts = useAttachmentCounts("treasury_transfer", useMemo(() => transfers.map((t: any) => t.id), [transfers]));
  // «إيصال التحويل» of each till movement lives on its voucher
  const movementAttCounts = useAttachmentCounts("voucher", useMemo(() => rows.map((r: any) => r.voucher_id).filter(Boolean), [rows]));

  const wallets = [
    { key: "cash_balance" as const, label: "كاش في الدرج", icon: Wallet, color: "text-success", method: "cash" as const },
    { key: "vodafone_balance" as const, label: "فودافون كاش", icon: Smartphone, color: "text-rose-500", method: "vodafone" as const },
    { key: "instapay_balance" as const, label: "انستاباي", icon: CreditCard, color: "text-violet-500", method: "instapay" as const },
    { key: "bank_balance" as const, label: "حساب بنكي", icon: Landmark, color: "text-blue-500", method: "bank" as const },
    // وسائل الدفع المخصّصة — من غيرها مجموع المحافظ ما كانش بيساوي إجمالي الخزنة
    ...(Number(walletBalances.other_balance ?? 0) !== 0
      ? [{ key: "other_balance" as const, label: "وسائل أخرى", icon: Wallet, color: "text-amber-500", method: "other" as const }]
      : []),
  ];
  const channels = useMemo<TreasuryChannel[]>(() => [
    { method: "cash", label: "حركة الكاش (الدرج)", icon: Wallet, color: "text-success" },
    { method: "vodafone", label: "حركة فودافون كاش", icon: Smartphone, color: "text-destructive" },
    { method: "instapay", label: "حركة انستاباي", icon: CreditCard, color: "text-primary" },
    { method: "bank", label: "حركة الحساب البنكي", icon: Landmark, color: "text-primary" },
    ...(periodRows.some((r) => !["cash", "vodafone", "instapay", "bank"].includes(String(r.payment_method)))
      ? [{ method: "other", label: "وسائل أخرى", icon: Wallet, color: "text-warning" }] : []),
  ], [periodRows]);

  // تحويلات واردة لسه محصلش عليها تأكيد استلام — الفلوس دي مش مضافة للرصيد
  const pendingIncoming = useMemo(
    () => transfers.filter((t: any) => t.to_branch_id === branchId && !t.acknowledged_at && !t.rejected_at),
    [transfers, branchId]
  );
  const pendingIncomingTotal = pendingIncoming.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);



  const [exporting, setExporting] = useState(false);
  const exportLedger = async () => {
    if (!branchId) return;
    setExporting(true);
    try {
      const all = await fetchAllRows<any>(() => supabase.from("treasury")
        .select("id,type,category,amount,description,reference_id,reference_number,payment_method,transaction_date")
        .eq("branch_id", branchId).order("transaction_date", { ascending: true }).order("id"));
      const ids = all.map((r) => r.id);
      const refIds = [...new Set(all.map((r) => r.reference_id).filter(Boolean))] as string[];
      const chunk = <T,>(a: T[], n = 200) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
      const vMap = new Map<string, any>(); const iMap = new Map<string, any>();
      for (const c of chunk(ids)) {
        const { data } = await supabase.from("vouchers").select("treasury_id,voucher_number,party_name").in("treasury_id", c);
        (data ?? []).forEach((v: any) => vMap.set(v.treasury_id, v));
      }
      for (const c of chunk(refIds)) {
        const { data } = await supabase.from("invoices").select("id,invoice_number,contact:contacts!invoices_contact_id_fkey(name)").in("id", c);
        (data ?? []).forEach((v: any) => iMap.set(v.id, v));
      }
      const header = ["م", "تاريخ السند / الحركة", "رقم السند / العملية", "نوع الحركة", "التصنيف", "الجهة / المستلم", "البيان / الملاحظات", "الوعاء المالي", "وارد (+)", "منصرف (-)", "الرصيد التراكمي"];
      const aoa: any[][] = [header];
      all.forEach((r, i) => {
        const v = vMap.get(r.id); const inv = r.reference_id ? iMap.get(r.reference_id) : null;
        const amt = Number(r.amount ?? 0); const isIn = r.type === "income";
        aoa.push([i + 1, formatDate(r.transaction_date),
          resolveTreasuryOperationNumber(v?.voucher_number, inv?.invoice_number, r.reference_number),
          isIn ? "وارد" : "منصرف", treasuryCategoryLabel(r.category),
          v?.party_name || inv?.contact?.name || "—", sanitizeOperationalDescription(r.description) || "—",
          PAYMENT_METHOD_LABELS[(r.payment_method ?? "cash") as PaymentMethod] ?? r.payment_method,
          isIn ? amt : 0, isIn ? 0 : amt, 0]);
      });
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const n = all.length; const last = n + 1;
      for (let row = 2; row <= last; row++) {
        ws[`K${row}`] = { t: "n", f: row === 2 ? `I2-J2` : `K${row - 1}+I${row}-J${row}` };
      }
      const s = last + 2;
      XLSX.utils.sheet_add_aoa(ws, [
        ["", "إجمالي المقبوضات (الوارد)"], ["", "إجمالي المصروفات (المنصرف)"], ["", "صافي رصيد الخزينة"],
      ], { origin: `A${s}` });
      ws[`C${s}`] = { t: "n", f: n ? `SUM(I2:I${last})` : "0" };
      ws[`C${s + 1}`] = { t: "n", f: n ? `SUM(J2:J${last})` : "0" };
      ws[`C${s + 2}`] = { t: "n", f: `C${s}-C${s + 1}` };
      ws["!ref"] = `A1:K${s + 2}`;
      ws["!cols"] = [6, 18, 16, 10, 20, 24, 40, 14, 14, 14, 16].map((wch) => ({ wch }));
      ws["!views"] = [{ RTL: true }] as any;
      const wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] } as any;
      XLSX.utils.book_append_sheet(wb, ws, "كشف الخزينة");
      XLSX.writeFile(wb, `كشف-خزينة-الفرع-${cairoTodayDay()}.xlsx`);
      toast.success(`تم تصدير ${n} حركة`);
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر التصدير");
    } finally { setExporting(false); }
  };

  return (
    <BranchLayout>
      <PageHeader title="الخزينة" subtitle="عرض فقط — كل الحركات تتم عبر سندات القبض والصرف"
        actions={
          <div className="flex gap-2">
            {canSeeBalances && (
              <PermPart page="treasury" part="export_button"><Button variant="outline" onClick={exportLedger} disabled={exporting}>
                <FileSpreadsheet className="w-4 h-4 ml-1" /> {exporting ? "جارٍ التصدير..." : "تصدير كشف الخزينة Excel"}
              </Button></PermPart>
            )}
            {canTransfer && otherBranches.length > 0 && (
              <PermPart page="treasury" part="transfer_button"><Button className="btn-gradient" onClick={() => setOpenTransfer(true)}>
                <ArrowLeftRight className="w-4 h-4 ml-1" /> تحويل لفرع
              </Button></PermPart>
            )}
          </div>
        }
      />

      {canSeeBalances ? (
        <TreasuryMetricsGrid
          cumulativeBalance={Number(walletBalances.total_balance)}
          periodRows={periodRows}
          channels={channels}
          loading={periodLoading}
          lowThresholdAlert={lowThreshold > 0 && walletBalances.total_balance < lowThreshold ? (
            <div className="mt-4 flex items-center justify-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive border border-destructive/30">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-semibold">تنبيه: الرصيد أقل من الحد المسموح ({formatEGP(lowThreshold)})</span>
            </div>
          ) : null}
        />
      ) : (
        <div className="card-elevated p-6 mb-6 text-center text-muted-foreground">
          أرصدة الخزينة غير متاحة لدورك. يمكنك تسجيل الحركات فقط.
        </div>
      )}

      {canSeeBalances && <PermPart page="treasury" part="transfer_fees" group><TransferFeeCards branchId={branchId} from={fromDate || undefined} to={toDate || undefined} /></PermPart>}

      {pendingIncoming.length > 0 && (
        <PermPart page="treasury" part="pending_incoming"><div className="card-elevated p-4 mb-6 border border-warning/40 bg-warning/5">
          <div className="flex items-center gap-2 text-warning font-bold mb-1">
            <AlertTriangle className="w-5 h-5" />
            فيه {pendingIncoming.length} تحويل وارد لسه محتاج تأكيد استلام
          </div>
          <div className="text-sm text-muted-foreground">
            إجمالي <span className="font-bold text-foreground">{formatEGP(pendingIncomingTotal)}</span> —
            الفلوس دي <span className="font-bold">لسه مش مضافة لرصيد الخزنة</span>، هتتضاف أول ما تأكد الاستلام من تبويب «تحويلات بين الفروع».
          </div>
        </div></PermPart>
      )}


      <Tabs value={initialTab} onValueChange={(v) => setSearchParams((p) => { p.set("tab", v); return p; }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="movements">حركات الخزنة</TabsTrigger>
          <TabsTrigger value="reversals">الحركات العكسية والإلغاءات</TabsTrigger>
          <TabsTrigger value="receipts">سندات القبض</TabsTrigger>
          <TabsTrigger value="payments">سندات الصرف</TabsTrigger>
          <TabsTrigger value="transfers">تحويلات بين الفروع ({transfers.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="receipts" className="mt-4">
          <VouchersTable branchId={branchId} type="receipt" />
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <VouchersTable branchId={branchId} type="payment" />
        </TabsContent>



        <TabsContent value={reversalView ? "reversals" : "movements"} className="mt-4">
          {reversalView && (
            <div className="card-elevated p-3 mb-4 text-xs text-muted-foreground leading-6">
              هنا الحركات اللي بتلغي حركة تانية بس: إلغاء سند، إلغاء مرتجع، رد فلوس فاتورة ملغاة، إلغاء أو تعديل دفعة وعمولتها، وقيود التصحيح العكسية.
              هي داخلة في رصيد الخزنة وفي الكروت فوق عادي — اتشالت من جدول «حركات الخزنة» عشان يفضل نضيف.
            </div>
          )}
          <PermPart page="treasury" part="filters"><div className="card-elevated p-4 mb-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-sm">
                فلاتر حركات الخزينة{" "}
                <span className="text-muted-foreground font-normal">
                  (يعرض {shownCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} - {Math.min(page * PAGE_SIZE, shownCount)} من أصل {shownCount} حركة)
                </span>
              </h3>
              <Button size="sm" variant="ghost" onClick={resetFilters}>مسح الفلاتر</Button>
            </div>
            <div className="flex flex-wrap gap-2 items-center text-xs">
              <span className="text-muted-foreground">اختصارات:</span>
              {DATE_SHORTCUTS.map((s) => (
                <Button key={s.label} size="sm" variant="outline" className="h-7 rounded-full" onClick={() => { const [f, t] = s.range(); setPeriod(f, t); }}>
                  {s.label}
                </Button>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div><Label className="text-xs">بحث (رقم العملية / البيان / التصنيف...)</Label>
                <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} className="mt-1 h-9" /></div>
              <div><Label className="text-xs">من تاريخ</Label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="mt-1 h-9" /></div>
              <div><Label className="text-xs">إلى تاريخ</Label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="mt-1 h-9" /></div>

              <div><Label className="text-xs">النوع</Label>
                <Select value={tab} onValueChange={(v) => setTab(v as any)}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="income">دخول</SelectItem>
                    <SelectItem value="expense">خروج</SelectItem>
                  </SelectContent>
                </Select></div>
              <div><Label className="text-xs">بحث الملاحظات</Label>
                <Input value={notesText} onChange={(e) => setNotesText(e.target.value)} className="mt-1 h-9" /></div>
              <div><Label className="text-xs">المبلغ من</Label>
                <Input type="number" min={0} placeholder="0" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="mt-1 h-9" /></div>

              <div><Label className="text-xs">الوعاء / طريقة الدفع</Label>
                <Select value={methodFilter} onValueChange={(v) => setMethodFilter(v as any)}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الأوعية</SelectItem>
                    {(["cash","vodafone","instapay","bank"] as PaymentMethod[]).map((m) => (
                      <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select></div>
              <div><Label className="text-xs">المبلغ إلى</Label>
                <Input type="number" min={0} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className="mt-1 h-9" /></div>
            </div>
          </div></PermPart>

          <TooltipProvider delayDuration={200}>
          <PermPart page="treasury" part="selection_bar"><TreasurySelectionBar rows={Array.from(selected.values())} branchId={branchId!} onSelectPage={() => setSelected(new Map(filtered.map((r: any) => [r.id, r])))}
                                onClear={() => setSelected(new Map())} /></PermPart>
          <DataTable permPage="treasury" permTable="moves" loading={wholeMode ? !listRes : loading} rows={filtered} indexColumn={{ offset: (page - 1) * PAGE_SIZE }} minTableWidth="1500px"
            excel={{ id: reversalView ? "reversals" : "movements", server: tableAdapter }}
            getRowKey={(r: any) => r.id}
            isRowExpanded={(r: any) => expandedId === r.id}
            renderExpandedRow={(r: any) => <MovementDetailsRow r={r} branchId={branchId!} />}
            footer={filtered.length ? (
              <div className="flex flex-wrap items-center justify-end gap-4 px-3 py-2 text-sm">
                <span>داخل {wholeMode ? "في كل الصفحات" : "في الصفحة"}: <b className="text-success tabular-nums">{formatEGP(footerRows.filter((r: any) => r.type === "income").reduce((x: number, r: any) => x + Number(r.amount || 0), 0))}</b></span>
                <span>خارج {wholeMode ? "في كل الصفحات" : "في الصفحة"}: <b className="text-destructive tabular-nums">{formatEGP(footerRows.filter((r: any) => r.type !== "income").reduce((x: number, r: any) => x + Number(r.amount || 0), 0))}</b></span>
              </div>
            ) : undefined}
            columns={[
              // owner order 2026-10-16: ✓ · رقم السند · اسم الحساب · المبلغ · التصنيف · طريقة الدفع · التاريخ · الحالة · المصدر · … · إجراءات
              { key: "__sel", header: "✓", align: "center", className: "w-[40px]", render: (r: any) => (
                <input type="checkbox" className="h-4 w-4 accent-primary cursor-pointer" checked={selected.has(r.id)}
                       onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(r)} aria-label="تحديد الحركة" />
              ) },
              { key: "reference_number", header: "رقم السند", align: "center", width: "10rem", render: (r: any) => (
                <span className="inline-flex items-center gap-1">
                  <button type="button" aria-label={expandedId === r.id ? "إخفاء تفاصيل الحركة" : "عرض تفاصيل الحركة"} aria-expanded={expandedId === r.id}
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                          onClick={(e) => { e.stopPropagation(); setExpandedId((c) => c === r.id ? null : r.id); }}>
                    <ChevronDown className={`h-4 w-4 transition-transform ${expandedId === r.id ? "rotate-180" : ""}`} />
                  </button>
                  <Badge variant="secondary" dir="ltr" className="unicode-isolate rounded-md font-mono text-xs font-bold">
                    {resolveTreasuryOperationNumber(r.voucher_number, r.invoice_number, r.reference_number)}
                  </Badge>
                </span>
              )},
              { key: "account", header: "اسم الحساب", align: "right", className: "min-w-[170px] text-right", render: (r: any) => <AccountCell name={r.__account} /> },
              { key: "amount", header: "المبلغ", align: "center", width: "9rem", numeric: true, render: (r: any) => (
                <span dir="ltr" className={`unicode-isolate inline-block font-bold ${r.type === "income" ? "text-success" : "text-destructive"}`}>
                  {r.type === "income" ? "+" : "−"} {formatEGP(r.amount)}
                </span>
              )},
              { key: "category", header: "التصنيف", align: "center", width: "10rem", render: (r: any) => (
                <span>{treasuryCategoryLabel(r.category)}{r.is_fee ? <span className="ml-1 text-warning text-xs">(عمولة)</span> : null}</span>
              )},
              { key: "payment_method", header: "طريقة الدفع", align: "center", width: "7rem", render: (r: any) => payMethodLabel(r.payment_method) },
              { key: "transaction_date", header: "التاريخ", align: "center", width: "8rem", render: (r: any) => formatDate(r.transaction_date) },
              { key: "status", header: "الحالة", align: "center", width: "6rem", render: (r: any) => r.voucher_status === "cancelled"
                ? <span className="font-semibold text-destructive">سند ملغي</span> : <span>نشط</span> },
              { key: "source", header: "المصدر", align: "center", width: "10rem", render: (r: any) => (
                <SourceCell link={r.__link} branchId={branchId!} source={r.voucher_source}
                            fallback={!r.voucher_id && !r.__link?.src_type ? treasuryCategoryLabel(r.category) : null} />
              )},
              { key: "balance_after", header: methodFilter === "all" ? "الرصيد بعد الحركة" : "رصيد الوعاء بعد الحركة", align: "center", width: "9rem", numeric: true, render: (r: any) => r.balance_after == null ? "—" : (
                <span dir="ltr" className={`tabular-nums font-semibold ${r.balance_after < 0 ? "text-destructive" : ""}`}>{formatEGP(r.balance_after)}</span>
              )},
              { key: "recipient", header: "المستلم", align: "center", width: "8rem", render: (r: any) => r.recipient_name
                ? <span className="block truncate max-w-[9rem] mx-auto" title={r.recipient_name}>{r.recipient_name}</span> : <span className="text-muted-foreground">—</span> },
              { key: "description", header: "البيان", align: "right", width: "16rem", className: "whitespace-normal break-words leading-6", render: (r: any) => {
                const text = sanitizeOperationalDescription(r.description);
                return text ? <span dir="rtl" className="unicode-isolate block w-full whitespace-normal break-words text-right line-clamp-2" title={text}>{text}</span> : "—";
              }},
              { key: "actions", header: "إجراءات", align: "center", width: "12rem", render: (r: any) => (
                <div className="flex items-center justify-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="عرض الحركة" onClick={() => setViewMovement(r as TreasuryMovement)}>
                    <Eye className="w-4 h-4" />
                  </Button>
                  {r.voucher_id && <PrintDocButton kind={r.type === "income" ? "income" : "expense"} id={r.voucher_id} title="طباعة السند" />}
                  {r.voucher_id && r.voucher_status === "active" && (
                    <DocAnnotationsButton kind="voucher" id={r.voucher_id} recipient={r.recipient_name} notes={r.voucher_description ?? r.description} onSaved={() => load()} />
                  )}
                  {r.voucher_id ? (
                    <AttachmentsDialogButton recordType="voucher" recordId={r.voucher_id} count={movementAttCounts[r.voucher_id] ?? 0}
                                             canEdit={r.voucher_status === "active"} label={`مرفقات السند ${r.voucher_number ?? ""}`} />
                  ) : null}
                </div>
              )},
            ]} />
          </TooltipProvider>
          {pageCount > 1 && (
            <div className="mt-4 flex justify-center">
              <NumberedPagination page={page} pageCount={pageCount} onChange={setPage} disabled={loading} />
            </div>
          )}


        </TabsContent>

        <TabsContent value="transfers" className="mt-4">
          <DataTable permPage="treasury" permTable="transfers" loading={loading} rows={transfers} indexColumn
            onRowClick={(r: any) => setViewTransfer(r)}
            columns={[
              { key: "details", header: "تفاصيل", align: "center", width: "5rem", render: (r: any) => (
                <DetailsChevron label="عرض تفاصيل التحويل" onClick={() => setViewTransfer(r)} />
              )},
              { key: "created_at", header: "التاريخ", render: (r: any) => formatDateTime(r.created_at) },
              { key: "direction", header: "الاتجاه", render: (r: any) => (
                r.from_branch_id === branchId
                  ? <span className="text-destructive font-bold">↗ صادر</span>
                  : <span className="text-success font-bold">↘ وارد</span>
              )},
              { key: "from", header: "من", render: (r: any) => r.from_branch?.name ?? "—" },
              { key: "to", header: "إلى", render: (r: any) => r.to_branch?.name ?? "—" },
              { key: "amount", header: "المبلغ", render: (r: any) => <span className="font-bold">{formatEGP(r.amount)}</span> },
              { key: "method", header: "طريقة الدفع", render: (r: any) => (
                <span className="text-xs">{PAYMENT_METHOD_LABELS[(r.payment_method ?? "cash") as PaymentMethod]}</span>
              )},
              { key: "fee", header: "عمولة", render: (r: any) => Number(r.fee_amount) > 0 ? <span className="text-warning text-xs">{formatEGP(r.fee_amount)}</span> : "—" },
              { key: "ref", header: "رقم العملية", render: (r: any) => r.reference_number ?? "—" },
              { key: "reason", header: "السبب", render: (r: any) => r.reason ?? "—" },
              { key: "ack", header: "الحالة", render: (r: any) => (
                r.rejected_at
                  ? <span className="text-xs px-2 py-1 rounded bg-destructive/15 text-destructive font-bold">✗ مرفوض</span>
                  : r.acknowledged_at
                  ? <span className="text-xs px-2 py-1 rounded bg-success/15 text-success font-bold">✓ مؤكد {formatDateTime(r.acknowledged_at)}</span>
                  : r.to_branch_id === branchId && canAck
                    ? (
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="outline" onClick={() => acknowledge(r)}><CheckCircle2 className="w-3.5 h-3.5 ml-1" /> تأكيد</Button>
                        <Button size="sm" variant="outline" className="text-destructive" onClick={() => setOpenReject(r)}><XCircle className="w-3.5 h-3.5 ml-1" /> رفض</Button>
                      </div>
                    )
                    : <span className="text-xs px-2 py-1 rounded bg-warning/15 text-warning">بانتظار التأكيد</span>
              )},
              { key: "actions", header: "الإجراءات", render: (r: any) => (
                <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                  <AttachmentsDialogButton recordType="treasury_transfer" recordId={r.id} count={transferAttCounts[r.id] ?? 0} />
                </div>
              )},
            ]} />
        </TabsContent>
      </Tabs>

      <Dialog open={openTransfer} onOpenChange={setOpenTransfer}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>تحويل لفرع آخر</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border-r-4 border-primary bg-primary/5 p-3 text-sm leading-7">
              بتحوّل من <b>خزنة {branches.find((b) => b.id === branchId)?.name ?? "الفرع الحالي"}</b> (وعاء{" "}
              <b>{PAYMENT_METHOD_LABELS[tPayment.method]}</b>
              {canSeeBalances && <> — المتاح: <b className="tabular-nums">{formatEGP(walletBalances[`${tPayment.method}_balance` as keyof WalletBalances])}</b></>})
              {" "}لفرع <b>{branches.find((b) => b.id === tForm.to)?.name ?? "— اختر الفرع —"}</b>.
              <div className="text-xs text-muted-foreground mt-1">
                الفلوس بتتخصم من خزنتك على طول، ومش بتدخل خزنة الفرع التاني غير لما يأكّد الاستلام.
              </div>
            </div>
            {canSeeBalances && (
              <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-0.5">
                <div>الإجمالي الكلي في خزنتك: <span className="font-bold">{formatEGP(walletBalances.total_balance)}</span></div>
              </div>
            )}

            <div>
              <Label>الفرع المستهدف *</Label>
              <select className="w-full bg-input border border-border rounded-lg p-2 mt-1.5" value={tForm.to} onChange={(e) => setTForm({...tForm, to: e.target.value})}>
                <option value="">— اختر —</option>
                {otherBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div><Label>المبلغ *</Label><Input type="number" value={tForm.amount} onChange={(e) => setTForm({...tForm, amount: e.target.value})} className="mt-1.5" /></div>
            <div><Label>السبب</Label><Textarea value={tForm.reason} onChange={(e) => setTForm({...tForm, reason: e.target.value})} className="mt-1.5" rows={2} /></div>
            <PaymentMethodPicker amount={Number(tForm.amount) || 0} value={tPayment} onChange={setTPayment} label="طريقة التنفيذ" />
            {tPayment.fee_amount > 0 && (
              <div className="rounded-lg border border-border p-3 bg-muted/30 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <div className="font-medium">هل اتخصمت العمولة فعلاً؟ ({formatEGP(tPayment.fee_amount)})</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {tFeeCharged
                        ? "العمولة هتفضل كمصروف لو الفرع التاني رفض"
                        : "العمولة هترجع للخزنة لو الفرع التاني رفض"}
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
                    <input type="checkbox" checked={tFeeCharged} onChange={(e) => setTFeeCharged(e.target.checked)} className="w-4 h-4" />
                    <span className="text-xs">اتخصمت</span>
                  </label>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenTransfer(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={transfer}>تحويل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={!!openReject} onOpenChange={(v) => !v && setOpenReject(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-destructive">رفض التحويل</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              المبلغ {openReject && formatEGP(openReject.amount)} سيُعاد لخزينة المرسِل. العمولة (إن وُجدت) لا تُسترد.
            </p>
            <div>
              <Label>سبب الرفض *</Label>
              <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="mt-1.5" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpenReject(null); setRejectReason(""); }}>إلغاء</Button>
            <Button variant="destructive" onClick={reject}>تأكيد الرفض</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewTransfer} onOpenChange={(o) => !o && setViewTransfer(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              تحويل خزنة — {formatEGP(Number(viewTransfer?.amount ?? 0))}
            </DialogTitle>
          </DialogHeader>
          {viewTransfer && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 bg-surface-2 rounded-lg p-3">
                <div><span className="text-muted-foreground">من:</span> <b>{viewTransfer.from_branch?.name ?? "—"}</b></div>
                <div><span className="text-muted-foreground">إلى:</span> <b>{viewTransfer.to_branch?.name ?? "—"}</b></div>
                <div><span className="text-muted-foreground">التاريخ:</span> {formatDateTime(viewTransfer.created_at)}</div>
                <div><span className="text-muted-foreground">طريقة الدفع:</span> {PAYMENT_METHOD_LABELS[(viewTransfer.payment_method ?? "cash") as PaymentMethod]}</div>
                {Number(viewTransfer.fee_amount) > 0 && (
                  <div><span className="text-muted-foreground">العمولة:</span> <span className="text-warning">{formatEGP(viewTransfer.fee_amount)}</span></div>
                )}
                {viewTransfer.reference_number && (
                  <div><span className="text-muted-foreground">رقم العملية:</span> {viewTransfer.reference_number}</div>
                )}
                {viewTransfer.reason && (
                  <div className="col-span-2"><span className="text-muted-foreground">السبب:</span> {viewTransfer.reason}</div>
                )}
                <div className="col-span-2">
                  <span className="text-muted-foreground">الحالة:</span>{" "}
                  {viewTransfer.rejected_at ? (
                    <span className="text-destructive font-bold">مرفوض</span>
                  ) : viewTransfer.acknowledged_at ? (
                    <span className="text-success font-bold">مؤكد — {formatDateTime(viewTransfer.acknowledged_at)}</span>
                  ) : (
                    <span className="text-warning font-bold">بانتظار التأكيد</span>
                  )}
                </div>
              </div>
              <RecordAttachments recordType="treasury_transfer" recordId={viewTransfer.id} />
            </div>
          )}
        </DialogContent>
      </Dialog>
      <TreasuryMovementDialog
        movement={viewMovement}
        open={!!viewMovement}
        onOpenChange={(o) => { if (!o) setViewMovement(null); }}
        branchName={branches.find((b) => b.id === branchId)?.name}
      />


    </BranchLayout>
  );
}

/** The arrow under a till row: the voucher, the document it came from, who entered it and when, its receipt. */
function MovementDetailsRow({ r, branchId }: { r: any; branchId: string }) {
  const l: TreasuryLink | null = r.__link;
  const Item = ({ k, children }: { k: string; children: ReactNode }) => (
    <div className="flex gap-2"><span className="text-muted-foreground whitespace-nowrap">{k}:</span><span className="font-semibold">{children}</span></div>
  );
  return (
    <div className="space-y-2 bg-muted/30 p-3 text-xs" dir="rtl">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Item k="اسم الحساب">{r.__account ?? "—"}</Item>
        <Item k="المصدر"><SourceCell link={l} branchId={branchId} source={r.voucher_source} fallback={!r.voucher_id && !l?.src_type ? treasuryCategoryLabel(r.category) : null} /></Item>
        <Item k="السند">{r.voucher_number ?? "—"}{r.voucher_status === "cancelled" ? " (ملغي)" : ""}</Item>
        <Item k="داخل / خارج">{r.type === "income" ? "داخل" : "خارج"} • {payMethodLabel(r.payment_method)}{r.reference_number ? ` • رقم العملية ${r.reference_number}` : ""}</Item>
        <Item k="تاريخ الحركة">{formatDate(r.transaction_date)}</Item>
        <Item k="اتسجلت فعلياً">{formatDateTime(r.created_at)}</Item>
        {l?.cancelled_voucher_number && <Item k="بتلغي">السند {l.cancelled_voucher_number}</Item>}
      </div>
      {r.voucher_id && <RecordAttachments recordType="voucher" recordId={r.voucher_id} />}
    </div>
  );
}

/** Selection bar of the till table: totals in / out, open the vouchers as tabs, print them, export the rows. */
function TreasurySelectionBar({ rows, branchId, onSelectPage, onClear }: { rows: any[]; branchId: string; onSelectPage: () => void; onClear: () => void }) {
  const nav = useNavigate();
  const inSum = rows.filter((r) => r.type === "income").reduce((x, r) => x + Number(r.amount || 0), 0);
  const outSum = rows.filter((r) => r.type !== "income").reduce((x, r) => x + Number(r.amount || 0), 0);
  const withVoucher = rows.filter((r) => r.voucher_id);
  const openAll = () => {
    const list = withVoucher.slice(0, OPEN_DOCS_MAX).map((r) => ({ path: `/branch/${branchId}/vouchers/${r.voucher_id}`, label: r.voucher_number ?? "سند" }));
    if (!list.length) return toast.info("الحركات المحددة مالهاش سندات تتفتح");
    openDocs(list);
    if (withVoucher.length > OPEN_DOCS_MAX) toast.info(`اتفتح أول ${OPEN_DOCS_MAX} بس — أقصى عدد تابات`);
    nav(list[0].path);
  };
  const printAll = async (format: "a4" | "thermal") => {
    try {
      const rec = withVoucher.filter((r) => r.type === "income").map((r) => r.voucher_id);
      const pay = withVoucher.filter((r) => r.type !== "income").map((r) => r.voucher_id);
      if (!rec.length && !pay.length) return toast.info("الحركات المحددة مالهاش سندات تتطبع");
      if (rec.length) await printDocuments("income", rec, format);
      if (pay.length) await printDocuments("expense", pay, format);
    } catch (e: any) { toast.error(e?.message ?? "تعذر الطباعة"); }
  };
  const exportSel = () => exportToExcel("حركات-خزنة-محددة", [{
    name: "الحركات",
    rows: rows.map((r, i) => ({
      "#": i + 1, "رقم السند": resolveTreasuryOperationNumber(r.voucher_number, r.invoice_number, r.reference_number), "اسم الحساب": r.__account ?? "",
      "داخل": r.type === "income" ? Number(r.amount) : 0, "خارج": r.type !== "income" ? Number(r.amount) : 0, "التصنيف": treasuryCategoryLabel(r.category),
      "طريقة الدفع": payMethodLabel(r.payment_method), "التاريخ": formatDate(r.transaction_date), "الحالة": r.voucher_status === "cancelled" ? "سند ملغي" : "نشط",
      "الرصيد بعد الحركة": r.balance_after ?? "", "البيان": sanitizeOperationalDescription(r.description) ?? "",
    })),
  }]);
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <Button size="sm" variant="ghost" className="h-7" onClick={onSelectPage}>تحديد كل الصفحة</Button>
      {rows.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 shadow-sm">
          <span className="font-bold">محدد {rows.length} حركة</span>
          <span>داخل <b className="text-success tabular-nums">{formatEGP(inSum)}</b></span>
          <span>خارج <b className="text-destructive tabular-nums">{formatEGP(outSum)}</b></span>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={openAll}><Layers className="h-3.5 w-3.5" />فتح السندات</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => printAll("a4")}><Printer className="h-3.5 w-3.5" />طباعة A4</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => printAll("thermal")}><Printer className="h-3.5 w-3.5" />طباعة حراري</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={exportSel}><FileSpreadsheet className="h-3.5 w-3.5" />تصدير المحدد</Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={onClear}>إلغاء التحديد</Button>
        </div>
      )}
    </div>
  );
}
