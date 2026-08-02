import { useEffect, useState, useCallback } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/StatCard";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { TrendingUp, TrendingDown, ShoppingCart, Wallet, ArrowRight } from "lucide-react";
import {
import { useBranchScope } from "@/lib/branchScope";
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

type Period = { from: string; to: string };

type Stats = {
  sales: number;
  cost: number;
  profit: number;
  expenses: number;
  net: number;
  invoiceCount: number;
  cashIn: number;
  cashOut: number;
};

const emptyStats: Stats = { sales: 0, cost: 0, profit: 0, expenses: 0, net: 0, invoiceCount: 0, cashIn: 0, cashOut: 0 };

async function loadStats(p: Period, branchId: string): Promise<Stats> {
  const fromIso = new Date(p.from).toISOString();
  const toIso = new Date(p.to + "T23:59:59").toISOString();

  let invQ = supabase
    .from("invoices")
    .select("total, status, branch_id, invoice_items(quantity, unit_cost_at_sale, cost_price)")
    .gte("created_at", fromIso).lte("created_at", toIso);
  let expQ = supabase
    .from("vouchers").select("amount, branch_id, voucher_categories!inner(is_deductible_from_profit)")
    .eq("type", "payment").eq("status", "active")
    .eq("voucher_categories.is_deductible_from_profit", true)
    .gte("voucher_date", p.from).lte("voucher_date", p.to);

  let trQ = supabase
    .from("vouchers").select("type, amount, branch_id").eq("status", "active")
    .gte("voucher_date", p.from).lte("voucher_date", p.to);

  if (branchId !== "global") {
    invQ = invQ.eq("branch_id", branchId);
    expQ = expQ.eq("branch_id", branchId);
    trQ = trQ.eq("branch_id", branchId);
  }
  const [inv, exp, tr] = await Promise.all([invQ, expQ, trQ]);

  const s: Stats = { ...emptyStats };
  for (const i of (inv.data ?? []) as any[]) {
    if (i.status !== "active") continue;
    s.invoiceCount++;
    s.sales += Number(i.total);
    for (const it of i.invoice_items ?? []) {
      s.cost += Number(it.unit_cost_at_sale ?? it.cost_price ?? 0) * Number(it.quantity);
    }
  }
  s.profit = s.sales - s.cost;
  s.expenses = (exp.data ?? []).reduce((a: number, x: any) => a + Number(x.amount), 0);
  s.net = s.profit - s.expenses;
  for (const v of (tr.data ?? []) as any[]) {
    if (v.type === "receipt") s.cashIn += Number(v.amount);
    else s.cashOut += Number(v.amount);
  }
  return s;
}

function delta(curr: number, prev: number): { abs: number; pct: number | null } {
  const abs = curr - prev;
  const pct = prev === 0 ? (curr === 0 ? 0 : null) : (abs / Math.abs(prev)) * 100;
  return { abs, pct };
}

function DeltaCell({ curr, prev, invert }: { curr: number; prev: number; invert?: boolean }) {
  const { abs, pct } = delta(curr, prev);
  const positive = invert ? abs < 0 : abs > 0;
  const cls = abs === 0 ? "text-muted-foreground" : positive ? "text-success" : "text-destructive";
  return (
    <span className={cls + " text-xs font-semibold"}>
      {abs > 0 ? "▲" : abs < 0 ? "▼" : "•"} {formatEGP(Math.abs(abs))}
      {pct !== null && ` (${pct.toFixed(1)}%)`}
    </span>
  );
}

export default function ReportComparison() {
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const { filterBranches } = useBranchScope();
  const [branchId, setBranchId] = useState("global");

  // Period A defaults: last 30 days
  const [aFrom, setAFrom] = useState(daysAgo(30));
  const [aTo, setATo] = useState(today());
  // Period B defaults: 30 days prior to A
  const [bFrom, setBFrom] = useState(daysAgo(60));
  const [bTo, setBTo] = useState(daysAgo(31));

  const [statsA, setStatsA] = useState<Stats>(emptyStats);
  const [statsB, setStatsB] = useState<Stats>(emptyStats);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from("branches").select("id,name").eq("is_active", true).neq("code", "PARTNER-CASH").then((r) => {
      setBranches(filterBranches((r.data ?? []) as any) as any);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, b] = await Promise.all([
      loadStats({ from: aFrom, to: aTo }, branchId),
      loadStats({ from: bFrom, to: bTo }, branchId),
    ]);
    setStatsA(a); setStatsB(b);
    setLoading(false);
  }, [aFrom, aTo, bFrom, bTo, branchId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["invoices", "invoice_items", "vouchers"], load);

  const setQuick = (days: number) => {
    setAFrom(daysAgo(days)); setATo(today());
    setBFrom(daysAgo(days * 2)); setBTo(daysAgo(days + 1));
  };

  const chartData = [
    { k: "المبيعات", A: statsA.sales, B: statsB.sales },
    { k: "التكلفة", A: statsA.cost, B: statsB.cost },
    { k: "إجمالي الربح", A: statsA.profit, B: statsB.profit },
    { k: "المصروفات", A: statsA.expenses, B: statsB.expenses },
    { k: "صافي الربح", A: statsA.net, B: statsB.net },
    { k: "وارد الخزنة", A: statsA.cashIn, B: statsB.cashIn },
    { k: "صادر الخزنة", A: statsA.cashOut, B: statsB.cashOut },
  ];

  return (
    <AdminLayout>
      <PageHeader title="مقارنة الفترات" subtitle="قارن أداء فترتين زمنيتين جنباً إلى جنب" />

      <div className="card-elevated p-4 mb-6 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>الفرع</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="mt-1.5 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="global">كل الفروع</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 mr-auto flex-wrap">
            <Button size="sm" variant="ghost" onClick={() => setQuick(7)}>أسبوع vs أسبوع</Button>
            <Button size="sm" variant="ghost" onClick={() => setQuick(30)}>شهر vs شهر</Button>
            <Button size="sm" variant="ghost" onClick={() => setQuick(90)}>3 شهور vs 3 شهور</Button>
            <Button size="sm" variant="ghost" onClick={() => setQuick(365)}>سنة vs سنة</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
            <div className="text-xs font-bold text-primary mb-2">الفترة الحالية (A)</div>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <Label className="text-xs">من</Label>
                <Input type="date" value={aFrom} onChange={(e) => setAFrom(e.target.value)} className="mt-1" />
              </div>
              <div className="flex-1">
                <Label className="text-xs">إلى</Label>
                <Input type="date" value={aTo} onChange={(e) => setATo(e.target.value)} className="mt-1" />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-muted-foreground/30 bg-muted/30 p-3">
            <div className="text-xs font-bold text-muted-foreground mb-2">فترة المقارنة (B)</div>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <Label className="text-xs">من</Label>
                <Input type="date" value={bFrom} onChange={(e) => setBFrom(e.target.value)} className="mt-1" />
              </div>
              <div className="flex-1">
                <Label className="text-xs">إلى</Label>
                <Input type="date" value={bTo} onChange={(e) => setBTo(e.target.value)} className="mt-1" />
              </div>
            </div>
          </div>
        </div>

        <Button onClick={load} disabled={loading} className="gap-2">
          <ArrowRight className="w-4 h-4" /> {loading ? "جارٍ التحديث..." : "تحديث المقارنة"}
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <ComparisonCard label="المبيعات" a={statsA.sales} b={statsB.sales} icon={<ShoppingCart className="w-4 h-4" />} />
        <ComparisonCard label="إجمالي الربح" a={statsA.profit} b={statsB.profit} icon={<TrendingUp className="w-4 h-4" />} accent="success" />
        <ComparisonCard label="المصروفات" a={statsA.expenses} b={statsB.expenses} icon={<TrendingDown className="w-4 h-4" />} accent="destructive" invert />
        <ComparisonCard label="صافي الربح" a={statsA.net} b={statsB.net} icon={<Wallet className="w-4 h-4" />} accent={statsA.net >= 0 ? "success" : "destructive"} />
      </div>

      <div className="card-elevated p-4 mb-6">
        <h3 className="font-bold mb-3">مقارنة بصرية</h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="k" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip formatter={(v: any) => formatEGP(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
            <Legend />
            <Bar dataKey="A" name={`الفترة A (${aFrom} → ${aTo})`} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="B" name={`الفترة B (${bFrom} → ${bTo})`} fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card-elevated p-4">
        <h3 className="font-bold mb-3">تفصيل المقارنة</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-right">
              <th className="p-2">البند</th>
              <th className="p-2">الفترة A</th>
              <th className="p-2">الفترة B</th>
              <th className="p-2">التغير</th>
            </tr>
          </thead>
          <tbody>
            <Row label="عدد الفواتير" a={statsA.invoiceCount} b={statsB.invoiceCount} kind="num" />
            <Row label="المبيعات" a={statsA.sales} b={statsB.sales} />
            <Row label="التكلفة" a={statsA.cost} b={statsB.cost} invert />
            <Row label="إجمالي الربح" a={statsA.profit} b={statsB.profit} />
            <Row label="المصروفات" a={statsA.expenses} b={statsB.expenses} invert />
            <Row label="صافي الربح" a={statsA.net} b={statsB.net} />
            <Row label="وارد الخزنة" a={statsA.cashIn} b={statsB.cashIn} />
            <Row label="صادر الخزنة" a={statsA.cashOut} b={statsB.cashOut} invert />
          </tbody>
        </table>
      </div>
    </AdminLayout>
  );
}

function Row({ label, a, b, invert, kind }: { label: string; a: number; b: number; invert?: boolean; kind?: "num" }) {
  const fmt = (n: number) => (kind === "num" ? String(n) : formatEGP(n));
  return (
    <tr className="border-b border-border/40">
      <td className="p-2 font-medium">{label}</td>
      <td className="p-2"><b>{fmt(a)}</b></td>
      <td className="p-2 text-muted-foreground">{fmt(b)}</td>
      <td className="p-2">{kind === "num"
        ? <span className={a - b > 0 ? "text-success" : a - b < 0 ? "text-destructive" : "text-muted-foreground"}>{a - b > 0 ? "▲" : a - b < 0 ? "▼" : "•"} {Math.abs(a - b)}</span>
        : <DeltaCell curr={a} prev={b} invert={invert} />}
      </td>
    </tr>
  );
}

function ComparisonCard({ label, a, b, icon, accent, invert }: any) {
  return (
    <div className="card-elevated p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">{icon} {label}</div>
      <div className="text-lg font-bold">{formatEGP(a)}</div>
      <div className="text-xs text-muted-foreground">B: {formatEGP(b)}</div>
      <div className="mt-1"><DeltaCell curr={a} prev={b} invert={invert} /></div>
    </div>
  );
}
