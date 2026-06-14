import { useCallback, useEffect, useState } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { Link, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime } from "@/lib/format";
import { DollarSign, Wallet, AlertTriangle, UserPlus, TrendingUp, TrendingDown, Package, ShoppingBag, Target, ShoppingCart, RotateCcw, PackagePlus, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, FileText, ClipboardList, Undo2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend, PieChart, Pie, Cell,
} from "recharts";
import { ActiveReservationsPanel } from "@/components/ActiveReservationsPanel";

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
  const [profitMonth, setProfitMonth] = useState(0);
  const [paymentBreakdown, setPaymentBreakdown] = useState<any[]>([]);
  const [monthlyTarget, setMonthlyTarget] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
    const last30 = new Date(today); last30.setDate(last30.getDate() - 29);

    const [
      invToday, invYday, invMonth, invLastMonth, tr, prods, custs, recentInv,
      invLast30, invItemsToday, invAll30, branchRow,
    ] = await Promise.all([
      supabase.from("invoices").select("total, payment_method, invoice_items(quantity, total, returned_quantity)").eq("branch_id", id).eq("status", "active").gte("created_at", today.toISOString()),
      supabase.from("invoices").select("total, invoice_items(quantity, total, returned_quantity)").eq("branch_id", id).eq("status", "active").gte("created_at", yesterday.toISOString()).lt("created_at", today.toISOString()),
      supabase.from("invoices").select("total, invoice_items(quantity, total, returned_quantity)").eq("branch_id", id).eq("status", "active").gte("created_at", monthStart.toISOString()),
      supabase.from("invoices").select("total, invoice_items(quantity, total, returned_quantity)").eq("branch_id", id).eq("status", "active").gte("created_at", lastMonthStart.toISOString()).lte("created_at", lastMonthEnd.toISOString()),
      supabase.from("vouchers" as any).select("type, amount").eq("branch_id", id!).eq("status", "active"),
      supabase.from("products").select("id, name, quantity, low_stock_alert").eq("branch_id", id),
      supabase.from("contacts").select("id").eq("branch_id", id).gte("created_at", today.toISOString()),
      supabase.from("invoices").select("*, contacts:contact_id(name)").eq("branch_id", id).order("created_at", { ascending: false }).limit(5),
      supabase.from("invoices").select("created_at, total, invoice_items(quantity, total, returned_quantity)").eq("branch_id", id).eq("status", "active").gte("created_at", last30.toISOString()),
      supabase.from("invoice_items").select("product_name, quantity, returned_quantity, total, cost_price, selling_price, invoices!inner(branch_id, status, created_at)").eq("invoices.branch_id", id).eq("invoices.status", "active").gte("invoices.created_at", today.toISOString()),
      supabase.from("invoices").select("contact_id, total, invoice_items(quantity, total, returned_quantity), contacts:contact_id(name)").eq("branch_id", id).eq("status", "active").gte("created_at", last30.toISOString()).not("contact_id", "is", null),
      supabase.from("branches").select("monthly_sales_target").eq("id", id!).maybeSingle(),
    ]);
    const netInvoiceTotal = (inv: any) => {
      const rows = inv.invoice_items ?? [];
      if (!rows.length) return Number(inv.total ?? 0);
      return rows.reduce((sum: number, it: any) => {
        const qty = Number(it.quantity) || 0;
        const returned = Math.min(qty, Number(it.returned_quantity) || 0);
        return sum + (qty > 0 ? Number(it.total ?? 0) * ((qty - returned) / qty) : 0);
      }, 0);
    };
    setMonthlyTarget(Number((branchRow.data as any)?.monthly_sales_target ?? 0));

    setSalesToday((invToday.data ?? []).reduce((s, x: any) => s + netInvoiceTotal(x), 0));
    setSalesYesterday((invYday.data ?? []).reduce((s, x: any) => s + netInvoiceTotal(x), 0));
    setSalesMonth((invMonth.data ?? []).reduce((s, x: any) => s + netInvoiceTotal(x), 0));
    setSalesLastMonth((invLastMonth.data ?? []).reduce((s, x: any) => s + netInvoiceTotal(x), 0));
    setTreasury((tr.data ?? []).reduce((s, x: any) => s + (x.type === "receipt" ? 1 : -1) * Number(x.amount), 0));
    setLowStock((prods.data ?? []).filter((p: any) => p.quantity <= p.low_stock_alert));
    setNewCust((custs.data ?? []).length);
    setRecent(recentInv.data ?? []);

    setProfitToday((invItemsToday.data ?? []).reduce((s, it: any) => {
      const qty = Number(it.quantity) || 0;
      const netQty = Math.max(0, qty - (Number(it.returned_quantity) || 0));
      const netRevenue = qty > 0 ? Number(it.total ?? 0) * (netQty / qty) : 0;
      return s + netRevenue - Number(it.cost_price ?? 0) * netQty;
    }, 0));

    const payMap: Record<string, number> = {};
    (invToday.data ?? []).forEach((x: any) => {
      const k = x.payment_method || "cash";
      payMap[k] = (payMap[k] || 0) + netInvoiceTotal(x);
    });
    setPaymentBreakdown(Object.entries(payMap).map(([name, value]) => ({
      name: name === "cash" ? "نقدي" : name === "card" ? "بطاقة" : name,
      value,
    })));

    const dayMap: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(last30); d.setDate(d.getDate() + i);
      dayMap[d.toISOString().slice(5, 10)] = 0;
    }
    (invLast30.data ?? []).forEach((x: any) => {
      const k = x.created_at.slice(5, 10);
      if (k in dayMap) dayMap[k] += netInvoiceTotal(x);
    });
    setSalesByDay(Object.entries(dayMap).map(([date, total]) => ({ date, total })));

    const prodMap: Record<string, { name: string; qty: number; revenue: number }> = {};
    (invItemsToday.data ?? []).forEach((it: any) => {
      const qty = Number(it.quantity) || 0;
      const netQty = Math.max(0, qty - (Number(it.returned_quantity) || 0));
      if (!prodMap[it.product_name]) prodMap[it.product_name] = { name: it.product_name, qty: 0, revenue: 0 };
      prodMap[it.product_name].qty += netQty;
      prodMap[it.product_name].revenue += qty > 0 ? Number(it.total ?? 0) * (netQty / qty) : 0;
    });
    setTopProducts(Object.values(prodMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5));

    const custMap: Record<string, { name: string; total: number }> = {};
    (invAll30.data ?? []).forEach((x: any) => {
      const name = x.contacts?.name || "غير معروف";
      if (!custMap[name]) custMap[name] = { name, total: 0 };
      custMap[name].total += netInvoiceTotal(x);
    });
    setTopCustomers(Object.values(custMap).sort((a, b) => b.total - a.total).slice(0, 5));
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["invoices", "invoice_items", "returns", "return_items", "vouchers", "products", "contacts", "branches"], load);

  const todayVsYesterday = salesYesterday > 0 ? ((salesToday - salesYesterday) / salesYesterday) * 100 : 0;
  const monthVsLast = salesLastMonth > 0 ? ((salesMonth - salesLastMonth) / salesLastMonth) * 100 : 0;

  const shortcuts = [
    { to: `/branch/${id}/sales/new`, label: "بيع", icon: ShoppingCart, color: "text-success", bg: "bg-success/10" },
    { to: `/branch/${id}/shipments/new`, label: "شراء", icon: PackagePlus, color: "text-primary", bg: "bg-primary/10" },
    { to: `/branch/${id}/invoices?tab=sale_return`, label: "مرتجع بيع", icon: RotateCcw, color: "text-warning", bg: "bg-warning/10" },
    { to: `/branch/${id}/invoices?tab=purchase_return`, label: "مرتجع شراء", icon: Undo2, color: "text-warning", bg: "bg-warning/10" },
    { to: `/branch/${id}/treasury?action=income`, label: "قبض", icon: ArrowDownCircle, color: "text-success", bg: "bg-success/10" },
    { to: `/branch/${id}/treasury?action=expense`, label: "صرف", icon: ArrowUpCircle, color: "text-destructive", bg: "bg-destructive/10" },
    { to: `/branch/${id}/transfers`, label: "تحويل مخازن", icon: ArrowLeftRight, color: "text-primary", bg: "bg-primary/10" },
    { to: `/branch/${id}/invoices?tab=quote`, label: "عرض أسعار", icon: FileText, color: "text-secondary", bg: "bg-secondary/10" },
    { to: `/branch/${id}/inventory?tab=count`, label: "جرد المخزن", icon: ClipboardList, color: "text-primary", bg: "bg-primary/10" },
    { to: `/branch/${id}/inventory?tab=adjustments`, label: "تسوية مخزون", icon: ClipboardList, color: "text-warning", bg: "bg-warning/10" },
  ];

  return (
    <BranchLayout>
      <PageHeader title="لوحة الفرع" subtitle="نظرة عامة على نشاط اليوم" />

      {/* Active reservations (real-time) */}
      {id && <div className="mb-6"><ActiveReservationsPanel branchId={id} /></div>}


      {/* Quick actions */}
      <div className="card-elevated p-4 mb-6">
        <h3 className="font-bold mb-3 text-sm text-muted-foreground">إجراءات سريعة</h3>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
          {shortcuts.map((s) => (
            <a key={s.label} href={s.to} target="_blank" rel="noopener noreferrer"
              className="flex flex-col items-center gap-2 p-3 rounded-lg border border-border hover:border-primary hover:shadow-md transition-all group">
              <div className={`w-11 h-11 rounded-full ${s.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
              <span className="text-[11px] font-semibold text-center leading-tight">{s.label}</span>
            </a>
          ))}
        </div>
      </div>


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

      {monthlyTarget > 0 && (() => {
        const pct = Math.min(100, (salesMonth / monthlyTarget) * 100);
        const remaining = Math.max(0, monthlyTarget - salesMonth);
        const onTrack = pct >= 80;
        return (
          <div className="card-elevated p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className={`w-5 h-5 ${onTrack ? "text-success" : "text-warning"}`} />
                <h3 className="font-bold">هدف الشهر</h3>
              </div>
              <div className="text-sm text-muted-foreground">
                {formatEGP(salesMonth)} <span className="mx-1">/</span> <b>{formatEGP(monthlyTarget)}</b>
              </div>
            </div>
            <Progress value={pct} className="h-3" />
            <div className="flex items-center justify-between mt-2 text-xs">
              <span className={onTrack ? "text-success font-semibold" : "text-warning font-semibold"}>
                {pct.toFixed(1)}% من الهدف
              </span>
              <span className="text-muted-foreground">
                {remaining > 0 ? `متبقي ${formatEGP(remaining)} لتحقيق الهدف` : "🎉 تم تحقيق الهدف!"}
              </span>
            </div>
          </div>
        );
      })()}


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
            { key: "customer", header: "العميل", render: (r: any) => r.contacts?.name ?? "نقدي" },
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
