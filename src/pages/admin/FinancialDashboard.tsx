import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { BranchFinancialDistribution, FinancialBranchFilter } from "@/components/FinancialBranchScope";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { ALL_FINANCIAL_BRANCHES, useAdminFinancialBranchMetrics } from "@/hooks/useAdminFinancialBranchMetrics";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { formatEGP, formatDate } from "@/lib/format";
import { invoiceProfit } from "@/lib/profitEngine";
import { addDaysDay, cairoTodayDay } from "@/lib/cairoDate";
import {
  Wallet, HandCoins, TrendingDown, TrendingUp, AlertTriangle, Calendar,
  ArrowDownCircle, ArrowUpCircle, BarChart3,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

export default function FinancialDashboard() {
  const [loading, setLoading] = useState(true);
  const [branchFilter, setBranchFilter] = useState(ALL_FINANCIAL_BRANCHES);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [overdue, setOverdue] = useState<any[]>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<any[]>([]);
  
  const [cashIn30, setCashIn30] = useState(0);
  const [cashOut30, setCashOut30] = useState(0);
  const metrics = useAdminFinancialBranchMetrics();
  const selectedSnapshot = metrics.distribution.find((row) => row.id === branchFilter);
  const treasuryBalance = branchFilter === ALL_FINANCIAL_BRANCHES ? metrics.totalCash : selectedSnapshot?.cash ?? 0;
  const receivables = branchFilter === ALL_FINANCIAL_BRANCHES ? metrics.companyReceivables : selectedSnapshot?.receivables ?? 0;
  const payables = branchFilter === ALL_FINANCIAL_BRANCHES ? metrics.companyPayables : selectedSnapshot?.payables ?? 0;

  const load = useCallback(async () => {
    if (metrics.loading) return;
    setLoading(true);
    const today = cairoTodayDay();
    const last30 = addDaysDay(today, -30);
    const next30 = addDaysDay(today, 30);
    const last180 = addDaysDay(today, -180);
    const visibleBranchIds = metrics.branches.map((branch) => branch.id);
    const inScope = (branchId: string) => branchFilter === ALL_FINANCIAL_BRANCHES ? visibleBranchIds.includes(branchId) : branchId === branchFilter;

    const [vRange, instUp, instOv, inv90] = await Promise.all([
      fetchAllRows<any>(() => {
        let query = supabase.from("vouchers").select("id, branch_id, type, amount, voucher_date").eq("status", "active").gte("voucher_date", last30);
        if (branchFilter !== ALL_FINANCIAL_BRANCHES) query = query.eq("branch_id", branchFilter);
        else if (visibleBranchIds.length) query = query.in("branch_id", visibleBranchIds);
        return query.order("id");
      }).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase
        .from("payment_installments")
        .select("id, due_date, amount, paid_amount, status, payment_plans!inner(entity_name, branch_id)")
        .in("status", ["pending", "partial"])
        .gte("due_date", today)
        .lte("due_date", next30)
        .order("due_date", { ascending: true })
        .order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase
        .from("payment_installments")
        .select("id, due_date, amount, paid_amount, status, payment_plans!inner(entity_name, branch_id)")
        .or("status.eq.overdue,and(status.eq.pending,due_date.lt." + today + ")")
        .order("due_date", { ascending: true })
        .order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase
        .from("invoices")
        .select("id, branch_id, invoice_date, is_migrated, discount_amount, invoice_items(quantity, returned_quantity, net_quantity, total, selling_price, line_discount, unit_cost_at_sale, cost_price)")
        .eq("status", "active")
        .gte("invoice_date", last180)
        .in("branch_id", branchFilter === ALL_FINANCIAL_BRANCHES ? visibleBranchIds : [branchFilter])
        .order("id")).then((data) => ({ data })),
    ]);

    setUpcoming((instUp.data ?? []).filter((row: any) => inScope(row.payment_plans?.branch_id)));
    setOverdue((instOv.data ?? []).filter((row: any) => inScope(row.payment_plans?.branch_id)));

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
      const k = i.invoice_date.slice(0, 7);
      if (!months[k]) months[k] = { month: k, sales: 0, profit: 0 };
      // مصدر موحّد: profitEngine (صافي المرتجعات + خصم الفاتورة + بدون ضريبة)
      const ip = invoiceProfit(i);
      months[k].sales += ip.revenue;
      months[k].profit += ip.profit;
    }
    setMonthlyTrend(Object.values(months).sort((a, b) => a.month.localeCompare(b.month)));

    // Top profit products moved to Reports → Profitability tab (single source of truth).

    setLoading(false);
  }, [branchFilter, metrics.branches, metrics.loading]);

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
            <Link to="/admin/reports-hub?tab=comparison"><BarChart3 className="w-4 h-4" /> مقارنة الفترات</Link>
          </Button>
        }
      />

      <div className="mb-6">
        <FinancialBranchFilter value={branchFilter} onChange={setBranchFilter} branches={metrics.branches} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="رصيد النقدية" value={formatEGP(treasuryBalance)} icon={<Wallet className="w-5 h-5" />} accent="primary" />
        <StatCard label="مستحق على العملاء" value={formatEGP(receivables)} icon={<HandCoins className="w-5 h-5" />} accent="success" />
        <StatCard label="مستحق للموردين" value={formatEGP(payables)} icon={<TrendingDown className="w-5 h-5" />} accent="destructive" />
        <StatCard label="أقساط متأخرة" value={overdue.length} icon={<AlertTriangle className="w-5 h-5" />} accent="warning" />
      </div>

      {branchFilter === ALL_FINANCIAL_BRANCHES && (
        <div className="mb-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <StatCard label="مقدمات عملاء عندنا (2150)" value={formatEGP(metrics.customerAdvances)} icon={<Wallet className="w-5 h-5" />} accent="primary" />
            <StatCard label="مقدمات لينا عند الموردين (1460)" value={formatEGP(metrics.supplierAdvances)} icon={<Wallet className="w-5 h-5" />} accent="secondary" />
          </div>
          <BranchFinancialDistribution rows={metrics.distribution} loading={metrics.loading} />
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="وارد (30 يوم)" value={formatEGP(cashIn30)} icon={<ArrowDownCircle className="w-5 h-5" />} accent="success" />
        <StatCard label="صادر (30 يوم)" value={formatEGP(cashOut30)} icon={<ArrowUpCircle className="w-5 h-5" />} accent="destructive" />
        <StatCard label="صافي التدفق" value={formatEGP(cashIn30 - cashOut30)} icon={<TrendingUp className="w-5 h-5" />} accent={cashIn30 - cashOut30 >= 0 ? "success" : "destructive"} />
        <StatCard label="أقساط قادمة (30 يوم)" value={upcoming.length} icon={<Calendar className="w-5 h-5" />} accent="primary" />
      </div>

      <div className="card-elevated p-4 mb-6">
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
        <div className="text-xs text-muted-foreground mt-3 text-end">
          أكثر المنتجات ربحاً ومقارنة الفروع متاحة في{" "}
          <Link to="/admin/reports" className="text-primary font-bold hover:underline">التقارير التفصيلية ←</Link>
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
