import { useCanViewNetProfit, NET_PROFIT_MASK } from "@/lib/netProfitAccess";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { ReportIntro } from "@/components/ReportIntro";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { fetchProfitWindow, rangeFor, rangeForDates, lineProfit } from "@/lib/profitEngine";
import {
  TrendingUp, TrendingDown, Wallet, AlertTriangle, Package,
  ArrowDownCircle, ArrowUpCircle, Loader2, ChevronLeft, Building2,
  Activity,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

/**
 * Owner Cockpit — single-screen executive snapshot for the company owner.
 * Answers seven questions: today vs yesterday, month-to-date, who owes whom,
 * cash position, best/worst branch, 30-day profit trend, decision alerts.
 * All numbers come from profitEngine.ts (single source of truth).
 */
export default function OwnerCockpit({ embedded }: { embedded?: boolean } = {}) {
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(true);

  // Today vs yesterday
  const [todayNet, setTodayNet] = useState(0);
  const [todaySales, setTodaySales] = useState(0);
  const [todayExp, setTodayExp] = useState(0);
  const [yesterdayNet, setYesterdayNet] = useState(0);

  // Month-to-date
  const [mtdNet, setMtdNet] = useState(0);
  const [mtdSales, setMtdSales] = useState(0);
  const [mtdExp, setMtdExp] = useState(0);
  const [prevMonthNet, setPrevMonthNet] = useState(0);

  // Cash + balances
  const [treasuryBalance, setTreasuryBalance] = useState(0);
  const [supplierDebt, setSupplierDebt] = useState(0); // we owe
  const [supplierCredit, setSupplierCredit] = useState(0); // they owe us
  const [customerReceivable, setCustomerReceivable] = useState(0); // customers owe us

  // Branch breakdown
  const [perBranch, setPerBranch] = useState<{ id: string; name: string; net: number; revenue: number }[]>([]);

  // 30-day trend
  const [trend, setTrend] = useState<{ day: string; net: number; sales: number }[]>([]);

  // Alerts
  const [overdueCount, setOverdueCount] = useState(0);
  const [overdueAmount, setOverdueAmount] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [stagnantCount, setStagnantCount] = useState(0);
  const [pendingReservations, setPendingReservations] = useState(0);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const yStr = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    const [tToday, tMonth, treasury, contactsRes, ovr, prods, salesByProd, reservations] =
      await Promise.all([
        fetchProfitWindow({ tenantId, range: rangeForDates(todayStr, todayStr) }),
        fetchProfitWindow({ tenantId, range: rangeForDates(monthStart, todayStr) }),
        // ملاحظة: جدول treasury مفيهوش عمود status، والنوع بيكون income / expense
        supabase.from("treasury" as any).select("type, amount").eq("tenant_id", tenantId),
        // TODO Phase 2.2B: Remove after contacts.balance column is dropped
        supabase.from("v_contact_balances" as any).select("type, total_balance"),
        supabase
          .from("payment_installments")
          .select("amount, paid_amount, payment_plans!inner(entity_type)")
          .eq("status", "overdue"),
        supabase.from("products").select("id, quantity, low_stock_alert").is("archived_at", null),
        supabase
          .from("invoice_items")
          .select("product_id, quantity, returned_quantity, invoices!inner(tenant_id, status, created_at, invoice_date)")
          .eq("invoices.tenant_id", tenantId)
          .eq("invoices.status", "active")
          .gte("invoices.invoice_date", new Date(Date.now() - 30 * 86400000).toISOString()),
        supabase
          .from("pre_orders")
          .select("id")
          .eq("tenant_id", tenantId)
          .in("status", ["pending"]),
      ]);

    // Today
    setTodayNet(tToday.totals.net);
    setTodaySales(tToday.totals.revenue);
    setTodayExp(tToday.totals.expenses);
    setYesterdayNet(tToday.prevNet);

    // Month
    setMtdNet(tMonth.totals.net);
    setMtdSales(tMonth.totals.revenue);
    setMtdExp(tMonth.totals.expenses);
    setPrevMonthNet(tMonth.prevNet);
    setPerBranch(
      tMonth.perBranch
        .map((b) => ({ id: b.id, name: b.name, net: b.net, revenue: b.revenue }))
        .sort((a, b) => b.net - a.net)
    );

    // Treasury
    const tr = (treasury.data ?? []) as any[];
    const cashIn = tr.filter((x) => x.type === "income").reduce((s, x) => s + Number(x.amount || 0), 0);
    const cashOut = tr.filter((x) => x.type === "expense").reduce((s, x) => s + Number(x.amount || 0), 0);
    setTreasuryBalance(cashIn - cashOut);

    // Supplier & customer balances
    const contacts = (contactsRes.data ?? []) as any[];
    let supDebt = 0, supCredit = 0, custRec = 0;
    for (const c of contacts) {
      const bal = Number(c.total_balance ?? c.balance ?? 0);
      if (c.type === "supplier" || c.type === "both") {
        if (bal > 0) supDebt += bal; else supCredit += Math.abs(bal);
      }
      if (c.type === "customer" || c.type === "both") {
        if (bal > 0) custRec += bal;
      }
    }
    setSupplierDebt(supDebt);
    setSupplierCredit(supCredit);
    setCustomerReceivable(custRec);

    // Overdue
    const ovrRows = (ovr.data ?? []) as any[];
    setOverdueCount(ovrRows.length);
    setOverdueAmount(ovrRows.reduce((s, r) => s + (Number(r.amount) - Number(r.paid_amount || 0)), 0));

    // Stock + stagnant
    const prodRows = (prods.data ?? []) as any[];
    const low = prodRows.filter((p) => Number(p.low_stock_alert || 0) > 0 && Number(p.quantity || 0) <= Number(p.low_stock_alert)).length;
    setLowStockCount(low);

    const soldIds = new Set<string>();
    for (const it of (salesByProd.data ?? []) as any[]) {
      const net = Number(it.quantity || 0) - Number(it.returned_quantity || 0);
      if (net > 0 && it.product_id) soldIds.add(it.product_id);
    }
    const stagnant = prodRows.filter((p) => Number(p.quantity || 0) > 0 && !soldIds.has(p.id)).length;
    setStagnantCount(stagnant);

    setPendingReservations((reservations.data ?? []).length);

    // 30-day trend — one fetch then bucket by day
    const trendFrom = new Date(now.getTime() - 29 * 86400000);
    trendFrom.setHours(0, 0, 0, 0);
    const [invTrend, expTrend] = await Promise.all([
      supabase
        .from("invoices")
        .select("created_at, invoice_date, is_migrated, invoice_items(quantity, returned_quantity, net_quantity, total, selling_price, line_discount, unit_cost_at_sale, cost_price)")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .gte("invoice_date", trendFrom.toISOString()),
      supabase
        .from("vouchers")
        .select("voucher_date, amount, voucher_categories!inner(is_deductible_from_profit)")
        .eq("tenant_id", tenantId)
        .eq("type", "payment")
        .eq("status", "active")
        .eq("voucher_categories.is_deductible_from_profit", true)
        .gte("voucher_date", trendFrom.toISOString().slice(0, 10)),

    ]);

    const byDay: Record<string, { revenue: number; cost: number; expenses: number }> = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(trendFrom.getTime() + i * 86400000).toISOString().slice(0, 10);
      byDay[d] = { revenue: 0, cost: 0, expenses: 0 };
    }
    for (const inv of (invTrend.data ?? []) as any[]) {
      const d = String(inv.invoice_date ?? inv.created_at).slice(0, 10);
      if (!byDay[d]) continue;
      for (const it of inv.invoice_items ?? []) {
        const lp = lineProfit(it, { invoiceIsMigrated: !!inv.is_migrated });
        byDay[d].revenue += lp.revenue;
        byDay[d].cost += lp.cost;
      }
    }
    for (const v of (expTrend.data ?? []) as any[]) {
      const d = String(v.voucher_date).slice(0, 10);
      if (!byDay[d]) continue;
      byDay[d].expenses += Number(v.amount || 0);
    }
    setTrend(
      Object.entries(byDay).map(([day, x]) => ({
        day: day.slice(5),
        sales: Math.round(x.revenue),
        net: Math.round(x.revenue - x.cost - x.expenses),
      }))
    );

    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);
  useRealtimeRefresh(
    ["invoices", "invoice_items", "vouchers", "contacts", "treasury", "products", "payment_installments", "pre_orders"],
    load
  );

  const todayDelta = useMemo(() => {
    if (Math.abs(yesterdayNet) < 0.01) return null;
    return ((todayNet - yesterdayNet) / Math.abs(yesterdayNet)) * 100;
  }, [todayNet, yesterdayNet]);
  const monthDelta = useMemo(() => {
    if (Math.abs(prevMonthNet) < 0.01) return null;
    return ((mtdNet - prevMonthNet) / Math.abs(prevMonthNet)) * 100;
  }, [mtdNet, prevMonthNet]);

  const bestBranch = perBranch[0];
  const worstBranch = perBranch.length > 1 ? perBranch[perBranch.length - 1] : null;

  const loadingView = (
    <div className={embedded ? "p-8 flex items-center justify-center" : "p-12 flex items-center justify-center"}>
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  if (loading && trend.length === 0) {
    if (embedded) return loadingView;
    return (
      <AdminLayout>
        <PageHeader title="نظرة المالك" subtitle="👑 لمحة سريعة وشاملة عن شركتك" />
        {loadingView}
      </AdminLayout>
    );
  }

  const content = (
    <div className={embedded ? "space-y-4" : "p-6 space-y-4"}>
      <ReportIntro
        icon="👑"
        title="نظرة المالك — Cockpit"
        purpose="لو معاك دقيقة واحدة بس على شركتك، التبويب ده اللي تشوفه."
        shows={[
          "اليوم vs أمس والشهر vs الشهر اللي فات (مبيعات + ربح)",
          "السيولة الحالية: خزنة، علينا للموردين، لنا عند العملاء",
          "منحنى المبيعات والربح آخر 30 يوم + ترتيب الفروع",
          "تنبيهات قرار: متأخرات، مخزون منخفض، حجوزات معلقة",
        ]}
        unique="لمحة سريعة وشاملة عن شركتك في صفحة واحدة، مع إمكانية التفصيل لأي تبويب."
        accent="success"
      />
      {/* Header — live status */}
      <div className="relative flex flex-col items-center text-center gap-3 py-4">
        <div className="absolute top-3 left-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            {loading ? "جاري التحديث..." : "مباشر"}
          </div>
        </div>
        <h2 className="text-2xl md:text-3xl font-extrabold flex items-center justify-center gap-2.5 text-foreground">
          <Activity className="w-7 h-7 text-primary" />
          <span>نظرة المالك — لمحة شاملة عن شركتك</span>
        </h2>
        <p className="text-sm md:text-base font-medium text-foreground/80 max-w-2xl">
          كل الأرقام تأتي من نفس مصدر حساب الربح الموحد — تتحدث تلقائياً
        </p>
      </div>

      {/* ===== ROW 1 — Today + Month-to-date (the headline) ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HeroCard
          title="اليوم"
          subtitle="مقارنة بأمس"
          net={todayNet}
          sales={todaySales}
          expenses={todayExp}
          delta={todayDelta}
          gradient="from-primary/15 via-primary/5 to-transparent"
        />
        <HeroCard
          title="الشهر حتى الآن"
          subtitle="مقارنة بنفس المدة من الشهر الماضي"
          net={mtdNet}
          sales={mtdSales}
          expenses={mtdExp}
          delta={monthDelta}
          gradient="from-success/15 via-success/5 to-transparent"
        />
      </div>

      {/* ===== ROW 2 — Cash position ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CashCard
          label="رصيد الخزنة"
          value={treasuryBalance}
          icon={<Wallet className="w-4 h-4" />}
          accent={treasuryBalance >= 0 ? "success" : "destructive"}
          link="/admin/finance"
        />
        <CashCard
          label="علينا للموردين"
          value={supplierDebt}
          icon={<ArrowUpCircle className="w-4 h-4" />}
          accent="destructive"
          link="/admin/reports-hub?tab=insights"
          hint="ديون مستحقة"
        />
        <CashCard
          label="لنا عند الموردين"
          value={supplierCredit}
          icon={<ArrowDownCircle className="w-4 h-4" />}
          accent="success"
          link="/admin/reports-hub?tab=insights"
          hint="رصيد دائن لنا"
        />
        <CashCard
          label="لنا عند العملاء"
          value={customerReceivable}
          icon={<TrendingUp className="w-4 h-4" />}
          accent="warning"
          link="/admin/contacts"
          hint="مستحقات تحصيل"
        />
      </div>

      {/* ===== ROW 3 — 30-day trend ===== */}
      <div className="card-elevated p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-success" />
            منحنى الربح والمبيعات — آخر 30 يوم
          </h3>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.5} />
                <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
            <Tooltip
              formatter={(v: any) => formatEGP(Number(v))}
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
            />
            <Area type="monotone" dataKey="sales" name="المبيعات" stroke="hsl(var(--primary))" fill="url(#salesGrad)" strokeWidth={2} />
            <Area type="monotone" dataKey="net" name="صافي الربح" stroke="hsl(var(--success))" fill="url(#netGrad)" strokeWidth={2.5} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ===== ROW 4 — Branch leaders ===== */}
      {perBranch.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {bestBranch && (
            <BranchCard
              title="🏆 أفضل فرع هذا الشهر"
              branch={bestBranch}
              positive
            />
          )}
          {worstBranch && worstBranch.id !== bestBranch?.id && (
            <BranchCard
              title="⚠️ فرع يحتاج انتباه"
              branch={worstBranch}
              positive={false}
            />
          )}
        </div>
      )}

      {/* All branches mini-list */}
      {perBranch.length > 0 && (
        <div className="card-elevated p-4">
          <h4 className="font-bold mb-3 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />
            ترتيب الفروع حسب صافي الربح (الشهر)
          </h4>
          <div className="space-y-2">
            {perBranch.map((b, i) => {
              const max = Math.max(...perBranch.map((x) => Math.abs(x.net)), 1);
              const pct = (Math.abs(b.net) / max) * 100;
              const pos = b.net >= 0;
              return (
                <div key={b.id} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-5">#{i + 1}</span>
                  <span className="font-medium text-sm w-32 truncate">{b.name}</span>
                  <div className="flex-1 h-6 bg-surface-2 rounded-md overflow-hidden relative">
                    <div
                      className={`h-full ${pos ? "bg-success/70" : "bg-destructive/70"} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={`font-bold text-sm w-28 text-end ${pos ? "text-success" : "text-destructive"}`}>
                    {formatEGP(b.net)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== ROW 5 — Decision alerts ===== */}
      <div className="card-elevated p-5 border-warning/30">
        <h3 className="font-bold mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-warning" />
          تنبيهات تستدعي قرار
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <AlertTile
            count={overdueCount}
            label="أقساط متأخرة"
            hint={overdueCount > 0 ? formatEGP(overdueAmount) : "✅"}
            severity={overdueCount > 0 ? "high" : "ok"}
            link="/admin/installments"
            icon={<AlertTriangle className="w-4 h-4" />}
          />
          <AlertTile
            count={lowStockCount}
            label="منتجات منخفضة المخزون"
            severity={lowStockCount > 0 ? "med" : "ok"}
            link="/admin/inventory"
            icon={<Package className="w-4 h-4" />}
          />
          <AlertTile
            count={stagnantCount}
            label="منتجات راكدة (30 يوم)"
            severity={stagnantCount > 5 ? "med" : "ok"}
            link="/admin/reports-hub?tab=insights"
            icon={<TrendingDown className="w-4 h-4" />}
          />
          <AlertTile
            count={pendingReservations}
            label="حجوزات تنتظر التنفيذ"
            severity={pendingReservations > 0 ? "info" : "ok"}
            link="/admin/pre-orders"
            icon={<Activity className="w-4 h-4" />}
          />
        </div>
      </div>

      {/* Footer — drill-down links */}
      <div className="card-elevated p-4 bg-gradient-to-l from-primary/5 to-transparent">
        <p className="text-sm font-medium mb-3 text-muted-foreground">للتفاصيل الكاملة:</p>
        <div className="flex flex-wrap gap-2">
          <DrillLink to="/admin/reports-hub?tab=central" label="🏢 العمليات اليومية" />
          <DrillLink to="/admin/reports-hub?tab=profitability" label="📊 ربحية كل فاتورة" />
          <DrillLink to="/admin/reports-hub?tab=insights" label="🎯 Top/Bottom للقرارات" />
          <DrillLink to="/admin/reports-hub?tab=scheduled" label="⏰ تقارير دورية" />
        </div>
      </div>
    </div>
  );

  if (embedded) return content;
  return (
    <AdminLayout>
      <PageHeader title="نظرة المالك" subtitle="👑 لمحة سريعة وشاملة عن شركتك" />
      {content}
    </AdminLayout>
  );
}

/* ========== Sub-components ========== */

function HeroCard({
  title, subtitle, net, sales, expenses, delta, gradient,
}: {
  title: string; subtitle: string; net: number; sales: number; expenses: number;
  delta: number | null; gradient: string;
}) {
  const canViewNetProfit = useCanViewNetProfit();
  const pos = net >= 0;
  return (
    <div className={`card-elevated p-6 bg-gradient-to-br ${gradient} border-2 ${pos ? "border-success/30" : "border-destructive/30"} text-center`}>
      {/* Header */}
      <div className="mb-4">
        <h3 className="font-extrabold text-xl md:text-2xl text-foreground">{title}</h3>
        <p className="text-sm md:text-base font-medium text-muted-foreground mt-1">{subtitle}</p>
      </div>

      {/* Net profit — centered and prominent */}
      <div className="mb-4">
        <div className="text-sm md:text-base font-semibold text-muted-foreground mb-1">صافي الربح</div>
        <div className={`text-4xl md:text-5xl font-black tracking-tight ${!canViewNetProfit ? "text-muted-foreground" : pos ? "text-success" : "text-destructive"}`}>
          {canViewNetProfit ? formatEGP(net) : NET_PROFIT_MASK}
        </div>
        {delta !== null && (
          <div className={`inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-sm font-bold ${delta >= 0 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
            {delta >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {Math.abs(delta).toFixed(1)}%
          </div>
        )}
      </div>

      {/* Sales & Expenses */}
      <div className="grid grid-cols-2 gap-3 pt-4 border-t border-border/50">
        <div className="text-center">
          <div className="text-sm font-semibold text-muted-foreground mb-1">المبيعات</div>
          <div className="font-extrabold text-lg md:text-xl text-foreground">{formatEGP(sales)}</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-muted-foreground mb-1">المصروفات</div>
      <div className="font-extrabold text-lg md:text-xl text-destructive">{formatEGP(expenses)}</div>
        </div>
      </div>
    </div>
  );
}


function CashCard({
  label, value, icon, accent, link, hint,
}: {
  label: string; value: number; icon: React.ReactNode;
  accent: "success" | "destructive" | "warning"; link: string; hint?: string;
}) {
  const c = {
    success: "text-success border-success/30 bg-success/5",
    destructive: "text-destructive border-destructive/30 bg-destructive/5",
    warning: "text-warning border-warning/30 bg-warning/5",
  }[accent];
  return (
    <Link to={link} className={`block rounded-xl p-4 border ${c} hover:scale-[1.02] transition-transform text-center`}>
      <div className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground mb-2">
        {icon}<span className="font-semibold">{label}</span>
      </div>
      <div className={`text-2xl md:text-3xl font-black ${c.split(" ")[0]}`}>{formatEGP(value)}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1 font-medium">{hint}</div>}
    </Link>
  );
}

function BranchCard({ title, branch, positive }: { title: string; branch: { name: string; net: number; revenue: number }; positive: boolean }) {
  return (
    <div className={`card-elevated p-6 border-2 ${positive ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"} text-center`}>
      <h4 className="text-base md:text-lg font-bold mb-3">{title}</h4>
      <div className="text-2xl md:text-3xl font-black mb-2 text-foreground">{branch.name}</div>
      <div className={`text-3xl md:text-4xl font-black ${positive ? "text-success" : "text-destructive"} mb-2`}>
        {formatEGP(branch.net)}
      </div>
      <div className="text-sm text-muted-foreground font-medium">
        من إجمالي مبيعات {formatEGP(branch.revenue)}
      </div>
    </div>
  );
}

function AlertTile({
  count, label, severity, link, icon, hint,
}: {
  count: number; label: string; severity: "high" | "med" | "info" | "ok";
  link: string; icon: React.ReactNode; hint?: string;
}) {
  const c = {
    high: "bg-destructive/10 border-destructive/40 text-destructive",
    med: "bg-warning/10 border-warning/40 text-warning",
    info: "bg-primary/10 border-primary/40 text-primary",
    ok: "bg-success/5 border-success/30 text-success",
  }[severity];
  return (
    <Link to={link} className={`block rounded-lg p-4 border ${c} hover:opacity-90 transition text-center`}>
      <div className="flex items-center justify-center gap-1.5 text-sm mb-2">
        {icon}<span className="font-semibold">{label}</span>
      </div>
      <div className="text-3xl md:text-4xl font-black">{count}</div>
      {hint && <div className="text-xs mt-1 font-medium opacity-90">{hint}</div>}
    </Link>
  );
}


function DrillLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-card border border-border hover:bg-surface-2 hover:border-primary/40 transition"
    >
      {label} <ChevronLeft className="w-3 h-3" />
    </Link>
  );
}
