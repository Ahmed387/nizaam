import { applyCairoRange, cairoTodayDay, addDaysDay, monthStartDay } from "@/lib/cairoDate";
import { NumberedPagination } from "@/components/NumberedPagination";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { formatEGP, formatDate, resolveTreasuryOperationNumber, sanitizeOperationalDescription, treasuryCategoryLabel } from "@/lib/format";
import { TreasuryMovementDialog, TreasuryMovement } from "@/components/TreasuryMovementDialog";
import { DetailsChevron } from "@/components/DetailsChevron";
import { ArrowDownCircle, ArrowUpCircle, Wallet, Store, TrendingUp, Building2, Landmark } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { FinancialAmount } from "@/components/FinancialAmount";
import { ContactCreditBalancesDrawer } from "@/components/ContactCreditBalancesDrawer";
import { GlReconciliationPanel } from "@/components/GlReconciliationPanel";
import { fetchLedgerPosition, fetchOpeningSummary, type LedgerPosition, type OpeningSummary } from "@/lib/ledger";
import { PAYMENT_METHOD_LABELS, PaymentMethod } from "@/lib/paymentMethods";

type BranchRow = { id: string; name: string; code: string };
type TxRow = {
  id: string; branch_id: string; type: "income" | "expense"; category: string;
  amount: number; description: string | null; payment_method: string; created_at: string; transaction_date?: string | null;
  reference_number?: string | null;
  reference_id?: string | null;
  voucher_number?: string | null;
  invoice_number?: string | null;
};
type ViewBal = { branch_id: string; current_balance: number };

const PAGE_SIZE = 50;
const safeLike = (s: string) => s.replace(/[,()%*_\\]/g, " ").trim();
/** Cairo-day shortcut pills; bounds applied by applyCairoRange. */
const DATE_SHORTCUTS: { label: string; range: () => [string, string] }[] = [
  { label: "النهاردة", range: () => { const d = cairoTodayDay(); return [d, d]; } },
  { label: "امبارح", range: () => { const d = addDaysDay(cairoTodayDay(), -1); return [d, d]; } },
  { label: "آخر 7 أيام", range: () => { const d = cairoTodayDay(); return [addDaysDay(d, -6), d]; } },
  { label: "الشهر ده", range: () => { const d = cairoTodayDay(); return [monthStartDay(d), d]; } },
  { label: "الشهر اللي فات", range: () => { const d = cairoTodayDay(); return [monthStartDay(d, -1), addDaysDay(monthStartDay(d), -1)]; } },
];
const defaultFrom = () => addDaysDay(cairoTodayDay(), -29);

export default function MainTreasury() {
  const { tenantId } = useAuth();
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [rows, setRows] = useState<TxRow[]>([]);
  const [glBalances, setGlBalances] = useState<Record<string, ViewBal>>({});
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(cairoTodayDay());
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState("");
  const [typeF, setTypeF] = useState<"all" | "income" | "expense">("all");
  const [methodF, setMethodF] = useState<string>("all");
  const [minAmt, setMinAmt] = useState("");
  const [maxAmt, setMaxAmt] = useState("");
  const [dq, setDq] = useState({ search: "", notes: "", minAmt: "", maxAmt: "" });
  const [page, setPage] = useState(1);
  const [pageRows, setPageRows] = useState<TxRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [tableLoading, setTableLoading] = useState(true);
  const [viewMovement, setViewMovement] = useState<TreasuryMovement | null>(null);
  const [creditDrawer, setCreditDrawer] = useState<null | "customer" | "supplier">(null);
  const [position, setPosition] = useState<LedgerPosition | null>(null);
  const [opening, setOpening] = useState<OpeningSummary | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDq({ search: search.trim(), notes: notes.trim(), minAmt, maxAmt }), 300);
    return () => clearTimeout(t);
  }, [search, notes, minAmt, maxAmt]);

  // Any filter change resets to page 1
  useEffect(() => { setPage(1); }, [from, to, branchFilter, typeF, methodF, dq]);

  const clearFilters = () => {
    setFrom(defaultFrom()); setTo(cairoTodayDay()); setSearch(""); setNotes("");
    setTypeF("all"); setMethodF("all"); setMinAmt(""); setMaxAmt("");
  };

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    // كل الخزائن الحقيقية: الفروع + الأوعية المالية المركزية النظامية.
    const { data: brs } = await supabase
      .from("branches")
      .select("id,name,code")
      .eq("tenant_id", tenantId)
      .order("name");
    const branchList = (brs ?? []) as BranchRow[];
    setBranches(branchList);

    if (branchList.length === 0) { setRows([]); setLoading(false); return; }

    // Movements by their accounting day (transaction_date), like the branch treasury: a back-dated
    // voucher lands in its own period.
    const tq = () => applyCairoRange(
      supabase
        .from("treasury")
        .select("id,branch_id,type,category,amount,description,payment_method,created_at,transaction_date")
        .in("branch_id", branchList.map(b => b.id)),
      "transaction_date", from, to, true,
    ).order("transaction_date", { ascending: false }).order("id");
    const [{ data: tr }, wallets, pos, ob] = await Promise.all([
      fetchAllRows<any>(tq).then((data) => ({ data })).catch(() => ({ data: [] as any[] })),
      // Current till balance per branch = its treasury rows (opening cash included) — the same source
      // as the branch treasury page and the server's balance check.
      Promise.all(branchList.map(async (b) => {
        const { data } = await supabase.rpc("get_branch_wallet_balances", { p_branch_id: b.id });
        const row = Array.isArray(data) ? (data as any[])[0] : (data as any);
        return { branch_id: b.id, current_balance: Number(row?.total_balance ?? 0) } as ViewBal;
      })),
      fetchLedgerPosition(null).catch(() => null),
      fetchOpeningSummary().catch(() => null),
    ]);
    setRows((tr ?? []) as TxRow[]);
    const map: Record<string, ViewBal> = {};
    for (const r of wallets) map[r.branch_id] = r;
    setGlBalances(map);
    setPosition(pos);
    setOpening(ob);
    setLoading(false);
  }, [tenantId, from, to]);

  // Paginated movements table — all filters server-side, combined with branch tab
  const loadTable = useCallback(async () => {
    if (!tenantId || branches.length === 0) { setPageRows([]); setTotalCount(0); setTableLoading(false); return; }
    setTableLoading(true);
    let q = applyCairoRange(
      supabase
        .from("treasury")
        .select("id,branch_id,type,category,amount,description,payment_method,created_at,transaction_date,reference_id,reference_number", { count: "exact" })
        .in("branch_id", branchFilter === "all" ? branches.map(b => b.id) : [branchFilter]),
      "transaction_date", from, to, true,
    );
    if (typeF !== "all") q = q.eq("type", typeF);
    if (methodF !== "all") q = q.eq("payment_method", methodF);
    const s = safeLike(dq.search);
    if (s) q = q.or(`reference_number.ilike.%${s}%,description.ilike.%${s}%,category.ilike.%${s}%`);
    const n = safeLike(dq.notes);
    if (n) q = q.ilike("description", `%${n}%`);
    if (dq.minAmt !== "" && !isNaN(Number(dq.minAmt))) q = q.gte("amount", Number(dq.minAmt));
    if (dq.maxAmt !== "" && !isNaN(Number(dq.maxAmt))) q = q.lte("amount", Number(dq.maxAmt));
    const start = (page - 1) * PAGE_SIZE;
    const { data, count } = await q.order("transaction_date", { ascending: false }).order("created_at", { ascending: false }).order("id").range(start, start + PAGE_SIZE - 1);
    const movements = (data ?? []) as TxRow[];
    const movementIds = movements.map((row) => row.id);
    const referenceIds = movements.map((row) => row.reference_id).filter((id): id is string => Boolean(id));
    const [{ data: vouchers }, { data: invoices }] = await Promise.all([
      movementIds.length
        ? supabase.from("vouchers").select("treasury_id,voucher_number").in("treasury_id", movementIds)
        : Promise.resolve({ data: [] as { treasury_id: string | null; voucher_number: string }[] }),
      referenceIds.length
        ? supabase.from("invoices").select("id,invoice_number").in("id", referenceIds)
        : Promise.resolve({ data: [] as { id: string; invoice_number: string }[] }),
    ]);
    const voucherByMovement = new Map((vouchers ?? []).map((voucher) => [voucher.treasury_id, voucher.voucher_number]));
    const invoiceByReference = new Map((invoices ?? []).map((invoice) => [invoice.id, invoice.invoice_number]));
    setPageRows(movements.map((row) => ({
      ...row,
      voucher_number: voucherByMovement.get(row.id) ?? null,
      invoice_number: row.reference_id ? invoiceByReference.get(row.reference_id) ?? null : null,
    })));
    setTotalCount(count ?? 0);
    setTableLoading(false);
  }, [tenantId, branches, branchFilter, from, to, typeF, methodF, dq, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadTable(); }, [loadTable]);
  const refreshAll = useCallback(() => { load(); loadTable(); }, [load, loadTable]);
  useRealtimeRefresh(["treasury", "branches", "vouchers", "invoice_payments", "customer_credit_log", "supplier_payments", "payment_transactions"], refreshAll);

  const methods = useMemo(() => Array.from(new Set(["cash", "vodafone", "instapay", "bank", ...rows.map(r => r.payment_method).filter(Boolean)])), [rows]);
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, totalCount);

  const filtered = useMemo(
    () => branchFilter === "all" ? rows : rows.filter(r => r.branch_id === branchFilter),
    [rows, branchFilter],
  );

  const totals = useMemo(() => {
    let cin = 0, cout = 0;
    for (const r of filtered) {
      const amt = Number(r.amount);
      if (r.type === "income") cin += amt; else cout += amt;
    }
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return { cin: r2(cin), cout: r2(cout), net: r2(cin - cout) };
  }, [filtered]);

  // Per-branch rollup (uses filtered range, ignores branchFilter to always show all branches)
  const perBranch = useMemo(() => {
    const map = new Map<string, { branch: BranchRow; cin: number; cout: number; lastAt: string | null }>();
    for (const b of branches) map.set(b.id, { branch: b, cin: 0, cout: 0, lastAt: null });
    for (const r of rows) {
      const entry = map.get(r.branch_id);
      if (!entry) continue;
      const amt = Number(r.amount);
      if (r.type === "income") entry.cin += amt; else entry.cout += amt;
      const at = r.transaction_date ?? r.created_at;
      if (!entry.lastAt || at > entry.lastAt) entry.lastAt = at;
    }
    return Array.from(map.values());
  }, [rows, branches]);

  return (
    <AdminLayout>
      <PageHeader
        title="ملخص الخزائن (Treasury Overview)"
        subtitle="نظرة عامة على أرصدة وحركات كل الخزائن — للعرض فقط"
        actions={
          <Button asChild className="btn-gradient">
            <Link to="/admin/accounting/branch-capital">
              <Building2 className="w-4 h-4 ml-1" /> تحويل فلوس من خزنة الشركاء للفروع
            </Link>
          </Button>
        }
      />

      <div className="card-elevated p-4 mb-6 border-r-4 border-primary bg-primary/5 text-sm leading-7">
        الصفحة دي <b>للعرض بس</b>، وبتجمّعلك أرصدة خزائن الفروع والأوعية المالية المركزية في مكان واحد.
        <b> لتحويل فلوس فعلي</b>، استخدم زرار <b>«تحويل فلوس من خزنة الشركاء للفروع»</b> فوق، أو روح لخزنة الفرع نفسه.
      </div>


      {/* Overall totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="إجمالي الوارد" value={formatEGP(totals.cin)} icon={<ArrowDownCircle className="w-5 h-5" />} accent="success" metricHint={{ meaning: "إجمالي الأموال الداخلة إلى الخزائن المحددة خلال الفترة المعروضة.", source: "سجل treasury الناتج عن سندات القبض والإيداعات والمستندات المحققة، وفق الفرع وحدود أيام القاهرة.", formula: "مجموع مبالغ الحركات التي نوعها وارد (income)" }} />
        <StatCard label="إجمالي الصادر" value={formatEGP(totals.cout)} icon={<ArrowUpCircle className="w-5 h-5" />} accent="destructive" metricHint={{ meaning: "إجمالي الأموال الخارجة من الخزائن المحددة خلال الفترة المعروضة.", source: "سجل treasury الناتج عن سندات الصرف والمصروفات والمستندات المحققة، وفق الفرع وحدود أيام القاهرة.", formula: "مجموع مبالغ الحركات التي نوعها صادر (expense)" }} />
        <StatCard label="صافي التدفق" value={formatEGP(totals.net)} icon={<TrendingUp className="w-5 h-5" />} accent={totals.net >= 0 ? "success" : "destructive"} metricHint={{ meaning: "صافي حركة النقد خلال الفترة، وليس الرصيد الدفتري الحالي للخزائن.", source: "إجمالي حركات الوارد والصادر في سجل treasury بعد تطبيق الفترة والفرع المحددين.", formula: "إجمالي الوارد − إجمالي الصادر" }} />
        <StatCard label="عدد الخزائن" value={branches.length} icon={<Store className="w-5 h-5" />} accent="primary" />
      </div>

      {/* Money on account — two separate cards (never added together, never netted) */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <Button type="button" variant="ghost" className="block h-auto w-full rounded-2xl p-0 text-right" onClick={() => setCreditDrawer("customer")} aria-label="مقدمات العملاء">
          <StatCard
            label="مقدمات عملاء عندنا (2150)"
            value={formatEGP(position?.customers?.advances ?? 0)}
            icon={<Landmark className="w-5 h-5" />}
            hint={`${position?.customers?.advance_contacts ?? 0} عميل · اضغط للتفاصيل`}
            metricHint={{ meaning: "فلوس دفعها العملاء تحت الحساب ولسه ما اتخصمتش من فواتير.", source: "الدفتر الموحد: حركات العملاء اللي لسه ليها رصيد بعد التوزيع (FIFO).", formula: "Σ (مبلغ الحركة − الموزع منها) لجانب العملاء" }}
            accent="warning"
            className="cursor-pointer"
          />
        </Button>
        <Button type="button" variant="ghost" className="block h-auto w-full rounded-2xl p-0 text-right" onClick={() => setCreditDrawer("supplier")} aria-label="مقدمات الموردين">
          <StatCard
            label="مقدماتنا عند الموردين (1460)"
            value={formatEGP(position?.suppliers?.advances ?? 0)}
            icon={<Landmark className="w-5 h-5" />}
            hint={`${position?.suppliers?.advance_contacts ?? 0} مورد · اضغط للتفاصيل`}
            metricHint={{ meaning: "فلوس دفعناها للموردين مقدم ولسه ما اتخصمتش من فواتير شراء.", source: "الدفتر الموحد: حركات الموردين اللي لسه ليها رصيد بعد التوزيع (FIFO).", formula: "Σ (مبلغ الحركة − الموزع منها) لجانب الموردين" }}
            accent="secondary"
            className="cursor-pointer"
          />
        </Button>
        <Link to="/admin/accounting/opening-balances" className="block">
          <StatCard
            label="الأرصدة الافتتاحية (الخزنة الرئيسية)"
            value={formatEGP(opening?.cash_total ?? 0)}
            icon={<Wallet className="w-5 h-5" />}
            hint={opening?.as_of
              ? `بتاريخ ${formatDate(opening.as_of)} · عملاء ${formatEGP(opening.customers_debt)} / مقدمات عملاء ${formatEGP(opening.customers_advance)} · موردين ${formatEGP(opening.suppliers_payable)} / مقدمات موردين ${formatEGP(opening.suppliers_advance)}`
              : "لسه ما اترحلتش — اضغط للتسجيل"}
            metricHint={{ meaning: "نقدية أول المدة وأرصدة العملاء والموردين الافتتاحية. أرصدة الجهات مسجلة على الخزنة الرئيسية.", source: "opening_balances_summary: حركات الخزنة «رصيد افتتاحي» + حركات الدفتر الموحد من نوع رصيد افتتاحي.", formula: "النقدية = Σ حركات «رصيد افتتاحي» في كل الخزائن" }}
            accent="primary"
          />
        </Link>
      </div>

      <ContactCreditBalancesDrawer
        open={!!creditDrawer}
        onOpenChange={(o) => { if (!o) setCreditDrawer(null); }}
        side={creditDrawer ?? "customer"}
      />

      {/* Per-branch rollup cards */}
      <h3 className="font-bold mb-3 flex items-center gap-2"><Wallet className="w-4 h-4" /> تفصيل الخزائن</h3>
      <TooltipProvider delayDuration={200}>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {perBranch.map(({ branch, cin, cout, lastAt }) => {
          const net = cin - cout;
          const gl = glBalances[branch.id];
          const glBal = Number(gl?.current_balance ?? 0);
          return (
            <Tooltip key={branch.id}>
              <TooltipTrigger asChild>
                <Link
                  to={`/branch/${branch.id}/treasury`}
                  className="card-elevated p-4 hover:shadow-lg transition-shadow block"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="font-bold text-base">{branch.name}</div>
                      <div className="text-xs text-muted-foreground">{branch.code}</div>
                    </div>
                    <Wallet className="w-5 h-5 text-primary" />
                  </div>
                  <div className="text-xs text-muted-foreground mb-1">الرصيد الحالى للخزنة</div>
                   <FinancialAmount value={glBal} size="md" className={`mb-1 justify-start font-extrabold ${glBal >= 0 ? "text-success" : "text-destructive"}`} />
                  <div className="text-[11px] text-muted-foreground">
                    صافي حركة الفترة: <b className={net >= 0 ? "text-success" : "text-destructive"}>{formatEGP(net)}</b>
                    {" · "}
                    {lastAt ? `آخر تحديث: ${formatDate(lastAt)}` : "لا حركات فى الفترة"}
                  </div>
                  <div className="mt-2 pt-2 border-t flex justify-between text-xs">
                    <span className="text-success">وارد: <b>{formatEGP(cin)}</b></span>
                    <span className="text-destructive">صادر: <b>{formatEGP(cout)}</b></span>
                  </div>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs space-y-1">
                <div className="font-bold">{branch.name}</div>
                <div>الرصيد الحالى: <b className={glBal >= 0 ? "text-success" : "text-destructive"}>{formatEGP(glBal)}</b></div>
                <div>إجمالي الوارد (الفترة): <b className="text-success">{formatEGP(cin)}</b></div>
                <div>إجمالي الصادر (الفترة): <b className="text-destructive">{formatEGP(cout)}</b></div>
                <div>صافي حركة الفترة: <b className={net >= 0 ? "text-success" : "text-destructive"}>{formatEGP(net)}</b></div>
                <div className="text-muted-foreground pt-1 border-t">{lastAt ? `آخر حركة: ${formatDate(lastAt)}` : "لا حركات"}</div>
              </TooltipContent>

            </Tooltip>
          );
        })}
      </div>
      </TooltipProvider>

      {/* Movements table with filter */}
      <div className="card-elevated p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="font-bold">حركات الخزنة</h3>
          <Tabs value={branchFilter} onValueChange={setBranchFilter}>
            <TabsList>
              <TabsTrigger value="all">كل الفروع</TabsTrigger>
              {branches.map(b => (
                <TabsTrigger key={b.id} value={b.id}>{b.name}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 mb-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold text-sm">
              فلاتر حركات الخزينة <span className="text-muted-foreground font-normal">(يعرض {rangeStart} - {rangeEnd} من أصل {totalCount} حركة)</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {DATE_SHORTCUTS.map((sc) => (
                <Button key={sc.label} variant="outline" size="sm" onClick={() => { const [f, t] = sc.range(); setFrom(f); setTo(t); }}>{sc.label}</Button>
              ))}
              <Button variant="ghost" size="sm" onClick={clearFilters}>مسح الفلاتر</Button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">بحث (رقم العملية / البيان / التصنيف...)</label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اكتب للبحث…" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">من تاريخ</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">إلى تاريخ</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">النوع</label>
              <Select value={typeF} onValueChange={(v) => setTypeF(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="income">وارد / دخول</SelectItem>
                  <SelectItem value="expense">صادر / خروج</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">بحث الملاحظات</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="كلمة من البيان…" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">المبلغ من</label>
              <Input type="number" min={0} value={minAmt} onChange={(e) => setMinAmt(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">طريقة الدفع / الوعاء</label>
              <Select value={methodF} onValueChange={setMethodF}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {methods.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-start-3">
              <label className="text-xs text-muted-foreground block mb-1">المبلغ إلى</label>
              <Input type="number" min={0} value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} />
            </div>
          </div>
        </div>

        <TooltipProvider delayDuration={200}>
        <DataTable
          loading={tableLoading}
          rows={pageRows}
          indexColumn={{ offset: (page - 1) * PAGE_SIZE }}
          empty="لا توجد حركات مطابقة للفلاتر"
          tableClassName="max-lg:min-w-[1180px]"
          columns={[
            { key: "details", header: "تفاصيل", align: "center", width: "5rem", render: (r: TxRow) => (
              <DetailsChevron label="عرض تفاصيل الحركة" onClick={() => setViewMovement(r as TreasuryMovement)} />
            )},
            { key: "created_at", header: "التاريخ", align: "center", width: "8.5rem", render: (r: TxRow) => formatDate(r.transaction_date ?? r.created_at) },
            { key: "branch", header: "الفرع", align: "center", width: "9rem", render: (r: TxRow) => branches.find(b => b.id === r.branch_id)?.name ?? "—" },
            { key: "type", header: "النوع", align: "center", width: "6rem", render: (r: TxRow) => (
              <span className={r.type === "income" ? "text-success font-bold" : "text-destructive font-bold"}>
                {r.type === "income" ? "وارد ↓" : "صادر ↑"}
              </span>
            )},
            { key: "category", header: "التصنيف", align: "center", width: "9rem", render: (r: TxRow) => treasuryCategoryLabel(r.category) },
            { key: "payment_method", header: "الوعاء", align: "center", width: "8rem", render: (r: TxRow) => (
              <span className="rounded bg-muted px-2 py-1 text-xs">
                {PAYMENT_METHOD_LABELS[r.payment_method as PaymentMethod] ?? r.payment_method ?? "—"}
              </span>
            )},
            { key: "reference_number", header: "رقم العملية", align: "center", width: "10rem", render: (r: TxRow) => (
              <Badge variant="secondary" dir="ltr" className="unicode-isolate max-w-full rounded-md font-mono text-xs font-bold">
                {resolveTreasuryOperationNumber(r.voucher_number, r.invoice_number, r.reference_number)}
              </Badge>
            )},
            { key: "description", header: "الملاحظات / البيان", align: "right", width: "18rem", className: "whitespace-normal break-words leading-6", render: (r: TxRow) => {
              const text = sanitizeOperationalDescription(r.description);
              return text ? (
                <span dir="rtl" className="unicode-isolate block w-full whitespace-normal break-words text-right">{text}</span>
              ) : "—";
            }},
            { key: "amount", header: "المبلغ", align: "center", width: "10rem", numeric: true, render: (r: TxRow) => (
              <b dir="ltr" className={`unicode-isolate inline-block ${r.type === "income" ? "text-success" : "text-destructive"}`}>
                {r.type === "income" ? "+" : "−"} {formatEGP(Number(r.amount))}
              </b>
            )},
          ]}
        />
        </TooltipProvider>
        {pageCount > 1 && (
          <div className="mt-3 flex justify-center">
            <NumberedPagination page={page} pageCount={pageCount} onChange={setPage} disabled={tableLoading} />
          </div>
        )}
        <TreasuryMovementDialog
          movement={viewMovement}
          open={!!viewMovement}
          onOpenChange={(o) => { if (!o) setViewMovement(null); }}
          branchName={viewMovement ? branches.find(b => b.id === (viewMovement as any).branch_id)?.name : undefined}
        />
        {/* every till against its branch's cash in the books, and the 1910 inter-branch account */}
        <div className="mt-6"><GlReconciliationPanel /></div>
      </div>
    </AdminLayout>
  );
}
