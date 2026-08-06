import { useCallback, useEffect, useState } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { Link, useParams, useNavigate } from "react-router-dom";

import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { invoiceProfit } from "@/lib/profitEngine";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime } from "@/lib/format";
import { fetchRecentDocs, RECENT_DOC_KIND_CLASS, type RecentDoc } from "@/lib/recentDocs";
import { DollarSign, Wallet, AlertTriangle, UserPlus, TrendingUp, TrendingDown, Package, ShoppingBag, Target, ShoppingCart, RotateCcw, PackagePlus, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, FileText, ClipboardList, Undo2, BookmarkPlus, Truck, Paperclip } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Progress } from "@/components/ui/progress";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend, PieChart, Pie, Cell,
} from "recharts";
import { ShareBreakdown } from "@/components/charts/RankBars";
import { ActiveReservationsPanel } from "@/components/ActiveReservationsPanel";


const COLORS = ["hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--destructive))", "hsl(var(--accent))"];

export default function BranchDashboard() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { can, isAdmin } = useAuth();
  const [salesToday, setSalesToday] = useState(0);

  const [salesYesterday, setSalesYesterday] = useState(0);
  const [salesMonth, setSalesMonth] = useState(0);
  const [salesLastMonth, setSalesLastMonth] = useState(0);
  const [treasury, setTreasury] = useState(0);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [newCust, setNewCust] = useState(0);
  const [recent, setRecent] = useState<RecentDoc[]>([]);
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
      invToday, invYday, invMonth, invLastMonth, tr, prods, custs, recentDocs,
      invLast30, invItemsToday, invItemsMonth, invAll30, branchRow,
    ] = await Promise.all([
      supabase.from("invoices").select("total, payment_method, discount_amount, invoice_items(quantity, total, returned_quantity)").eq("branch_id", id).eq("status", "active").not("is_migrated","is",true).gte("created_at", today.toISOString()),
      supabase.from("invoices").select("total, discount_amount, invoice_items(quantity, total, returned_quantity)").eq("branch_id", id).eq("status", "active").not("is_migrated","is",true).gte("created_at", yesterday.toISOString()).lt("created_at", today.toISOString()),
      supabase.from("invoices").select("total, discount_amount, invoice_items(quantity, total, returned_quantity)").eq("branch_id", id).eq("status", "active").not("is_migrated","is",true).gte("created_at", monthStart.toISOString()),
      supabase.from("invoices").select("total, discount_amount, invoice_items(quantity, total, returned_quantity)").eq("branch_id", id).eq("status", "active").not("is_migrated","is",true).gte("created_at", lastMonthStart.toISOString()).lte("created_at", lastMonthEnd.toISOString()),
      supabase.from("vouchers" as any).select("type, amount").eq("branch_id", id!).eq("status", "active"),
      supabase.from("products").select("id, name, quantity, low_stock_alert").eq("branch_id", id),
      supabase.from("contacts").select("id").eq("branch_id", id).gte("created_at", today.toISOString()),
      fetchRecentDocs(5, id),
      supabase.from("invoices").select("created_at, total, discount_amount, invoice_items(quantity, total, returned_quantity)").eq("branch_id", id).eq("status", "active").not("is_migrated","is",true).gte("created_at", last30.toISOString()),
      supabase.from("invoice_items").select("product_name, quantity, returned_quantity, total, cost_price, selling_price, invoices!inner(branch_id, status, created_at)").eq("invoices.branch_id", id).eq("invoices.status", "active").not("invoices.is_migrated","is",true).gte("invoices.created_at", today.toISOString()),
      supabase.from("invoice_items").select("quantity, returned_quantity, total, cost_price, invoices!inner(branch_id, status, created_at)").eq("invoices.branch_id", id).eq("invoices.status", "active").not("invoices.is_migrated","is",true).gte("invoices.created_at", monthStart.toISOString()),
      supabase.from("invoices").select("contact_id, total, discount_amount, invoice_items(quantity, total, returned_quantity), contacts:contact_id(name)").eq("branch_id", id).eq("status", "active").not("is_migrated","is",true).gte("created_at", last30.toISOString()).not("contact_id", "is", null),
      supabase.from("branches").select("monthly_sales_target").eq("id", id!).maybeSingle(),
    ]);
    const netInvoiceTotal = (inv: any) => {
      const rows = inv.invoice_items ?? [];
      if (!rows.length) return Number(inv.total ?? 0);
      // صافي المبيعات = بعد المرتجعات وبعد خصم الفاتورة ككل
      return invoiceProfit(inv).revenue;
    };
    setMonthlyTarget(Number((branchRow.data as any)?.monthly_sales_target ?? 0));

    setSalesToday((invToday.data ?? []).reduce((s, x: any) => s + netInvoiceTotal(x), 0));
    setSalesYesterday((invYday.data ?? []).reduce((s, x: any) => s + netInvoiceTotal(x), 0));
    setSalesMonth((invMonth.data ?? []).reduce((s, x: any) => s + netInvoiceTotal(x), 0));
    setSalesLastMonth((invLastMonth.data ?? []).reduce((s, x: any) => s + netInvoiceTotal(x), 0));
    setTreasury((tr.data ?? []).reduce((s, x: any) => s + (x.type === "receipt" ? 1 : -1) * Number(x.amount), 0));
    setLowStock((prods.data ?? []).filter((p: any) => p.quantity <= p.low_stock_alert));
    setNewCust((custs.data ?? []).length);
    setRecent(recentDocs as RecentDoc[]);

    const computeProfit = (rows: any[]) => rows.reduce((s, it: any) => {
      const qty = Number(it.quantity) || 0;
      const netQty = Math.max(0, qty - (Number(it.returned_quantity) || 0));
      const netRevenue = qty > 0 ? Number(it.total ?? 0) * (netQty / qty) : 0;
      return s + netRevenue - Number(it.cost_price ?? 0) * netQty;
    }, 0);
    setProfitToday(computeProfit(invItemsToday.data ?? []));
    setProfitMonth(computeProfit(invItemsMonth.data ?? []));

    const payMap: Record<string, number> = {};
    (invToday.data ?? []).forEach((x: any) => {
      const k = x.payment_method || "cash";
      payMap[k] = (payMap[k] || 0) + netInvoiceTotal(x);
    });
    setPaymentBreakdown(Object.entries(payMap).map(([name, value]) => ({
      name: name === "cash" ? "نقدي" : name === "card" ? "بطاقة" : name,
      value,
    })));

    const monthNames = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
    const dayMap: Record<string, { date: string; displayDate: string; total: number }> = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(last30); d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(5, 10);
      dayMap[key] = {
        date: key,
        displayDate: `${d.getDate()} ${monthNames[d.getMonth()]}`,
        total: 0,
      };
    }
    (invLast30.data ?? []).forEach((x: any) => {
      const k = x.created_at.slice(5, 10);
      if (k in dayMap) dayMap[k].total += netInvoiceTotal(x);
    });
    setSalesByDay(Object.values(dayMap).map((d) => ({ date: d.date, displayDate: d.displayDate, total: d.total })));

    const prodMap: Record<string, { name: string; qty: number; revenue: number }> = {};
    (invItemsToday.data ?? []).forEach((it: any) => {
      const qty = Number(it.quantity) || 0;
      const netQty = Math.max(0, qty - (Number(it.returned_quantity) || 0));
      if (!prodMap[it.product_name]) prodMap[it.product_name] = { name: it.product_name, qty: 0, revenue: 0 };
      prodMap[it.product_name].qty += netQty;
      prodMap[it.product_name].revenue += qty > 0 ? Number(it.total ?? 0) * (netQty / qty) : 0;
    });
    setTopProducts(Object.values(prodMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5));

    const custMap: Record<string, { id: string | null; name: string; total: number }> = {};
    (invAll30.data ?? []).forEach((x: any) => {
      const cid = x.contact_id || "__unknown__";
      const name = x.contacts?.name || "غير معروف";
      if (!custMap[cid]) custMap[cid] = { id: x.contact_id ?? null, name, total: 0 };
      custMap[cid].total += netInvoiceTotal(x);
    });
    setTopCustomers(Object.values(custMap).sort((a, b) => b.total - a.total).slice(0, 5));
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["invoices", "invoice_items", "shipments", "purchase_returns", "returns", "return_items", "vouchers", "products", "contacts", "branches"], load);

  const todayVsYesterday = salesYesterday > 0 ? ((salesToday - salesYesterday) / salesYesterday) * 100 : 0;
  const monthVsLast = salesLastMonth > 0 ? ((salesMonth - salesLastMonth) / salesLastMonth) * 100 : 0;

  const shortcuts = [
    { to: `/branch/${id}/sales/new`, label: "بيع", icon: ShoppingCart, color: "text-success", bg: "bg-success/10" },
    { to: `/branch/${id}/shipments/new`, label: "شراء", icon: PackagePlus, color: "text-primary", bg: "bg-primary/10" },
    { to: `/branch/${id}/pre-orders`, label: "طلبات الحجز", icon: BookmarkPlus, color: "text-secondary", bg: "bg-secondary/10" },
    { to: `/branch/${id}/invoices?tab=sale_return`, label: "مرتجع بيع", icon: RotateCcw, color: "text-warning", bg: "bg-warning/10" },
    { to: `/branch/${id}/invoices?tab=purchase_return`, label: "مرتجع شراء", icon: Undo2, color: "text-warning", bg: "bg-warning/10" },
    { to: `/branch/${id}/treasury?tab=receipts`, label: "قبض", icon: ArrowDownCircle, color: "text-success", bg: "bg-success/10" },
    { to: `/branch/${id}/treasury?tab=payments`, label: "صرف", icon: ArrowUpCircle, color: "text-destructive", bg: "bg-destructive/10" },
    { to: `/branch/${id}/transfers`, label: "تحويل مخازن", icon: ArrowLeftRight, color: "text-primary", bg: "bg-primary/10" },
    { to: `/branch/${id}/invoices?tab=quote`, label: "عرض أسعار", icon: FileText, color: "text-secondary", bg: "bg-secondary/10" },
    { to: `/branch/${id}/inventory?tab=count`, label: "جرد الفرع", icon: ClipboardList, color: "text-primary", bg: "bg-primary/10" },
    { to: `/branch/${id}/inventory?tab=adjustments`, label: "تسوية مخزون", icon: ClipboardList, color: "text-warning", bg: "bg-warning/10" },
    { to: `/branch/${id}/shipments`, label: "الشحنات", icon: Truck, color: "text-primary", bg: "bg-primary/10" },
    ...(isAdmin || can("attachments.view")
      ? [{ to: `/branch/${id}/attachments`, label: "المرفقات", icon: Paperclip, color: "text-accent-foreground", bg: "bg-accent/10" }]
      : []),
  ];


  return (
    <BranchLayout>
      <PageHeader title="لوحة الفرع" />
      <h2 className="text-2xl font-extrabold mb-4 mt-1">نظرة عامة على نشاط اليوم</h2>

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
        <div className="card-elevated p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-base font-bold text-foreground">مبيعات اليوم</span>
            <DollarSign className="w-6 h-6 text-success" />
          </div>
          <div className="text-3xl font-extrabold">{formatEGP(salesToday)}</div>
          <div className="text-sm mt-2 flex items-center gap-1 font-semibold">
            {todayVsYesterday >= 0 ? <TrendingUp className="w-4 h-4 text-success" /> : <TrendingDown className="w-4 h-4 text-destructive" />}
            <span className={todayVsYesterday >= 0 ? "text-success" : "text-destructive"}>
              {todayVsYesterday >= 0 ? "+" : ""}{todayVsYesterday.toFixed(1)}%
            </span>
            <span className="text-muted-foreground">vs أمس</span>
          </div>
        </div>

        <div className="card-elevated p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-base font-bold text-foreground">مبيعات الشهر</span>
            <ShoppingBag className="w-6 h-6 text-primary" />
          </div>
          <div className="text-3xl font-extrabold">{formatEGP(salesMonth)}</div>
          <div className="text-sm mt-2 flex items-center gap-1 font-semibold">
            {monthVsLast >= 0 ? <TrendingUp className="w-4 h-4 text-success" /> : <TrendingDown className="w-4 h-4 text-destructive" />}
            <span className={monthVsLast >= 0 ? "text-success" : "text-destructive"}>
              {monthVsLast >= 0 ? "+" : ""}{monthVsLast.toFixed(1)}%
            </span>
            <span className="text-muted-foreground">vs الشهر السابق</span>
          </div>
        </div>

        <div className="card-elevated p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-base font-bold text-foreground">صافي الربح اليوم</span>
            <TrendingUp className="w-6 h-6 text-success" />
          </div>
          <div className={"text-3xl font-extrabold " + (profitToday >= 0 ? "text-success" : "text-destructive")}>
            {formatEGP(profitToday)}
          </div>
          <div className="text-sm mt-2 font-semibold text-muted-foreground">
            هامش: {salesToday > 0 ? ((profitToday / salesToday) * 100).toFixed(1) : 0}%
          </div>
        </div>

        <div className="card-elevated p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-base font-bold text-foreground">رصيد الخزنة</span>
            <Wallet className="w-6 h-6 text-primary" />
          </div>
          <div className="text-3xl font-extrabold">{formatEGP(treasury)}</div>
          <div className="text-sm mt-2 font-semibold text-muted-foreground">
            {newCust} عميل جديد اليوم
          </div>
        </div>
      </div>


      {monthlyTarget > 0 && (() => {
        const achieved = Math.max(0, profitMonth);
        const pct = Math.min(100, (achieved / monthlyTarget) * 100);
        const remaining = Math.max(0, monthlyTarget - achieved);
        const onTrack = pct >= 80;
        return (
          <div className="card-elevated p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className={`w-5 h-5 ${onTrack ? "text-success" : "text-warning"}`} />
                <h3 className="font-bold">هدف الشهر (صافي الربح)</h3>
              </div>
              <div className="text-sm text-muted-foreground">
                {formatEGP(profitMonth)} <span className="mx-1">/</span> <b>{formatEGP(monthlyTarget)}</b>
              </div>
            </div>
            <Progress value={pct} className="h-3" />
            <div className="flex items-center justify-between mt-3 text-sm">
              <span className={onTrack ? "text-success font-bold" : "text-warning font-bold"}>
                {pct.toFixed(1)}% من الهدف
              </span>
              <span className="font-bold text-foreground">
                {remaining > 0 ? `متبقي ${formatEGP(remaining)} صافي ربح لتحقيق الهدف` : "🎉 تم تحقيق الهدف!"}
              </span>
            </div>

          </div>
        );
      })()}


      {/* Charts row */}
      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        <div className="card-elevated p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-base">المبيعات آخر 30 يوم</h3>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-primary" /><span className="text-muted-foreground font-semibold">إجمالي يومي</span></div>
              {salesByDay.length > 0 && (
                <div className="text-muted-foreground">
                  متوسط: <b className="text-foreground">{formatEGP(salesByDay.reduce((s, d) => s + Number(d.total || 0), 0) / salesByDay.length)}</b>
                </div>
              )}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={salesByDay} margin={{ top: 10, right: 16, bottom: 6, left: 8 }}>
              <defs>
                <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.55} />
                  <stop offset="60%" stopColor="hsl(var(--primary))" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="displayDate"
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))", fontWeight: 600 }}
                tickMargin={10}
                axisLine={{ stroke: "hsl(var(--border))" }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))", fontWeight: 600 }}
                tickMargin={10}
                axisLine={false}
                tickLine={false}
                width={56}
                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
              />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}
                labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 700, marginBottom: 4 }}
                formatter={(v: any) => [formatEGP(Number(v)), "إجمالي المبيعات"]}
                labelFormatter={(label: string) => `📅 ${label}`}
                cursor={{ stroke: "hsl(var(--primary))", strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              <Area
                type="monotone"
                dataKey="total"
                stroke="hsl(var(--primary))"
                fill="url(#grad1)"
                strokeWidth={2.75}
                activeDot={{ r: 6, strokeWidth: 2, stroke: "hsl(var(--card))" }}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card-elevated p-4">
          <h3 className="font-bold mb-3">طرق الدفع اليوم</h3>
          {paymentBreakdown.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">لا توجد مبيعات اليوم</div>
          ) : (
            <ShareBreakdown
              items={paymentBreakdown.map((p: any) => ({ name: p.name, value: Number(p.value) }))}
              format={(v) => formatEGP(v)}
            />

          )}
        </div>
      </div>

      {/* Top products & customers */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="card-elevated p-4">
          <h3 className="font-bold mb-4 flex items-center gap-2"><Package className="w-4 h-4 text-primary" /> أكثر المنتجات مبيعاً اليوم</h3>
          {topProducts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">لا توجد بيانات</div>
          ) : (
            <div className="space-y-3">
              {(() => {
                const max = Math.max(...topProducts.map((p: any) => Number(p.revenue) || 0), 1);
                const medals = ["bg-warning/15 text-warning border-warning/40", "bg-muted text-foreground border-border", "bg-orange-500/15 text-orange-600 border-orange-500/40"];
                return topProducts.map((p: any, i: number) => {
                  const pct = (Number(p.revenue) / max) * 100;
                  const medal = medals[i] ?? "bg-primary/10 text-primary border-primary/30";
                  return (
                    <div key={p.name + i} className="group">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-7 h-7 rounded-full border font-extrabold text-xs flex items-center justify-center shrink-0 ${medal}`}>{i + 1}</div>
                          <span className="font-semibold text-sm truncate" title={p.name}>{p.name}</span>
                        </div>
                        <span className="font-extrabold text-sm tabular-nums text-success shrink-0" dir="ltr">{formatEGP(Number(p.revenue))}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-l from-primary to-primary/60 transition-all group-hover:from-primary group-hover:to-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>

        <div className="card-elevated p-4">
          <h3 className="font-bold mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4 text-primary" /> أكثر العملاء شراءً (30 يوم)</h3>
          {topCustomers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">لا توجد بيانات</div>
          ) : (
            <div className="space-y-2">
              {topCustomers.map((c, i) => (
                <div
                  key={c.id ?? c.name}
                  onClick={() => c.id && nav(`/branch/${id}/contacts/${c.id}`)}
                  className={`flex items-center justify-between p-2 rounded transition-colors ${c.id ? "cursor-pointer hover:bg-surface-2" : "opacity-70"}`}
                  role={c.id ? "button" : undefined}
                  title={c.id ? "عرض تفاصيل العميل" : undefined}
                >
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
          <h3 className="font-bold mb-3 text-lg">آخر الحركات</h3>
          <DataTable rows={recent} empty="لا توجد حركات" onRowClick={(r: RecentDoc) => nav(r.path)} columns={[
            { key: "kind", header: "النوع", render: (r: RecentDoc) => <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${RECENT_DOC_KIND_CLASS[r.kind]}`}>{r.kindLabel}</span> },
            { key: "number", header: "رقم", render: (r: RecentDoc) => <span className="font-mono text-primary">{r.number}</span> },
            { key: "party", header: "الطرف", render: (r: RecentDoc) => r.party },
            { key: "amount", header: "المبلغ", render: (r: RecentDoc) => formatEGP(r.amount) },
            { key: "created_at", header: "الوقت", render: (r: RecentDoc) => formatDateTime(r.created_at) },
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
