import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime } from "@/lib/format";
import { DollarSign, Wallet, AlertTriangle, UserPlus, TrendingUp, TrendingDown, Package, ShoppingBag, Target } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend, PieChart, Pie, Cell,
} from "recharts";

const COLORS = ["hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--destructive))", "hsl(var(--accent))"];

export default function BranchDashboard() {
  const { id } = useParams<{ id: string }>();
  const [salesToday, setSalesToday] = useState(0);
  const [salesYesterday, setSalesYesterday] = useState(0);
  const [salesMonth, setSalesMonth] = useState(0);
  const [salesLastMonth, setSalesLastMonth] = useState(0);
  const [treasury, setTreasury] = useState(0);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [newCust, setNewCust] = useState(0);
  const [recent, setRecent] = useState<any[]>([]);
  const [salesByDay, setSalesByDay] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [topCustomers, setTopCustomers] = useState<any[]>([]);
  const [profitToday, setProfitToday] = useState(0);
  const [paymentBreakdown, setPaymentBreakdown] = useState<any[]>([]);
  const [monthlyTarget, setMonthlyTarget] = useState(0);

  useEffect(() => {
    if (!id) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
    const last30 = new Date(today); last30.setDate(last30.getDate() - 29);

    (async () => {
      const [
        invToday, invYday, invMonth, invLastMonth, tr, prods, custs, recentInv,
        invLast30, invItemsToday, invAll30,
      ] = await Promise.all([
        supabase.from("invoices").select("total, payment_method").eq("branch_id", id).eq("status", "active").gte("created_at", today.toISOString()),
        supabase.from("invoices").select("total").eq("branch_id", id).eq("status", "active").gte("created_at", yesterday.toISOString()).lt("created_at", today.toISOString()),
        supabase.from("invoices").select("total").eq("branch_id", id).eq("status", "active").gte("created_at", monthStart.toISOString()),
        supabase.from("invoices").select("total").eq("branch_id", id).eq("status", "active").gte("created_at", lastMonthStart.toISOString()).lte("created_at", lastMonthEnd.toISOString()),
        supabase.from("treasury").select("type, amount").eq("branch_id", id),
        supabase.from("products").select("id, name, quantity, low_stock_alert").eq("branch_id", id),
        supabase.from("customers").select("id").eq("branch_id", id).gte("created_at", today.toISOString()),
        supabase.from("invoices").select("*, customers(name)").eq("branch_id", id).order("created_at", { ascending: false }).limit(5),
        supabase.from("invoices").select("created_at, total").eq("branch_id", id).eq("status", "active").gte("created_at", last30.toISOString()),
        supabase.from("invoice_items").select("product_name, quantity, total, cost_price, selling_price, invoices!inner(branch_id, status, created_at)").eq("invoices.branch_id", id).eq("invoices.status", "active").gte("invoices.created_at", today.toISOString()),
        supabase.from("invoices").select("customer_id, total, customers(name)").eq("branch_id", id).eq("status", "active").gte("created_at", last30.toISOString()).not("customer_id", "is", null),
      ]);

      setSalesToday((invToday.data ?? []).reduce((s, x: any) => s + Number(x.total), 0));
      setSalesYesterday((invYday.data ?? []).reduce((s, x: any) => s + Number(x.total), 0));
      setSalesMonth((invMonth.data ?? []).reduce((s, x: any) => s + Number(x.total), 0));
      setSalesLastMonth((invLastMonth.data ?? []).reduce((s, x: any) => s + Number(x.total), 0));
      setTreasury((tr.data ?? []).reduce((s, x: any) => s + (x.type === "income" ? 1 : -1) * Number(x.amount), 0));
      setLowStock((prods.data ?? []).filter((p: any) => p.quantity <= p.low_stock_alert));
      setNewCust((custs.data ?? []).length);
      setRecent(recentInv.data ?? []);

      // Profit today
      setProfitToday((invItemsToday.data ?? []).reduce(
        (s, it: any) => s + (Number(it.selling_price) - Number(it.cost_price)) * it.quantity, 0
      ));

      // Payment breakdown today
      const payMap: Record<string, number> = {};
      (invToday.data ?? []).forEach((x: any) => {
        const k = x.payment_method || "cash";
        payMap[k] = (payMap[k] || 0) + Number(x.total);
      });
      setPaymentBreakdown(Object.entries(payMap).map(([name, value]) => ({
        name: name === "cash" ? "نقدي" : name === "card" ? "بطاقة" : name,
        value,
      })));

      // Sales by day (last 30)
      const dayMap: Record<string, number> = {};
      for (let i = 0; i < 30; i++) {
        const d = new Date(last30); d.setDate(d.getDate() + i);
        dayMap[d.toISOString().slice(5, 10)] = 0;
      }
      (invLast30.data ?? []).forEach((x: any) => {
        const k = x.created_at.slice(5, 10);
        if (k in dayMap) dayMap[k] += Number(x.total);
      });
      setSalesByDay(Object.entries(dayMap).map(([date, total]) => ({ date, total })));

      // Top products
      const prodMap: Record<string, { name: string; qty: number; revenue: number }> = {};
      (invItemsToday.data ?? []).forEach((it: any) => {
        if (!prodMap[it.product_name]) prodMap[it.product_name] = { name: it.product_name, qty: 0, revenue: 0 };
        prodMap[it.product_name].qty += it.quantity;
        prodMap[it.product_name].revenue += Number(it.total);
      });
      setTopProducts(Object.values(prodMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5));

      // Top customers
      const custMap: Record<string, { name: string; total: number }> = {};
      (invAll30.data ?? []).forEach((x: any) => {
        const name = x.customers?.name || "غير معروف";
        if (!custMap[name]) custMap[name] = { name, total: 0 };
        custMap[name].total += Number(x.total);
      });
      setTopCustomers(Object.values(custMap).sort((a, b) => b.total - a.total).slice(0, 5));
    })();
  }, [id]);

  const todayVsYesterday = salesYesterday > 0 ? ((salesToday - salesYesterday) / salesYesterday) * 100 : 0;
  const monthVsLast = salesLastMonth > 0 ? ((salesMonth - salesLastMonth) / salesLastMonth) * 100 : 0;

  return (
    <BranchLayout>
      <PageHeader title="لوحة الفرع" subtitle="نظرة عامة على نشاط اليوم" />

      {/* KPI Cards with comparisons */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card-elevated p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">مبيعات اليوم</span>
            <DollarSign className="w-4 h-4 text-success" />
          </div>
          <div className="text-2xl font-bold">{formatEGP(salesToday)}</div>
          <div className="text-xs mt-1 flex items-center gap-1">
            {todayVsYesterday >= 0 ? <TrendingUp className="w-3 h-3 text-success" /> : <TrendingDown className="w-3 h-3 text-destructive" />}
            <span className={todayVsYesterday >= 0 ? "text-success" : "text-destructive"}>
              {todayVsYesterday >= 0 ? "+" : ""}{todayVsYesterday.toFixed(1)}%
            </span>
            <span className="text-muted-foreground">vs أمس</span>
          </div>
        </div>

        <div className="card-elevated p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">مبيعات الشهر</span>
            <ShoppingBag className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-bold">{formatEGP(salesMonth)}</div>
          <div className="text-xs mt-1 flex items-center gap-1">
            {monthVsLast >= 0 ? <TrendingUp className="w-3 h-3 text-success" /> : <TrendingDown className="w-3 h-3 text-destructive" />}
            <span className={monthVsLast >= 0 ? "text-success" : "text-destructive"}>
              {monthVsLast >= 0 ? "+" : ""}{monthVsLast.toFixed(1)}%
            </span>
            <span className="text-muted-foreground">vs الشهر السابق</span>
          </div>
        </div>

        <div className="card-elevated p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">صافي الربح اليوم</span>
            <TrendingUp className="w-4 h-4 text-success" />
          </div>
          <div className={"text-2xl font-bold " + (profitToday >= 0 ? "text-success" : "text-destructive")}>
            {formatEGP(profitToday)}
          </div>
          <div className="text-xs mt-1 text-muted-foreground">
            هامش: {salesToday > 0 ? ((profitToday / salesToday) * 100).toFixed(1) : 0}%
          </div>
        </div>

        <div className="card-elevated p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">رصيد الخزنة</span>
            <Wallet className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-bold">{formatEGP(treasury)}</div>
          <div className="text-xs mt-1 text-muted-foreground">
            {newCust} عميل جديد اليوم
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        <div className="card-elevated p-4 lg:col-span-2">
          <h3 className="font-bold mb-3">المبيعات آخر 30 يوم</h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={salesByDay}>
              <defs>
                <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                formatter={(v: any) => formatEGP(Number(v))}
              />
              <Area type="monotone" dataKey="total" stroke="hsl(var(--primary))" fill="url(#grad1)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card-elevated p-4">
          <h3 className="font-bold mb-3">طرق الدفع اليوم</h3>
          {paymentBreakdown.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">لا توجد مبيعات اليوم</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={paymentBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e: any) => e.name}>
                  {paymentBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => formatEGP(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top products & customers */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="card-elevated p-4">
          <h3 className="font-bold mb-3 flex items-center gap-2"><Package className="w-4 h-4 text-primary" /> أكثر المنتجات مبيعاً اليوم</h3>
          {topProducts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">لا توجد بيانات</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topProducts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip formatter={(v: any) => formatEGP(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card-elevated p-4">
          <h3 className="font-bold mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4 text-primary" /> أكثر العملاء شراءً (30 يوم)</h3>
          {topCustomers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">لا توجد بيانات</div>
          ) : (
            <div className="space-y-2">
              {topCustomers.map((c, i) => (
                <div key={c.name} className="flex items-center justify-between p-2 rounded hover:bg-surface-2">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</div>
                    <span className="font-medium text-sm">{c.name}</span>
                  </div>
                  <span className="font-bold text-success">{formatEGP(c.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent invoices & low stock */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <h3 className="font-bold mb-3">آخر الفواتير</h3>
          <DataTable rows={recent} columns={[
            { key: "invoice_number", header: "رقم", render: (r: any) => <span className="font-mono text-primary">{r.invoice_number}</span> },
            { key: "customer", header: "العميل", render: (r: any) => r.customers?.name ?? "نقدي" },
            { key: "total", header: "المبلغ", render: (r: any) => formatEGP(r.total) },
            { key: "created_at", header: "الوقت", render: (r: any) => formatDateTime(r.created_at) },
          ]} />
        </div>
        <div>
          <h3 className="font-bold mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-warning" /> تنبيهات المخزون ({lowStock.length})</h3>
          <DataTable rows={lowStock} empty="كل المنتجات بمخزون كافٍ ✓"
            columns={[
              { key: "name", header: "المنتج", render: (r: any) => <span className="font-semibold">{r.name}</span> },
              { key: "quantity", header: "المتاح", render: (r: any) => <span className={r.quantity === 0 ? "text-destructive font-bold" : "text-warning font-bold"}>{r.quantity}</span> },
              { key: "low_stock_alert", header: "الحد التنبيهي" },
            ]} />
        </div>
      </div>
    </BranchLayout>
  );
}
