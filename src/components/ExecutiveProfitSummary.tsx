import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { formatEGP } from "@/lib/format";
import { TrendingUp, TrendingDown, ArrowLeft, Loader2 } from "lucide-react";

type Period = "day" | "week" | "month" | "year";

const PERIODS: { key: Period; label: string }[] = [
  { key: "day", label: "يومي" },
  { key: "week", label: "أسبوعي" },
  { key: "month", label: "شهري" },
  { key: "year", label: "سنوي" },
];

function rangeFor(p: Period): { from: Date; to: Date; prevFrom: Date; prevTo: Date } {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  if (p === "week") from.setDate(from.getDate() - 6);
  else if (p === "month") from.setDate(from.getDate() - 29);
  else if (p === "year") from.setDate(from.getDate() - 364);
  const spanMs = to.getTime() - from.getTime() + 1;
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - spanMs + 1);
  return { from, to, prevFrom, prevTo };
}

const BRANCH_COLORS = ["bg-success", "bg-primary", "bg-info", "bg-warning", "bg-accent", "bg-secondary"];
const BRANCH_DOT = ["bg-success", "bg-primary", "bg-info", "bg-warning", "bg-accent", "bg-secondary"];

export function ExecutiveProfitSummary() {
  const { tenantId } = useAuth();
  const [period, setPeriod] = useState<Period>("month");
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState(0);
  const [cost, setCost] = useState(0);
  const [expenses, setExpenses] = useState(0);
  const [prevNet, setPrevNet] = useState(0);
  const [branchProfits, setBranchProfits] = useState<{ id: string; name: string; profit: number }[]>([]);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { from, to, prevFrom, prevTo } = rangeFor(period);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    const prevFromIso = prevFrom.toISOString();
    const prevToIso = prevTo.toISOString();
    const fromDate = from.toISOString().slice(0, 10);
    const toDate = to.toISOString().slice(0, 10);
    const prevFromDate = prevFrom.toISOString().slice(0, 10);
    const prevToDate = prevTo.toISOString().slice(0, 10);

    const [invRes, expRes, prevInvRes, prevExpRes, branchesRes] = await Promise.all([
      supabase
        .from("invoices")
        .select("branch_id, invoice_items(quantity, returned_quantity, net_quantity, total, unit_cost_at_sale, cost_price)")
        .eq("status", "active")
        .gte("created_at", fromIso)
        .lte("created_at", toIso),
      supabase
        .from("vouchers")
        .select("amount, branch_id")
        .eq("type", "payment")
        .eq("status", "active")
        .gte("voucher_date", fromDate)
        .lte("voucher_date", toDate),
      supabase
        .from("invoices")
        .select("invoice_items(quantity, returned_quantity, net_quantity, total, unit_cost_at_sale, cost_price)")
        .eq("status", "active")
        .gte("created_at", prevFromIso)
        .lte("created_at", prevToIso),
      supabase
        .from("vouchers")
        .select("amount")
        .eq("type", "payment")
        .eq("status", "active")
        .gte("voucher_date", prevFromDate)
        .lte("voucher_date", prevToDate),
      supabase.from("branches").select("id, name").eq("is_active", true),
    ]);

    const calcInv = (rows: any[]) => {
      let s = 0, c = 0;
      for (const inv of rows ?? []) {
        for (const it of inv.invoice_items ?? []) {
          const qty = Number(it.quantity) || 0;
          const netQty = Math.max(0, Number(it.net_quantity ?? (qty - Number(it.returned_quantity ?? 0))));
          const unitRev = qty > 0 ? Number(it.total) / qty : 0;
          s += unitRev * netQty;
          c += Number(it.unit_cost_at_sale ?? it.cost_price ?? 0) * netQty;
        }
      }
      return { sales: s, cost: c };
    };

    const cur = calcInv(invRes.data ?? []);
    const exp = (expRes.data ?? []).reduce((a, v: any) => a + Number(v.amount || 0), 0);
    const prev = calcInv(prevInvRes.data ?? []);
    const prevExp = (prevExpRes.data ?? []).reduce((a, v: any) => a + Number(v.amount || 0), 0);

    setSales(cur.sales);
    setCost(cur.cost);
    setExpenses(exp);
    setPrevNet(prev.sales - prev.cost - prevExp);

    // Per-branch profit (revenue - cost - branch expenses)
    const branches = branchesRes.data ?? [];
    const expByBranch: Record<string, number> = {};
    for (const v of (expRes.data ?? []) as any[]) {
      if (!v.branch_id) continue;
      expByBranch[v.branch_id] = (expByBranch[v.branch_id] || 0) + Number(v.amount || 0);
    }
    const profitByBranch: Record<string, number> = {};
    for (const inv of (invRes.data ?? []) as any[]) {
      let s = 0, c = 0;
      for (const it of inv.invoice_items ?? []) {
        const qty = Number(it.quantity) || 0;
        const netQty = Math.max(0, Number(it.net_quantity ?? (qty - Number(it.returned_quantity ?? 0))));
        const unitRev = qty > 0 ? Number(it.total) / qty : 0;
        s += unitRev * netQty;
        c += Number(it.unit_cost_at_sale ?? it.cost_price ?? 0) * netQty;
      }
      profitByBranch[inv.branch_id] = (profitByBranch[inv.branch_id] || 0) + (s - c);
    }
    const bp = branches.map((b: any) => ({
      id: b.id,
      name: b.name,
      profit: (profitByBranch[b.id] || 0) - (expByBranch[b.id] || 0),
    }));
    setBranchProfits(bp);
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

      <div className="p-6 lg:p-7 flex flex-col lg:flex-row gap-7 items-stretch lg:items-center justify-between">
        {/* Left: Main metric & filter */}
        <div className="flex flex-col gap-4 lg:w-[280px] shrink-0">
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
              <div className={`text-3xl lg:text-4xl font-extrabold tracking-tight ${net >= 0 ? "text-success" : "text-destructive"}`}>
                {loading ? <Loader2 className="w-7 h-7 animate-spin inline" /> : formatEGP(net)}
              </div>
              {deltaPct !== null && !loading && (
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
              {deltaPct === null ? "صافي الربح الإجمالي للفترة" : "مقارنة بالفترة السابقة"}
            </p>
          </div>
        </div>

        {/* Middle: Formula breakdown */}
        <div className="flex-1 w-full">
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-muted/40 border border-border relative overflow-hidden">
              <p className="text-muted-foreground text-[11px] mb-1 font-medium">إجمالي المبيعات</p>
              <p className="text-base lg:text-lg font-bold text-foreground truncate" title={formatEGP(sales)}>
                {formatEGP(sales)}
              </p>
              <div className="absolute bottom-0 left-0 w-14 h-14 bg-primary/10 rounded-tr-full -ml-3 -mb-3" />
            </div>
            <div className="p-3.5 rounded-xl bg-muted/40 border border-border relative overflow-hidden">
              <p className="text-muted-foreground text-[11px] mb-1 font-medium">التكلفة (COGS)</p>
              <p className="text-base lg:text-lg font-bold text-warning truncate" title={formatEGP(cost)}>
                {formatEGP(cost)}
              </p>
              <div className="absolute bottom-0 left-0 w-14 h-14 bg-warning/10 rounded-tr-full -ml-3 -mb-3" />
            </div>
            <div className="p-3.5 rounded-xl bg-muted/40 border border-border relative overflow-hidden">
              <p className="text-muted-foreground text-[11px] mb-1 font-medium">المصروفات التشغيلية</p>
              <p className="text-base lg:text-lg font-bold text-destructive truncate" title={formatEGP(expenses)}>
                {formatEGP(expenses)}
              </p>
              <div className="absolute bottom-0 left-0 w-14 h-14 bg-destructive/10 rounded-tr-full -ml-3 -mb-3" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-center gap-4">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-bold text-muted-foreground tracking-widest">
              المبيعات − التكلفة − المصروفات = صافي الربح
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
        </div>

        {/* Right: Branch contribution & CTA */}
        <div className="flex flex-col gap-3 w-full lg:w-64 shrink-0">
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
            to="/admin/reports?tab=profitability"
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
