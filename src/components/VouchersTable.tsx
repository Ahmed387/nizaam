import { useEffect, useMemo, useRef, useState } from "react";
import { PermCard } from "@/contexts/PermCustomize";
import { PermTable } from "@/components/PermTable";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "./DataTable";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Checkbox } from "./ui/checkbox";
import { VoucherDialog } from "./VoucherDialog";
import { InlineVoucherDate } from "./InlineVoucherDate";
import { VoucherViewDialog } from "./VoucherViewDialog";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { fetchVoucherCategories, PARTY_TYPE_LABEL, Voucher, VoucherCategory, VoucherType, VOUCHER_TYPE_LABEL } from "@/lib/vouchers";
import { PAYMENT_METHOD_LABELS } from "@/lib/paymentMethods";
import { formatEGP, formatDate } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, XCircle, Eye, Pencil, Printer, FileDown, ChevronDown, Check } from "lucide-react";
import { DetailsChevron } from "@/components/DetailsChevron";
import { toast } from "sonner";
import { exportToExcel, printReport } from "@/lib/export";
import { useAttachmentCounts } from "@/hooks/useAttachmentCounts";
import { AttachmentsDialogButton } from "@/components/AttachmentsDialogButton";
import { generateVouchersReport } from "@/utils/generatePDFReport";
import { useBranchScope } from "@/lib/branchScope";
import { fetchAllRows } from "@/lib/fetchAll";
import { fetchTreasuryLinks, payMethodLabel, type TreasuryLink } from "@/lib/treasuryLinks";
import { AccountCell, SourceCell } from "@/components/documents/MoneyCells";
import { BulkActionsBar } from "@/components/documents/BulkActionsBar";
import { NumberedPagination } from "@/components/NumberedPagination";
import { useLocation } from "react-router-dom";
import { useListFilter, useRememberedFilter } from "@/hooks/useListFilter";
import { readAll, useWholeList } from "@/hooks/useWholeList";
import { periodOfFilter, singleValueOf, valuesOf, withPeriod, withSingleValue, withValues, type FilterState, type ListColumn } from "@/lib/tableFilter";
import { sourceText } from "@/lib/documentListColumns";

const PAGE = 50;
/** «طريقة الدفع» as the column shows it (payMethodLabel) → the bar's value */
const METHOD_KEY: Record<string, string> = { كاش: "cash", محفظة: "vodafone", انستاباي: "instapay", بنكي: "bank" };

interface Props {
  branchId?: string;
  type?: VoucherType; // undefined => show all
  adminAllBranches?: boolean;
  tenantId?: string;
  initialFrom?: string;
  initialTo?: string;
  /** يقصر القائمة على سندات الصرف النشطة في تصنيفات «تُخصم من الربح» (نفس معادلة الداشبورد) */
  onlyDeductedFromProfit?: boolean;
}

export function VouchersTable({ branchId, type, adminAllBranches, tenantId, initialFrom, initialTo, onlyDeductedFromProfit }: Props) {
  const { isAdmin, hasRole, user, profile } = useAuth();
  const [rows, setRows] = useState<Voucher[]>([]);
  const [cats, setCats] = useState<VoucherCategory[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const { filterBranches } = useBranchScope();
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Voucher | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [viewTarget, setViewTarget] = useState<Voucher | null>(null);
  const [editTarget, setEditTarget] = useState<Voucher | null>(null);
  const [editFocusDate, setEditFocusDate] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const deductibleRef = useRef<string[] | null>(null);
  // ===== Excel filters (owner 2026-10-26), remembered per screen and type. The bar's period, type, categories, wallet
  // and branch ARE the «التاريخ» / «النوع» / «التصنيف» / «طريقة الدفع» / «الفرع» column filters (both stay, linked);
  // the bar's «المصدر» (the voucher's own: يدوي / تلقائي) and the search stay its own. =====
  const { pathname } = useLocation();
  const [colState, setColState] = useRememberedFilter(`xf:v1:${pathname}:vouchers:${type ?? "all"}${onlyDeductedFromProfit ? ":ded" : ""}`);
  // a link from a report (?startDate / ?endDate) opens on its period
  useEffect(() => {
    if (initialFrom || initialTo) setColState(withPeriod(colState, "voucher_date", initialFrom ?? "", initialTo ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [sourceF, setSourceF] = useState("");
  const vPeriod = periodOfFilter(colState, "voucher_date");
  const vCats = valuesOf(colState, "category");
  const catIdsKey = cats.filter((c) => vCats.includes(c.name)).map((c) => c.id).join(",");
  const vMethod = METHOD_KEY[singleValueOf(colState, "payment_method")] ?? "";
  const vBranch = branches.find((b) => b.name === singleValueOf(colState, "branch"))?.id ?? "";
  const vType: "" | VoucherType = type ? "" : (Object.keys(VOUCHER_TYPE_LABEL) as VoucherType[]).find((k) => VOUCHER_TYPE_LABEL[k] === singleValueOf(colState, "type")) ?? "";
  const filters = useMemo(() => ({
    from: vPeriod.from, to: vPeriod.to,
    category_ids: catIdsKey ? catIdsKey.split(",") : [],
    payment_method: vMethod, source: sourceF, branch_id: vBranch, type: vType,
  }), [vPeriod.from, vPeriod.to, catIdsKey, vMethod, sourceF, vBranch, vType]);
  /** the bar writes the fields it changed into the columns' filters (a value ticked only in an arrow stays) */
  const setFilters = (f: typeof filters) => {
    let st: FilterState = colState;
    if (f.from !== filters.from || f.to !== filters.to) st = withPeriod(st, "voucher_date", f.from, f.to);
    if (f.category_ids.join(",") !== filters.category_ids.join(","))
      st = withValues(st, "category", f.category_ids.map((id) => cats.find((c) => c.id === id)?.name ?? ""));
    if (f.payment_method !== filters.payment_method) st = withSingleValue(st, "payment_method", f.payment_method ? payMethodLabel(f.payment_method) : "");
    if (f.branch_id !== filters.branch_id) st = withSingleValue(st, "branch", branches.find((b) => b.id === f.branch_id)?.name ?? "");
    if (!type && f.type !== filters.type) st = withSingleValue(st, "type", f.type ? VOUCHER_TYPE_LABEL[f.type] : "");
    if (st !== colState) setColState(st);
    if (f.source !== filters.source) setSourceF(f.source);
  };
  /** the period and the bar's own choices run in the database; several values, other columns or a sort on the whole list */
  const needsWholeV = (st: FilterState) => !!st.sort || Object.entries(st.filters).some(([k, f]) => !(
    (k === "voucher_date" && f.kind === "date" && !f.days?.length)
    || (k === "type" && f.kind === "values" && f.values.length === 1 && Object.values(VOUCHER_TYPE_LABEL).includes(f.values[0]))
    || (k === "payment_method" && f.kind === "values" && f.values.length === 1 && !!METHOD_KEY[f.values[0]])
    || (k === "branch" && f.kind === "values" && f.values.length === 1 && branches.some((b) => b.name === f.values[0]))
    || (k === "category" && f.kind === "values" && f.values.length > 0 && f.values.every((v) => cats.some((c) => c.name === v)))));

  const canAdd = !!branchId && (isAdmin || hasRole("branch_manager"));

  // Cancelled vouchers never sit in the main table — they have their own «الملغاة» view.
  const [showCancelled, setShowCancelled] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchText, setSearchText] = useState("");
  useEffect(() => { const t = setTimeout(() => setSearchText(searchInput.trim()), 300); return () => clearTimeout(t); }, [searchInput]);
  const [agg, setAgg] = useState({ totalIn: 0, totalOut: 0, countIn: 0, countOut: 0 });
  const [links, setLinks] = useState<Map<string, TreasuryLink>>(new Map());
  // a row of the whole list carries its own link; a row of the page reads the page's links
  const linkOf = (r: any) => r.__link ?? (r.treasury_id ? links.get(r.treasury_id) : undefined) ?? null;
  // one page of 50 from the database; the Excel filters read the whole list (owner 2026-10-26)
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const accountOf = (r: any) => linkOf(r)?.account_name ?? r.party_name ?? null;
  // selection (owner request 2026-10-16) — one voucher type per table
  const [selected, setSelected] = useState<Map<string, any>>(new Map());
  useEffect(() => { setSelected(new Map()); }, [branchId, type, filters, searchText, showCancelled]);
  const toggleSel = (r: any) => setSelected((prev) => { const n = new Map(prev); if (n.has(r.id)) n.delete(r.id); else n.set(r.id, { ...r, __account: accountOf(r) }); return n; });

  /**
   * Same filter set for the table rows and the full-scope totals. The whole list (`whole`) leaves out the type /
   * categories / wallet / branch picked on top: they are applied in memory like any column filter, so their arrows
   * still list every value with its count, as in Excel.
   */
  const applyFilters = (q: any, deductibleIds: string[] | null, whole = false) => {
    if (branchId) q = q.eq("branch_id", branchId);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    if (type) q = q.eq("type", type);
    if (!whole && filters.type) q = q.eq("type", filters.type);
    if (filters.from) q = q.gte("voucher_date", filters.from);
    if (filters.to) q = q.lte("voucher_date", filters.to);
    if (!whole && filters.category_ids.length) q = q.in("category_id", filters.category_ids);
    if (!whole && filters.payment_method) q = q.eq("payment_method", filters.payment_method);
    if (filters.source) q = q.eq("source", filters.source);
    if (!whole && filters.branch_id) q = q.eq("branch_id", filters.branch_id);
    if (searchText) {
      const term = searchText.replace(/[,()*%]/g, " ").trim();
      if (term) q = q.or(`voucher_number.ilike.%${term}%,party_name.ilike.%${term}%,description.ilike.%${term}%`);
    }
    if (deductibleIds) {
      q = q.eq("type", "payment").eq("status", "active").in("category_id", deductibleIds.length ? deductibleIds : ["00000000-0000-0000-0000-000000000000"]);
    }
    return q;
  };

  const deductibleIdsOf = async () => {
    if (!onlyDeductedFromProfit) return null;
    const { data: dc } = await supabase.from("voucher_categories").select("id").eq("is_deductible_from_profit", true);
    return (dc ?? []).map((c: any) => c.id) as string[];
  };
  /** the vouchers of the view (active / cancelled) under the bar's filters, newest first */
  const viewQuery = (select: string, count: boolean, deductibleIds: string[] | null, whole = false) => applyFilters(
    supabase.from("vouchers" as any).select(select, count ? { count: "exact" } : undefined).eq("status", showCancelled ? "cancelled" : "active")
      .order("voucher_date", { ascending: false }).order("created_at", { ascending: false }).order("id"),
    deductibleIds, whole,
  );
  const load = async () => {
    setLoading(true);
    const deductibleIds = await deductibleIdsOf();
    deductibleRef.current = deductibleIds;
    const start = (page - 1) * PAGE;
    const rowsQ = viewQuery("*", true, deductibleIds).range(start, start + PAGE - 1);
    // Totals cover every matching active voucher, not just the 500 displayed rows.
    const totalsP = fetchAllRows<{ type: string; amount: number }>(() =>
      applyFilters(supabase.from("vouchers" as any).select("type,amount").eq("status", "active").order("id"), deductibleIds),
    );
    const [{ data, error, count: n }, totals] = await Promise.all([rowsQ, totalsP.catch((e) => { toast.error(e.message); return []; })]);
    if (error) toast.error(error.message);
    const list = (data ?? []) as unknown as Voucher[];
    setCount(n ?? list.length);
    // «اسم الحساب» / «المصدر»: an automatic voucher takes the customer / supplier of its document (0099)
    const lk = await fetchTreasuryLinks(list.map((v: any) => v.treasury_id)).catch(() => new Map<string, TreasuryLink>());
    setLinks(lk);
    setRows(list);
    const a = { totalIn: 0, totalOut: 0, countIn: 0, countOut: 0 };
    for (const t of totals) {
      const amt = Math.abs(Number(t.amount) || 0);
      if (t.type === "receipt") { a.totalIn += amt; a.countIn++; } else if (t.type === "payment") { a.totalOut += amt; a.countOut++; }
    }
    setAgg(a);
    setLoading(false);
  };

  useEffect(() => {
    fetchVoucherCategories(type).then(setCats).catch(() => {});
    if (adminAllBranches) {
      supabase.from("branches").select("id,name").eq("is_system", false).order("name").then(({ data }) => setBranches(filterBranches((data ?? [])) as any) as any);
    }
  }, [type, adminAllBranches]);

  const catMap = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c.name])), [cats]);
  const branchMap = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches]);

  // ===== the whole list behind the 50-row pages: every voucher of the period and the bar's own filters =====
  const wholeSig = `${branchId}|${type}|${tenantId}|${filters.from}|${filters.to}|${filters.source}|${searchText}|${onlyDeductedFromProfit}|${showCancelled}`;
  const whole = useWholeList<any>(wholeSig, async (signal) => {
    const ded = await deductibleIdsOf();
    const all = await readAll<any>(() => viewQuery("*", false, ded, true), signal);
    const lk = await fetchTreasuryLinks(all.map((v: any) => v.treasury_id), signal).catch(() => new Map<string, TreasuryLink>());
    return all.map((v: any) => ({ ...v, __link: v.treasury_id ? lk.get(v.treasury_id) ?? null : null }));
  }, { auto: needsWholeV(colState) });
  /** what each column shows */
  const listCols = useMemo<ListColumn<any>[]>(() => [
    { key: "voucher_number", label: "رقم السند", kind: "text", get: (r) => r.voucher_number },
    { key: "account", label: "اسم الحساب", kind: "text", get: (r) => r.__link?.account_name ?? r.party_name },
    { key: "amount", label: "المبلغ", kind: "number", get: (r) => Number(r.amount) || 0, sum: !!(type || onlyDeductedFromProfit), money: true },
    ...(!type ? [{ key: "type", label: "النوع", kind: "text" as const, get: (r: any) => VOUCHER_TYPE_LABEL[r.type as VoucherType] }] : []),
    { key: "category", label: "التصنيف", kind: "text", get: (r) => catMap[r.category_id] },
    { key: "payment_method", label: "طريقة الدفع", kind: "text", get: (r) => payMethodLabel(r.payment_method) },
    { key: "voucher_date", label: "التاريخ", kind: "date", get: (r) => r.voucher_date },
    { key: "status", label: "الحالة", kind: "text", get: (r) => (r.status === "active" ? "نشط" : "ملغي") },
    { key: "source", label: "المصدر", kind: "text", get: (r) => sourceText(r.__link, r.source) },
    { key: "description", label: "البيان / الوصف", kind: "text", get: (r) => r.description },
    ...(adminAllBranches ? [{ key: "branch", label: "الفرع", kind: "text" as const, get: (r: any) => branchMap[r.branch_id] }] : []),
  ], [type, onlyDeductedFromProfit, adminAllBranches, catMap, branchMap]);
  const { result: listRes, adapter: listAdapter, state: colEff, apply } = useListFilter({
    rows: whole.rows, columns: listCols, state: colState, onChange: setColState, ensureRows: whole.ensure,
  });
  const wholeMode = needsWholeV(colEff);
  const colSig = JSON.stringify(colEff);
  useEffect(() => { setPage(1); }, [branchId, type, tenantId, filters, searchText, onlyDeductedFromProfit, showCancelled, colSig]);
  useEffect(() => { setSelected(new Map()); }, [colSig]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [branchId, type, tenantId, filters, searchText, onlyDeductedFromProfit, showCancelled, wholeMode ? 0 : page]);
  useRealtimeRefresh(["vouchers", "voucher_categories"], () => { load(); whole.refresh(); });
  /** the rows shown: a page of the filtered whole list, or the database page */
  const pageRows = wholeMode ? (listRes ? listRes.rows.slice((page - 1) * PAGE, page * PAGE) : []) : rows;
  const shownCount = wholeMode ? (listRes ? listRes.rows.length : 0) : count;
  const tableAdapter = useMemo(() => ({ ...listAdapter, shown: listAdapter.shown ?? count }), [listAdapter, count]);
  const attCounts = useAttachmentCounts("voucher", pageRows.map((r: any) => r.id));

  // the cards: every active voucher of the bar's filters — and of the column filters when one is on
  const summary = useMemo(() => {
    if (wholeMode && listRes && !showCancelled) {
      const a = { totalIn: 0, totalOut: 0, countIn: 0, countOut: 0 };
      for (const t of listRes.colRows) {
        const amt = Math.abs(Number(t.amount) || 0);
        if (t.type === "receipt") { a.totalIn += amt; a.countIn++; } else if (t.type === "payment") { a.totalOut += amt; a.countOut++; }
      }
      return { ...a, net: a.totalIn - a.totalOut };
    }
    return { ...agg, net: agg.totalIn - agg.totalOut };
  }, [agg, wholeMode, listRes, showCancelled]);
  const viewType: VoucherType | "" = type ?? (onlyDeductedFromProfit ? "payment" : filters.type);
  const bulkKind = viewType === "receipt" ? "income" as const : viewType === "payment" ? "expense" as const : null;

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    if (!cancelReason.trim()) return toast.error("اكتب سبب الإلغاء");
    const { error } = await supabase.rpc("cancel_voucher" as any, {
      p_voucher_id: cancelTarget.id,
      p_reason: cancelReason.trim(),
    });
    if (error) return toast.error(error.message);
    toast.success("تم إلغاء السند");
    setCancelTarget(null);
    setCancelReason("");
    load();
  };

  const printVoucher = (r: Voucher) => {
    const w = window.open("", "_blank", "width=720,height=800");
    if (!w) return toast.error("المتصفح منع نافذة الطباعة");
    const esc = (x: any) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const row = (k: string, v: any) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`;
    w.document.write(`<html dir="rtl"><head><title>سند ${esc(r.voucher_number)}</title><style>body{font-family:Tahoma,sans-serif;padding:24px}h2{text-align:center}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:8px;text-align:right}th{width:30%;background:#f2f2f2}</style></head><body>
      <h2>${esc(VOUCHER_TYPE_LABEL[r.type])} رقم ${esc(r.voucher_number)}</h2><PermTable>
      ${row("التاريخ", formatDate(r.voucher_date))}${row("المبلغ", formatEGP(Number(r.amount)))}
      ${row("التصنيف", catMap[r.category_id] ?? "")}${row("اسم الحساب", accountOf(r) ?? "")}
      ${row("طريقة الدفع", PAYMENT_METHOD_LABELS[r.payment_method] ?? "")}${row("الحالة", r.status === "active" ? "نشط" : "ملغي")}
      ${row("الوصف", r.description ?? "")}</PermTable><script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  // Exports fetch every voucher matching the bar's filters (not only the page), then the column filters, in the order shown.
  const fetchAllFiltered = async () => apply(await fetchAllRows<Voucher>(() =>
    applyFilters(supabase.from("vouchers" as any).select("*").order("voucher_date", { ascending: false }).order("created_at", { ascending: false }).order("id"), deductibleRef.current),
  ));
  const runExport = async (fn: (list: Voucher[]) => void) => {
    if (isExporting) return;
    setIsExporting(true);
    const t = toast.loading("جاري تصدير كافة البيانات...");
    try { fn(await fetchAllFiltered()); toast.success("تم التصدير", { id: t }); }
    catch (e: any) { toast.error(e?.message ?? "تعذر التصدير", { id: t }); }
    finally { setIsExporting(false); }
  };
  const toExportRows = (list: Voucher[]) => list.map((r) => ({
    "رقم السند": r.voucher_number,
    "النوع": VOUCHER_TYPE_LABEL[r.type],
    "التاريخ": formatDate(r.voucher_date),
    "التصنيف": catMap[r.category_id] ?? "",
    "المبلغ": Number(r.amount),
    "طريقة الدفع": PAYMENT_METHOD_LABELS[r.payment_method],
    "اسم الحساب": accountOf(r) ?? "",
    "المصدر": r.source === "manual" ? "يدوي" : "تلقائي",
    "الحالة": r.status === "active" ? "نشط" : "ملغي",
    "الوصف": r.description ?? "",
  }));

  return (
    <div className="space-y-4">
      {!onlyDeductedFromProfit && (
        <div className="flex items-center gap-2" role="tablist" aria-label="عرض السندات">
          {[false, true].map((c) => (
            <button key={String(c)} role="tab" aria-selected={showCancelled === c} onClick={() => setShowCancelled(c)}
              className={`px-4 py-1.5 rounded-full text-sm font-bold border transition-colors ${showCancelled === c
                ? (c ? "bg-destructive text-destructive-foreground border-destructive" : "bg-primary text-primary-foreground border-primary")
                : "bg-background border-border text-muted-foreground hover:border-primary/50"}`}>
              {c ? "الملغاة" : "السندات النشطة"}
            </button>
          ))}
          {showCancelled && <span className="text-xs text-muted-foreground">سندات اتلغت وأثرها على الخزنة اتعكس — للمراجعة بس، والكروت فوق محسوبة على النشطة فقط.</span>}
        </div>
      )}
      {viewType ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PermCard label={String(viewType === "receipt" ? "إجمالي القبض" : "إجمالي الصرف")}><div className="card-elevated p-4">
            <div className="text-xs text-muted-foreground">{viewType === "receipt" ? "إجمالي القبض" : "إجمالي الصرف"}</div>
            <div className={`text-xl font-bold ${viewType === "receipt" ? "text-success" : "text-destructive"}`}>
              {formatEGP(viewType === "receipt" ? summary.totalIn : summary.totalOut)}
            </div>
          </div></PermCard>
          <PermCard label="عدد السندات"><div className="card-elevated p-4">
            <div className="text-xs text-muted-foreground">عدد السندات</div>
            <div className="text-xl font-bold tabular-nums">{viewType === "receipt" ? summary.countIn : summary.countOut}</div>
          </div></PermCard>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <PermCard label="إجمالي القبض"><div className="card-elevated p-4">
            <div className="text-xs text-muted-foreground">إجمالي القبض</div>
            <div className="text-xl font-bold text-success">{formatEGP(summary.totalIn)}</div>
          </div></PermCard>
          <PermCard label="إجمالي الصرف"><div className="card-elevated p-4">
            <div className="text-xs text-muted-foreground">إجمالي الصرف</div>
            <div className="text-xl font-bold text-destructive">{formatEGP(summary.totalOut)}</div>
          </div></PermCard>
          <PermCard label="الصافي (القبض − الصرف)"><div className="card-elevated p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>الصافي (القبض − الصرف)</span>
              <Badge variant={summary.net >= 0 ? "secondary" : "destructive"}>{summary.net >= 0 ? "فائض" : "عجز"}</Badge>
            </div>
            <div className={`text-xl font-bold ${summary.net >= 0 ? "text-success" : "text-destructive"}`}>
              {formatEGP(Math.abs(summary.net))}
            </div>
          </div></PermCard>
        </div>
      )}

      <div className="card-elevated p-4 space-y-3">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="ابحث برقم السند أو اسم الجهة أو البيان"
          className="h-9"
          aria-label="بحث في السندات"
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">من تاريخ</Label>
            <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="h-9" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">إلى تاريخ</Label>
            <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="h-9" />
          </div>
          {!type && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">النوع</Label>
              <Select value={filters.type || "all"} onValueChange={(v) => setFilters({ ...filters, type: v === "all" ? "" : v as any })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="receipt">قبض</SelectItem>
                  <SelectItem value="payment">صرف</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">التصنيف</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 w-full justify-between font-normal">
                  <span className="truncate">
                    {filters.category_ids.length === 0
                      ? "كل التصنيفات"
                      : filters.category_ids.length === 1
                        ? (catMap[filters.category_ids[0]] ?? "تصنيف")
                        : `${filters.category_ids.length} تصنيفات مختارة`}
                  </span>
                  <ChevronDown className="w-4 h-4 opacity-60 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" side="bottom" sideOffset={6} avoidCollisions={false} className="w-64 p-2">
                <div className="flex items-center justify-between px-2 py-1 mb-1 border-b">
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => setFilters({ ...filters, category_ids: [] })}
                  >مسح الاختيار</button>
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => setFilters({ ...filters, category_ids: cats.map(c => c.id) })}
                  >تحديد الكل</button>
                </div>
                <div className="max-h-64 overflow-y-auto space-y-0.5">
                  {cats.map((c) => {
                    const checked = filters.category_ids.includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setFilters({
                              ...filters,
                              category_ids: v
                                ? [...filters.category_ids, c.id]
                                : filters.category_ids.filter((id) => id !== c.id),
                            });
                          }}
                        />
                        <span className="flex-1">{c.name}</span>
                        {checked && <Check className="w-3 h-3 text-primary" />}
                      </label>
                    );
                  })}
                  {cats.length === 0 && <div className="text-xs text-muted-foreground p-2">لا يوجد تصنيفات</div>}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">طريقة الدفع</Label>
            <Select value={filters.payment_method || "all"} onValueChange={(v) => setFilters({ ...filters, payment_method: v === "all" ? "" : v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">المصدر</Label>
            <Select value={filters.source || "all"} onValueChange={(v) => setFilters({ ...filters, source: v === "all" ? "" : v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="manual">يدوي</SelectItem>
                <SelectItem value="system">تلقائي</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {adminAllBranches && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">الفرع</Label>
              <Select value={filters.branch_id || "all"} onValueChange={(v) => setFilters({ ...filters, branch_id: v === "all" ? "" : v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الفروع</SelectItem>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 items-center justify-end pt-2 border-t">
          <Button size="sm" variant="outline" disabled={isExporting} onClick={() => runExport((list) => exportToExcel("vouchers", [{ name: "السندات", rows: toExportRows(list) }]))}>
            <FileDown className="w-4 h-4 ms-1" /> Excel
          </Button>
          <Button size="sm" variant="outline" disabled={isExporting} onClick={() => runExport((list) => {
            const branchName = branchId ? (branchMap[branchId] ?? "الفرع") : "كل الفروع";
            generateVouchersReport({
              branchName,
              vouchers: list,
              categoriesMap: catMap,
              branchesMap: branchMap,
              showBranch: !!adminAllBranches,
              filters: { from: filters.from, to: filters.to, type: (filters.type || type || "") as any },
              userName: profile?.name || user?.email || "مستخدم",
            });
          })}>
            <FileDown className="w-4 h-4 ms-1" /> PDF تفصيلي
          </Button>
          {canAdd && (
            <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" /> {type === "receipt" ? "سند قبض جديد" : "سند صرف جديد"}
            </Button>
          )}
        </div>
      </div>


      {bulkKind && (branchId || pageRows[0]?.branch_id) && (
        <BulkActionsBar
          kind={bulkKind}
          branchId={(branchId ?? pageRows[0]?.branch_id)!}
          rows={Array.from(selected.values())}
          totalCount={shownCount}
          onSelectPage={() => setSelected(new Map(pageRows.map((r: any) => [r.id, { ...r, __account: accountOf(r) }])))}
          onClear={() => setSelected(new Map())}
          onDone={() => { setSelected(new Map()); load(); }}
        />
      )}
      <DataTable
        loading={wholeMode ? !listRes : loading}
        rows={pageRows}
        excel={{ id: `vouchers-${type ?? "all"}`, server: tableAdapter }}
        indexColumn={{ offset: (page - 1) * PAGE }}
        onRowClick={(r: Voucher) => setViewTarget(r)}
        columns={[
          // owner order 2026-10-16: ✓ · رقم السند · اسم الحساب · المبلغ · التصنيف · طريقة الدفع · التاريخ · الحالة · المصدر · … · الإجراءات
          ...(bulkKind ? [{ key: "__sel", header: "✓", align: "center" as const, className: "w-[40px]", render: (r: Voucher) => (
            <input type="checkbox" className="h-4 w-4 accent-primary cursor-pointer" checked={selected.has(r.id)}
                   onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(r)} aria-label={`تحديد ${r.voucher_number}`} />
          ) }] : []),
          { key: "voucher_number", header: "رقم السند", render: (r: Voucher) => (
            <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <DetailsChevron label="عرض تفاصيل السند" onClick={() => setViewTarget(r)} />
              <span className="font-mono font-semibold">{r.voucher_number}</span>
            </span>
          ) },
          { key: "account", header: "اسم الحساب", render: (r: Voucher) => <AccountCell name={accountOf(r)} /> },
          { key: "amount", header: "المبلغ", render: (r: Voucher) => (
            <span className={`font-bold ${r.type === "receipt" ? "text-success" : "text-destructive"}`}>
              {formatEGP(Number(r.amount))}
            </span>
          ) },
          ...(!type ? [{ key: "type", header: "النوع", render: (r: Voucher) => (
            <Badge variant={r.type === "receipt" ? "default" : "destructive"}>{VOUCHER_TYPE_LABEL[r.type]}</Badge>
          ) }] : []),
          { key: "category", header: "التصنيف", render: (r: Voucher) => catMap[r.category_id] ?? "—" },
          { key: "payment_method", header: "طريقة الدفع", render: (r: Voucher) => payMethodLabel(r.payment_method) },
          { key: "voucher_date", header: "التاريخ", render: (r: Voucher) => <InlineVoucherDate voucher={r} onSaved={load} /> },
          { key: "status", header: "الحالة", render: (r: Voucher) => (
            r.status === "active"
              ? <Badge variant="default">نشط</Badge>
              : <Badge variant="destructive">ملغي</Badge>
          ) },
          { key: "source", header: "المصدر", render: (r: Voucher) => <SourceCell link={linkOf(r)} branchId={r.branch_id} source={r.source} /> },
          { key: "description", header: "البيان / الوصف", render: (r: Voucher) => (
            <span className="block max-w-[18rem] text-xs whitespace-pre-wrap break-words line-clamp-3" title={r.description ?? ""}>{r.description || "—"}</span>
          ) },
          ...(adminAllBranches ? [{ key: "branch", header: "الفرع", render: (r: Voucher) => branchMap[r.branch_id] ?? "—" }] : []),
          { key: "actions", header: "الإجراءات", render: (r: Voucher) => {
            const canCancel = r.status === "active" && (isAdmin || (hasRole("branch_manager") && r.source === "manual"));
            return (
              <div className="flex items-center gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" onClick={() => setViewTarget(r)} title="عرض السند والمرفقات">
                  <Eye className="w-4 h-4" />
                </Button>
                {isAdmin && r.status === "active" && (
                  <Button size="sm" variant="ghost" onClick={() => setEditTarget(r)} title="تعديل السند">
                    <Pencil className="w-4 h-4" />
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => printVoucher(r)} title="طباعة السند">
                  <Printer className="w-4 h-4" />
                </Button>
                <AttachmentsDialogButton recordType="voucher" recordId={r.id} count={attCounts[r.id] ?? 0} />
                {canCancel && (
                  <Button
                    size="sm" variant="ghost" onClick={() => setCancelTarget(r)} className="text-warning"
                    title="إلغاء السند — يفضل ظاهر في السجلات كـ (ملغي) ويعكس أثره المحاسبي. يُستخدم لو السند اتنفذ بالغلط بعد ما أثّر على الرصيد."
                  >
                    <XCircle className="w-4 h-4" />
                  </Button>
                )}
              </div>
            );
          } },
        ]}
      />
      {shownCount > PAGE && (
        <NumberedPagination page={page} pageCount={Math.max(1, Math.ceil(shownCount / PAGE))} disabled={loading} onChange={setPage} />
      )}


      {canAdd && type && (
        <VoucherDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          branchId={branchId!}
          type={type}
          onSuccess={load}
        />
      )}

      {/* Edit dialog - works for any voucher type */}
      {editTarget && (
        <VoucherDialog
          open={!!editTarget}
          onOpenChange={(o) => { if (!o) { setEditTarget(null); setEditFocusDate(false); } }}
          branchId={editTarget.branch_id}
          type={editTarget.type}
          editingVoucher={editTarget}
          focusDate={editFocusDate}
          onSuccess={load}
        />
      )}

      <Dialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>إلغاء السند {cancelTarget?.voucher_number}</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed">
              <b>إلغاء السند ≠ حذف السند.</b><br />
              السند هيفضل ظاهر في الجدول بحالة <b>«ملغي»</b> مع سبب الإلغاء واسم اللي ألغاه — للتدقيق والمراجعة.<br />
              <b>أثره المحاسبي على الخزينة هيترجع تلقائياً</b> على يوم السند نفسه.<br />
              لو السند ده سند دفعة على فاتورة أو قسط، <b>الدفعة نفسها هتتلغي معاه</b> والفاتورة ترجع مفتوحة بالمبلغ ده. ولو سند رد فلوس فاتورة ملغاة، الفلوس ترجع تحت حساب العميل.
            </div>
            <Label>سبب الإلغاء *</Label>
            <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} />
            {cancelTarget?.source === "system" && cancelTarget.source_type !== "treasury" && (
              <p className="text-sm text-warning">
                السند مرتبط بـ {cancelTarget.source_type}. لإلغائه يجب إلغاء المصدر أولاً.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>تراجع</Button>
            <Button variant="destructive" onClick={confirmCancel}>تأكيد الإلغاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <VoucherViewDialog
        voucher={viewTarget}
        open={!!viewTarget}
        onOpenChange={(o) => !o && setViewTarget(null)}
        categoryName={viewTarget ? catMap[viewTarget.category_id] : undefined}
        onEdit={(v, focus) => { setViewTarget(null); setEditFocusDate(!!focus); setEditTarget(v); }}
      />
    </div>
  );
}
