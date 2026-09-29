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
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { formatEGP, formatDate, extractOperationReference, sanitizeOperationalDescription } from "@/lib/format";
import { TreasuryMovementDialog, TreasuryMovement } from "@/components/TreasuryMovementDialog";
import { DetailsChevron } from "@/components/DetailsChevron";
import { ArrowDownCircle, ArrowUpCircle, Wallet, Store, TrendingUp, Building2, Landmark } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { FinancialAmount } from "@/components/FinancialAmount";
import { ContactCreditBalancesDrawer } from "@/components/ContactCreditBalancesDrawer";
import { useContactCreditBalances } from "@/hooks/useContactCreditBalances";

type BranchRow = { id: string; name: string; code: string };
type TxRow = {
  id: string; branch_id: string; type: "income" | "expense"; category: string;
  amount: number; description: string | null; payment_method: string; created_at: string;
  reference_number?: string | null;
};
type ViewBal = { branch_id: string; current_balance: number; last_transaction_date: string | null };

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
  const [creditDrawerOpen, setCreditDrawerOpen] = useState(false);
  const contactCredits = useContactCreditBalances(tenantId);

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

    const tq = () => applyCairoRange(
      supabase
        .from("treasury")
        .select("id,branch_id,type,category,amount,description,payment_method,created_at")
        .in("branch_id", branchList.map(b => b.id)),
      "created_at", from, to,
    ).order("created_at", { ascending: false }).order("id");
    const [{ data: tr }, { data: vb }] = await Promise.all([
      fetchAllRows<any>(tq).then((data) => ({ data })).catch(() => ({ data: [] as any[] })),
      // Live GL cash balance per branch (accounts 1100+1110) — sourced from journal_entries
      supabase
        .from("v_treasury_balances" as any)
        .select("branch_id,current_balance,last_transaction_date")
        .in("branch_id", branchList.map(b => b.id)),
    ]);
    setRows((tr ?? []) as TxRow[]);
    const map: Record<string, ViewBal> = {};
    for (const r of ((vb ?? []) as any[])) map[r.branch_id] = r as ViewBal;
    setGlBalances(map);
    setLoading(false);
  }, [tenantId, from, to]);

  // Paginated movements table — all filters server-side, combined with branch tab
  const loadTable = useCallback(async () => {
    if (!tenantId || branches.length === 0) { setPageRows([]); setTotalCount(0); setTableLoading(false); return; }
    setTableLoading(true);
    let q = applyCairoRange(
      supabase
        .from("treasury")
        .select("id,branch_id,type,category,amount,description,payment_method,created_at,reference_number", { count: "exact" })
        .in("branch_id", branchFilter === "all" ? branches.map(b => b.id) : [branchFilter]),
      "created_at", from, to,
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
    const { data, count } = await q.order("created_at", { ascending: false }).range(start, start + PAGE_SIZE - 1);
    setPageRows((data ?? []) as TxRow[]);
    setTotalCount(count ?? 0);
    setTableLoading(false);
  }, [tenantId, branches, branchFilter, from, to, typeF, methodF, dq, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadTable(); }, [loadTable]);
  const refreshAll = useCallback(() => { load(); loadTable(); }, [load, loadTable]);
  useRealtimeRefresh(["treasury", "branches", "journal_entries", "journal_entry_lines"], refreshAll);

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
    return { cin, cout, net: cin - cout };
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
      if (!entry.lastAt || r.created_at > entry.lastAt) entry.lastAt = r.created_at;
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
        <StatCard label="إجمالي الوارد" value={formatEGP(totals.cin)} icon={<ArrowDownCircle className="w-5 h-5" />} accent="success" />
        <StatCard label="إجمالي الصادر" value={formatEGP(totals.cout)} icon={<ArrowUpCircle className="w-5 h-5" />} accent="destructive" />
        <StatCard label="صافي التدفق" value={formatEGP(totals.net)} icon={<TrendingUp className="w-5 h-5" />} accent={totals.net >= 0 ? "success" : "destructive"} />
        <StatCard label="عدد الخزائن" value={branches.length} icon={<Store className="w-5 h-5" />} accent="primary" />
      </div>

      <button
        type="button"
        className="mb-6 block w-full text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-2xl"
        onClick={() => setCreditDrawerOpen(true)}
        aria-label="عرض تفاصيل أرصدة تحت الحساب"
      >
        <StatCard
          label="أرصدة تحت الحساب (مقدمات العملاء والموردين)"
          value={formatEGP(contactCredits.total)}
          icon={<Landmark className="w-5 h-5" />}
          hint={`${contactCredits.contacts.length} جهة لديها رصيد نشط · اضغط لعرض التفاصيل`}
          accent="warning"
          className="cursor-pointer"
        />
      </button>

      <ContactCreditBalancesDrawer
        open={creditDrawerOpen}
        onOpenChange={setCreditDrawerOpen}
        contacts={contactCredits.contacts}
        summaryLoading={contactCredits.loading}
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
                  <div className="text-xs text-muted-foreground mb-1">الرصيد الحالى (دفتر الأستاذ)</div>
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
                <div>الرصيد الحالى (GL): <b className={glBal >= 0 ? "text-success" : "text-destructive"}>{formatEGP(glBal)}</b></div>
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
          columns={[
            { key: "details", header: "تفاصيل", align: "center", width: "5rem", render: (r: TxRow) => (
              <DetailsChevron label="عرض تفاصيل الحركة" onClick={() => setViewMovement(r as TreasuryMovement)} />
            )},
            { key: "created_at", header: "التاريخ", render: (r: TxRow) => formatDate(r.created_at) },
            { key: "branch", header: "الفرع", render: (r: TxRow) => branches.find(b => b.id === r.branch_id)?.name ?? "—" },
            { key: "type", header: "النوع", render: (r: TxRow) => (
              <span className={r.type === "income" ? "text-success font-bold" : "text-destructive font-bold"}>
                {r.type === "income" ? "وارد ↓" : "صادر ↑"}
              </span>
            )},
            { key: "category", header: "التصنيف" },
            { key: "payment_method", header: "طريقة الدفع" },
            { key: "reference_number", header: "رقم العملية", render: (r: TxRow) => (
              <span dir="ltr" className="unicode-isolate inline-block font-mono text-xs">
                {extractOperationReference(r.reference_number, r.description)}
              </span>
            )},
            { key: "description", header: "الملاحظات / البيان", render: (r: TxRow) => {
              const text = sanitizeOperationalDescription(r.description);
              return text ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span dir="rtl" className="unicode-isolate inline-block max-w-[240px] truncate text-right cursor-help" title={text}>{text}</span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-sm whitespace-pre-wrap text-xs">{text}</TooltipContent>
                </Tooltip>
              ) : "—";
            }},
            { key: "amount", header: "المبلغ", render: (r: TxRow) => (
              <b className={r.type === "income" ? "text-success" : "text-destructive"}>{formatEGP(Number(r.amount))}</b>
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
      </div>
    </AdminLayout>
  );
}
