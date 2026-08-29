import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { formatEGP } from "@/lib/format";
import { TrendingUp, TrendingDown, ArrowLeft, Loader2 } from "lucide-react";
import { fetchProfitWindow, rangeFor, type ProfitPeriod } from "@/lib/profitEngine";
import { useCanViewNetProfit, NET_PROFIT_MASK } from "@/lib/netProfitAccess";

const PERIODS: { key: ProfitPeriod; label: string }[] = [
  { key: "day", label: "يومي" },
  { key: "week", label: "أسبوعي" },
  { key: "month", label: "شهري" },
  { key: "year", label: "سنوي" },
];

const BRANCH_COLORS = ["bg-success", "bg-primary", "bg-info", "bg-warning", "bg-accent", "bg-secondary"];
const BRANCH_DOT = ["bg-success", "bg-primary", "bg-info", "bg-warning", "bg-accent", "bg-secondary"];

export function ExecutiveProfitSummary() {
  const canViewNetProfit = useCanViewNetProfit();
  const { tenantId } = useAuth();
  const [period, setPeriod] = useState<ProfitPeriod>("month");
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState(0);
  const [cost, setCost] = useState(0);
  const [expenses, setExpenses] = useState(0);
  const [prevNet, setPrevNet] = useState(0);
  const [branchProfits, setBranchProfits] = useState<{ id: string; name: string; profit: number }[]>([]);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const w = await fetchProfitWindow({ tenantId, range: rangeFor(period) });
    setSales(w.totals.revenue);
    setCost(w.totals.cost);
    setExpenses(w.totals.expenses);
    setPrevNet(w.prevNet);
    setBranchProfits(w.perBranch.map((b) => ({ id: b.id, name: b.name, profit: b.net })));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId, period]);
  useRealtimeRefresh(["invoices", "invoice_items", "vouchers", "branches"], load);

  const net = sales - cost - expenses;
  const deltaPct = useMemo(() => {
    if (Math.abs(prevNet) < 0.01) return null;
    return ((net - prevNet) / Math.abs(prevNet)) * 100;
  }, [net, prevNet]);

  const positiveBranches = branchProfits.filter((b) => b.profit > 0);
  const totalPositive = positiveBranches.reduce((s, b) => s + b.profit, 0);
  const branchShares = positiveBranches
    .map((b) => ({ ...b, pct: totalPositive > 0 ? (b.profit / totalPositive) * 100 : 0 }))
    .sort((a, b) => b.profit - a.profit);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-card border border-border shadow-xl shadow-foreground/5 mb-6">
      {/* Top gradient accent */}
      <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-success via-primary to-info" />

<div className="p-6 lg:p-7 flex flex-col xl:flex-row gap-7 items-stretch xl:items-center justify-between">
        {/* Left: Main metric & filter */}
        <div className="flex flex-col gap-4 xl:w-[280px] shrink-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-muted-foreground text-xs font-bold tracking-wide uppercase">
              ملخص صافي الأرباح التنفيذي
            </h2>
            <div className="flex bg-muted p-1 rounded-lg border border-border">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                    period === p.key
                      ? "bg-card shadow-sm text-success"
                      : "text-muted-foreground hover:bg-card/60"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <div className={`text-3xl lg:text-4xl font-extrabold tracking-tight ${!canViewNetProfit ? "text-muted-foreground" : net >= 0 ? "text-success" : "text-destructive"}`}>
                {loading ? <Loader2 className="w-7 h-7 animate-spin inline" /> : canViewNetProfit ? formatEGP(net) : NET_PROFIT_MASK}
              </div>
              {deltaPct !== null && !loading && canViewNetProfit && (
                <div
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                    deltaPct >= 0
                      ? "bg-success/15 text-success"
                      : "bg-destructive/15 text-destructive"
                  }`}
                >
                  {deltaPct >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {Math.abs(deltaPct).toFixed(1)}%
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
              <p className="text-2xl lg:text-3xl font-extrabold text-primary tabular-nums truncate" dir="ltr" title={formatEGP(sales)}>
                {formatEGP(sales)}
              </p>
              <div className="absolute bottom-0 left-0 w-14 h-14 bg-primary/10 rounded-tr-full -ml-3 -mb-3" />
            </div>
            <div className="p-5 rounded-xl bg-warning/5 border border-warning/30 relative overflow-hidden">
              <p className="text-foreground/80 text-sm mb-2 font-bold">التكلفة (COGS)</p>
              <p className="text-2xl lg:text-3xl font-extrabold text-warning tabular-nums truncate" dir="ltr" title={formatEGP(cost)}>
                {formatEGP(cost)}
              </p>
              <div className="absolute bottom-0 left-0 w-14 h-14 bg-warning/10 rounded-tr-full -ml-3 -mb-3" />
            </div>
            <div className="p-5 rounded-xl bg-destructive/5 border border-destructive/25 relative overflow-hidden">
              <p className="text-foreground/80 text-sm mb-2 font-bold">المصروفات التشغيلية</p>
              <p className="text-2xl lg:text-3xl font-extrabold text-destructive tabular-nums truncate" dir="ltr" title={formatEGP(expenses)}>
                {formatEGP(expenses)}
              </p>
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
                      style={{ width: `${b.pct}%` }}
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
