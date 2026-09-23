import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { formatEGP } from "@/lib/format";
import { TrendingUp, TrendingDown, ArrowLeft, Loader2 } from "lucide-react";
import { fetchProfitWindow, rangeForDates } from "@/lib/profitEngine";
import { useCanViewNetProfit, NET_PROFIT_MASK } from "@/lib/netProfitAccess";
import { ProfitDateRangePicker, presetRange, type DayRange } from "@/components/ProfitDateRangePicker";
import { FinancialAmount } from "@/components/FinancialAmount";

const BRANCH_COLORS = ["bg-success", "bg-primary", "bg-info", "bg-warning", "bg-accent", "bg-secondary"];
const BRANCH_DOT = ["bg-success", "bg-primary", "bg-info", "bg-warning", "bg-accent", "bg-secondary"];

export function ExecutiveProfitSummary() {
  const canViewNetProfit = useCanViewNetProfit();
  const { tenantId } = useAuth();
  const [range, setRange] = useState<DayRange>(() => presetRange("month"));
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState(0);
  const [cost, setCost] = useState(0);
  const [expenses, setExpenses] = useState(0);
  const [otherIncomes, setOtherIncomes] = useState(0);
  const [prevNet, setPrevNet] = useState(0);
  const [branchProfits, setBranchProfits] = useState<{ id: string; name: string; profit: number }[]>([]);
  const reqId = useRef(0);

  const load = async () => {
    if (!tenantId) return;
    const id = ++reqId.current;
    setLoading(true);
    const w = await fetchProfitWindow({ tenantId, range: rangeForDates(range.from, range.to) });
    if (id !== reqId.current) return; // تجاهل نتائج طلب قديم
    setSales(w.totals.revenue);
    setCost(w.totals.cost);
    setExpenses(w.totals.expenses);
    setOtherIncomes(w.totals.otherIncomes);
    setPrevNet(w.prevNet);
    setBranchProfits(w.perBranch.map((b) => ({ id: b.id, name: b.name, profit: b.net })));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId, range.from, range.to]);
  useRealtimeRefresh(["invoices", "invoice_items", "vouchers", "branches"], load);

  const net = sales - cost - expenses + otherIncomes;
  const deltaPct = useMemo(() => {
    if (Math.abs(prevNet) < 0.01) return null;
    const v = ((net - prevNet) / Math.abs(prevNet)) * 100;
    return Number.isFinite(v) ? v : null;
  }, [net, prevNet]);

  // الحصص تُحسب من صافي الربح الكلي بحيث مجموعها = 100% من الصافي
  const totalNet = branchProfits.reduce((s, b) => s + b.profit, 0);
  const branchShares = branchProfits
    .filter((b) => Math.abs(b.profit) > 0.005)
    .map((b) => ({ ...b, pct: Math.abs(totalNet) > 0.005 ? (b.profit / totalNet) * 100 : 0 }))
    .sort((a, b) => b.profit - a.profit);
  const barTotal = branchShares.reduce((s, b) => s + Math.max(0, b.pct), 0) || 1;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-card border border-border shadow-xl shadow-foreground/5 mb-6">
      {/* Top gradient accent */}
      <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-success via-primary to-info" />
      {loading && (
        <div className="absolute top-3 left-3 z-10">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      )}

<div className={`p-6 lg:p-7 flex flex-col xl:flex-row gap-7 items-stretch xl:items-center justify-between transition-opacity ${loading ? "opacity-60" : ""}`}>
        {/* Left: Main metric & filter */}
        <div className="flex flex-col gap-4 xl:w-[300px] shrink-0">
          <div className="flex flex-col gap-2">
            <h2 className="text-muted-foreground text-xs font-bold tracking-wide uppercase">
              ملخص صافي الأرباح التنفيذي
            </h2>
            <ProfitDateRangePicker value={range} onChange={setRange} />
          </div>

          <div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <FinancialAmount
                value={canViewNetProfit ? net : NET_PROFIT_MASK}
                currency={canViewNetProfit}
                size="hero"
                className={`justify-start font-extrabold ${!canViewNetProfit ? "text-muted-foreground" : net >= 0 ? "text-success" : "text-destructive"}`}
              />
              {canViewNetProfit && deltaPct === null && (
                <div className="px-2.5 py-1 rounded-full text-xs font-bold bg-muted text-muted-foreground">—</div>
              )}
              {deltaPct !== null && canViewNetProfit && (
                <div
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                    deltaPct >= 0
                      ? "bg-success/15 text-success"
                      : "bg-destructive/15 text-destructive"
                  }`}
                >
                  {deltaPct >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {deltaPct >= 0 ? "+" : "−"}{Math.abs(deltaPct).toFixed(1)}%
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {deltaPct === null ? "صافي الربح (Net Profit) للفترة" : "مقارنة بالفترة السابقة"}
            </p>
          </div>
        </div>

        {/* Middle: Formula breakdown */}
        <div className="flex-1 w-full xl:-mr-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-5 rounded-xl bg-primary/5 border border-primary/25 relative overflow-hidden">
              <p className="text-foreground/80 text-sm mb-2 font-bold">المبيعات (Revenue)</p>
               <FinancialAmount value={sales} size="lg" className="relative z-10 justify-start font-extrabold text-primary" />
              <div className="absolute bottom-0 left-0 w-14 h-14 bg-primary/10 rounded-tr-full -ml-3 -mb-3" />
            </div>
            <div className="p-5 rounded-xl bg-warning/5 border border-warning/30 relative overflow-hidden">
              <p className="text-foreground/80 text-sm mb-2 font-bold">التكلفة (COGS)</p>
               <FinancialAmount value={cost} size="lg" className="relative z-10 justify-start font-extrabold text-warning" />
              <div className="absolute bottom-0 left-0 w-14 h-14 bg-warning/10 rounded-tr-full -ml-3 -mb-3" />
            </div>
            <div className="p-5 rounded-xl bg-destructive/5 border border-destructive/25 relative overflow-hidden">
              <p className="text-foreground/80 text-sm mb-2 font-bold">المصروفات التشغيلية</p>
               <FinancialAmount value={expenses} size="lg" className="relative z-10 justify-start font-extrabold text-destructive" />
              <div className="absolute bottom-0 left-0 w-14 h-14 bg-destructive/10 rounded-tr-full -ml-3 -mb-3" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-center gap-4">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-bold text-muted-foreground tracking-widest">
              المبيعات (Revenue) − تكلفة البضاعة (COGS) − المصاريف (OPEX) = صافي الربح (Net Profit)
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
        </div>

        {/* Right: Branch contribution & CTA */}
        <div className="flex flex-col gap-3 w-full xl:w-64 shrink-0">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-foreground">مساهمة الفروع في الربح</span>
            </div>
            {branchShares.length === 0 ? (
              <div className="text-[11px] text-muted-foreground py-2">لا توجد فروع رابحة في الفترة</div>
            ) : (
              <>
                <div className="flex gap-1 h-2.5 w-full">
                  {branchShares.map((b, i) => (
                    <div
                      key={b.id}
                      className={`h-full ${BRANCH_COLORS[i % BRANCH_COLORS.length]} rounded-full`}
                      style={{ width: `${(Math.max(0, b.pct) / barTotal) * 100}%` }}
                      title={`${b.name} ${b.pct.toFixed(1)}%`}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {branchShares.slice(0, 4).map((b, i) => (
                    <div key={b.id} className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${BRANCH_DOT[i % BRANCH_DOT.length]}`} />
                      <span className="text-[10px] text-muted-foreground font-medium">
                        {b.name} ({b.pct.toFixed(0)}%)
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <Link
            to="/admin/reports?tab=central"
            className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-foreground text-background text-sm font-bold rounded-xl hover:opacity-90 transition-all group"
          >
            عرض التقرير التفصيلي
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          </Link>
        </div>
      </div>
    </div>
  );
}
