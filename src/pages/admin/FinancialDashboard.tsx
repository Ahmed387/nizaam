import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDate } from "@/lib/format";
import {
  Wallet, HandCoins, TrendingDown, TrendingUp, AlertTriangle, Calendar,
  ArrowDownCircle, ArrowUpCircle, BarChart3,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend,
} from "recharts";

const fmtDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => fmtDay(new Date(Date.now() - n * 86400000));

export default function FinancialDashboard() {
  const [loading, setLoading] = useState(true);
  const [treasuryBalance, setTreasuryBalance] = useState(0);
  const [receivables, setReceivables] = useState(0);
  const [payables, setPayables] = useState(0);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [overdue, setOverdue] = useState<any[]>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<any[]>([]);
  const [topProfit, setTopProfit] = useState<any[]>([]);
  const [cashIn30, setCashIn30] = useState(0);
  const [cashOut30, setCashOut30] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const last30 = daysAgo(30);
    const next30 = fmtDay(new Date(Date.now() + 30 * 86400000));

    const [vAll, vRange, contactsRes, instUp, instOv, inv90] = await Promise.all([
      supabase.from("vouchers").select("type, amount").eq("status", "active"),
      supabase.from("vouchers").select("type, amount, voucher_date").eq("status", "active").gte("voucher_date", last30),
      supabase.from("contacts").select("contact_type, balance"),
      supabase
        .from("payment_installments")
        .select("id, due_date, amount, paid_amount, status, payment_plans!inner(entity_name, branch_id)")
        .in("status", ["pending", "partial"])
        .gte("due_date", fmtDay(new Date()))
        .lte("due_date", next30)
        .order("due_date", { ascending: true })
        .limit(20),
      supabase
        .from("payment_installments")
        .select("id, due_date, amount, paid_amount, status, payment_plans!inner(entity_name, branch_id)")
        .or("status.eq.overdue,and(status.eq.pending,due_date.lt." + fmtDay(new Date()) + ")")
        .order("due_date", { ascending: true })
        .limit(20),
      supabase
        .from("invoices")
        .select("created_at, total, invoice_items(quantity, unit_cost_at_sale, cost_price, total)")
        .eq("status", "active")
        .gte("created_at", daysAgo(180)),
    ]);

    // Treasury net
    const tBal = (vAll.data ?? []).reduce(
      (s: number, x: any) => s + (x.type === "receipt" ? 1 : -1) * Number(x.amount),
      0,
    );
    setTreasuryBalance(tBal);

    // Receivables / payables from contacts.balance (>0 = customer owes us, <0 = we owe supplier)
    let rec = 0, pay = 0;
    for (const c of (contactsRes.data ?? []) as any[]) {
      const b = Number(c.balance ?? 0);
      if (b > 0) rec += b;
      else if (b < 0) pay += -b;
    }
    setReceivables(rec);
    setPayables(pay);

    setUpcoming(instUp.data ?? []);
    setOverdue(instOv.data ?? []);

    // 30-day cash flow
    let cin = 0, cout = 0;
    for (const v of (vRange.data ?? []) as any[]) {
      if (v.type === "receipt") cin += Number(v.amount);
      else cout += Number(v.amount);
    }
    setCashIn30(cin);
    setCashOut30(cout);

    // Monthly trend (last 6 months) — sales & profit
    const months: Record<string, { month: string; sales: number; profit: number }> = {};
    for (const i of (inv90.data ?? []) as any[]) {
      const k = i.created_at.slice(0, 7);
      if (!months[k]) months[k] = { month: k, sales: 0, profit: 0 };
      const sales = Number(i.total);
      let cost = 0;
      for (const it of i.invoice_items ?? []) {
        const c = Number(it.unit_cost_at_sale ?? it.cost_price ?? 0);
        cost += c * Number(it.quantity);
      }
      months[k].sales += sales;
      months[k].profit += sales - cost;
    }
    setMonthlyTrend(Object.values(months).sort((a, b) => a.month.localeCompare(b.month)));

    // Top profit products (last 90 days)
    const prodMap: Record<string, { name: string; profit: number; revenue: number; qty: number }> = {};
    for (const i of (inv90.data ?? []) as any[]) {
      for (const it of i.invoice_items ?? []) {
        const name = (it as any).product_name || "—";
        const cost = Number(it.unit_cost_at_sale ?? it.cost_price ?? 0) * Number(it.quantity);
        const rev = Number(it.total);
        if (!prodMap[name]) prodMap[name] = { name, profit: 0, revenue: 0, qty: 0 };
        prodMap[name].profit += rev - cost;
        prodMap[name].revenue += rev;
        prodMap[name].qty += Number(it.quantity);
      }
    }
    setTopProfit(Object.values(prodMap).sort((a, b) => b.profit - a.profit).slice(0, 10));

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(
    ["vouchers", "contacts", "payment_installments", "payment_plans", "invoices", "invoice_items"],
    load,
  );

  return (
    <AdminLayout>
      <PageHeader
        title="الداشبورد المالي"
        subtitle="نظرة شاملة — كاش، مديونيات، أقساط، أرباح"
        actions={
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link to="/admin/report-comparison"><BarChart3 className="w-4 h-4" /> مقارنة الفترات</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="رصيد الخزن" value={formatEGP(treasuryBalance)} icon={<Wallet className="w-5 h-5" />} accent="primary" />
        <StatCard label="مستحق على العملاء" value={formatEGP(receivables)} icon={<HandCoins className="w-5 h-5" />} accent="success" />
        <StatCard label="مستحق للموردين" value={formatEGP(payables)} icon={<TrendingDown className="w-5 h-5" />} accent="destructive" />
        <StatCard label="أقساط متأخرة" value={overdue.length} icon={<AlertTriangle className="w-5 h-5" />} accent="warning" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="وارد (30 يوم)" value={formatEGP(cashIn30)} icon={<ArrowDownCircle className="w-5 h-5" />} accent="success" />
        <StatCard label="صادر (30 يوم)" value={formatEGP(cashOut30)} icon={<ArrowUpCircle className="w-5 h-5" />} accent="destructive" />
        <StatCard label="صافي التدفق" value={formatEGP(cashIn30 - cashOut30)} icon={<TrendingUp className="w-5 h-5" />} accent={cashIn30 - cashOut30 >= 0 ? "success" : "destructive"} />
        <StatCard label="أقساط قادمة (30 يوم)" value={upcoming.length} icon={<Calendar className="w-5 h-5" />} accent="primary" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="card-elevated p-4">
          <h3 className="font-bold mb-3">المبيعات والأرباح — آخر 6 أشهر</h3>
          {monthlyTrend.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">لا توجد بيانات</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip formatter={(v: any) => formatEGP(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                <Area type="monotone" dataKey="sales" name="المبيعات" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.25} />
                <Area type="monotone" dataKey="profit" name="الربح" stroke="hsl(var(--success))" fill="hsl(var(--success))" fillOpacity={0.25} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card-elevated p-4">
          <h3 className="font-bold mb-3">أكثر 10 منتجات ربحاً (90 يوم)</h3>
          {topProfit.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">لا توجد بيانات</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={topProfit} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip formatter={(v: any) => formatEGP(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Bar dataKey="profit" name="الربح" fill="hsl(var(--success))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <h3 className="font-bold mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive" /> أقساط متأخرة
          </h3>
          <DataTable
            loading={loading}
            rows={overdue}
            empty="لا توجد أقساط متأخرة"
            columns={[
              { key: "entity", header: "الجهة", render: (r: any) => r.payment_plans?.entity_name ?? "—" },
              { key: "due_date", header: "تاريخ الاستحقاق", render: (r: any) => formatDate(r.due_date) },
              { key: "amount_due", header: "المبلغ", render: (r: any) => <b className="text-destructive">{formatEGP(Number(r.amount) - Number(r.paid_amount))}</b> },
            ]}
          />
        </div>

        <div>
          <h3 className="font-bold mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" /> أقساط قادمة (30 يوم)
          </h3>
          <DataTable
            loading={loading}
            rows={upcoming}
            empty="لا توجد أقساط قادمة"
            columns={[
              { key: "entity", header: "الجهة", render: (r: any) => r.payment_plans?.entity_name ?? "—" },
              { key: "due_date", header: "تاريخ الاستحقاق", render: (r: any) => formatDate(r.due_date) },
              { key: "amount_due", header: "المبلغ", render: (r: any) => formatEGP(Number(r.amount) - Number(r.paid_amount)) },
            ]}
          />
        </div>
      </div>
    </AdminLayout>
  );
}
