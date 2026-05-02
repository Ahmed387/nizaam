import { useEffect, useState, useMemo } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { exportToExcel, printReport } from "@/lib/export";
import {
  FileSpreadsheet, Printer, ShoppingCart, TrendingUp, TrendingDown,
  Wallet, Store, Users, Truck, Package, RotateCcw, Building2,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from "recharts";

const CHART_COLORS = ["hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--destructive))", "hsl(var(--accent))", "#8b5cf6", "#06b6d4"];
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

type Branch = { id: string; name: string; code: string };

export default function AdminReports() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [treasury, setTreasury] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    const fromIso = new Date(from).toISOString();
    const toIso = new Date(to + "T23:59:59").toISOString();
    const [b, inv, exp, pr, sup, sh, sp, emp, tr, ret, cu] = await Promise.all([
      supabase.from("branches").select("id,name,code").eq("is_active", true),
      supabase.from("invoices").select("*, invoice_items(*)").gte("created_at", fromIso).lte("created_at", toIso),
      supabase.from("expenses").select("*").gte("date", from).lte("date", to),
      supabase.from("products").select("*"),
      supabase.from("suppliers").select("*"),
      supabase.from("shipments").select("*").gte("arrival_date", from).lte("arrival_date", to),
      supabase.from("supplier_payments").select("*").gte("paid_at", fromIso).lte("paid_at", toIso),
      supabase.from("employees").select("*").eq("is_active", true),
      supabase.from("treasury").select("*").gte("created_at", fromIso).lte("created_at", toIso),
      supabase.from("returns").select("*").gte("created_at", fromIso).lte("created_at", toIso),
      supabase.from("customers").select("id,branch_id"),
    ]);
    setBranches(b.data ?? []);
    setInvoices(inv.data ?? []);
    setExpenses(exp.data ?? []);
    setProducts(pr.data ?? []);
    setSuppliers(sup.data ?? []);
    setShipments(sh.data ?? []);
    setSupplierPayments(sp.data ?? []);
    setEmployees(emp.data ?? []);
    setTreasury(tr.data ?? []);
    setReturns(ret.data ?? []);
    setCustomers(cu.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const activeInv = invoices.filter((i) => i.status === "active");

  // ============ Per-branch breakdown ============
  const perBranch = useMemo(() => branches.map((b) => {
    const bInv = activeInv.filter((i) => i.branch_id === b.id);
    const sales = bInv.reduce((s, i) => s + Number(i.total), 0);
    const cost = bInv.reduce((s, i) => s + i.invoice_items.reduce((x: number, it: any) => x + Number(it.cost_price) * it.quantity, 0), 0);
    const exp = expenses.filter((e) => e.branch_id === b.id).reduce((s, e) => s + Number(e.amount), 0);
    const bProducts = products.filter((p) => p.branch_id === b.id);
    const inventoryValue = bProducts.reduce((s, p) => s + Number(p.cost_price) * p.quantity, 0);
    const inventoryQty = bProducts.reduce((s, p) => s + p.quantity, 0);
    const lowStock = bProducts.filter((p) => p.quantity <= p.low_stock_alert).length;
    const bShipments = shipments.filter((s) => s.branch_id === b.id);
    const shipmentsCost = bShipments.reduce((s, x) => s + Number(x.total_cost), 0);
    const bSupPay = supplierPayments.filter((s) => s.branch_id === b.id).reduce((s, x) => s + Number(x.amount), 0);
    const bEmployees = employees.filter((e) => e.branch_id === b.id);
    const cashIn = treasury.filter((t) => t.branch_id === b.id && t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
    const cashOut = treasury.filter((t) => t.branch_id === b.id && t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
    const treasuryBalance = cashIn - cashOut;
    const bReturns = returns.filter((r) => r.branch_id === b.id);
    const returnsTotal = bReturns.reduce((s, r) => s + Number(r.total_refund), 0);
    const bCustomers = customers.filter((c) => c.branch_id === b.id).length;
    return {
      ...b,
      invoices: bInv.length, sales, cost,
      profit: sales - cost,
      expenses: exp,
      net: sales - cost - exp,
      inventoryValue, inventoryQty, lowStock,
      shipments: bShipments.length, shipmentsCost,
      supplierPayments: bSupPay,
      employeesCount: bEmployees.length,
      cashIn, cashOut, treasuryBalance,
      returnsCount: bReturns.length, returnsTotal,
      customersCount: bCustomers,
    };
  }), [branches, activeInv, expenses, products, shipments, supplierPayments, employees, treasury, returns, customers]);

  // ============ Global totals ============
  const totals = useMemo(() => {
    const sales = perBranch.reduce((s, b) => s + b.sales, 0);
    const cost = perBranch.reduce((s, b) => s + b.cost, 0);
    const exp = perBranch.reduce((s, b) => s + b.expenses, 0);
    const inventoryValue = perBranch.reduce((s, b) => s + b.inventoryValue, 0);
    const inventoryQty = perBranch.reduce((s, b) => s + b.inventoryQty, 0);
    const supplierDebt = suppliers.reduce((s, x) => s + Number(x.balance ?? 0), 0);
    const shipmentsCost = perBranch.reduce((s, b) => s + b.shipmentsCost, 0);
    const supPaid = perBranch.reduce((s, b) => s + b.supplierPayments, 0);
    const cashIn = perBranch.reduce((s, b) => s + b.cashIn, 0);
    const cashOut = perBranch.reduce((s, b) => s + b.cashOut, 0);
    const returnsTotal = perBranch.reduce((s, b) => s + b.returnsTotal, 0);
    return {
      sales, cost, profit: sales - cost, exp, net: sales - cost - exp,
      inventoryValue, inventoryQty, supplierDebt, shipmentsCost, supPaid,
      cashIn, cashOut, treasuryBalance: cashIn - cashOut, returnsTotal,
    };
  }, [perBranch, suppliers]);

  // Top products globally
  const topProducts = useMemo(() => {
    const m: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const inv of activeInv) for (const it of inv.invoice_items) {
      const k = it.product_name;
      if (!m[k]) m[k] = { name: k, qty: 0, revenue: 0 };
      m[k].qty += it.quantity;
      m[k].revenue += Number(it.total);
    }
    return Object.values(m).sort((a, b) => b.revenue - a.revenue).slice(0, 15);
  }, [activeInv]);

  // Top suppliers by balance
  const topSuppliers = useMemo(() =>
    [...suppliers].sort((a, b) => Number(b.balance ?? 0) - Number(a.balance ?? 0)).slice(0, 10)
  , [suppliers]);

  // ============ Export ============
  const exportXlsx = () => {
    exportToExcel(`تقرير-شامل-${from}-${to}`, [
      { name: "ملخص_عام", rows: [
        { البند: "إجمالي المبيعات", القيمة: totals.sales },
        { البند: "إجمالي التكلفة", القيمة: totals.cost },
        { البند: "إجمالي الربح", القيمة: totals.profit },
        { البند: "المصروفات", القيمة: totals.exp },
        { البند: "صافي الربح", القيمة: totals.net },
        { البند: "قيمة المخزون", القيمة: totals.inventoryValue },
        { البند: "عدد قطع المخزون", القيمة: totals.inventoryQty },
        { البند: "مديونية الموردين", القيمة: totals.supplierDebt },
        { البند: "تكلفة الشحنات", القيمة: totals.shipmentsCost },
        { البند: "مدفوع للموردين", القيمة: totals.supPaid },
        { البند: "وارد للخزنة", القيمة: totals.cashIn },
        { البند: "صادر من الخزنة", القيمة: totals.cashOut },
        { البند: "رصيد الخزنة", القيمة: totals.treasuryBalance },
        { البند: "إجمالي المرتجعات", القيمة: totals.returnsTotal },
        { البند: "عدد الموظفين", القيمة: employees.length },
        { البند: "عدد الموردين", القيمة: suppliers.length },
        { البند: "عدد العملاء", القيمة: customers.length },
        { البند: "عدد الفروع", القيمة: branches.length },
      ]},
      { name: "أداء_الفروع", rows: perBranch.map((b) => ({
        الفرع: b.name, الكود: b.code, الفواتير: b.invoices,
        المبيعات: b.sales, التكلفة: b.cost, الربح: b.profit,
        المصروفات: b.expenses, الصافي: b.net,
        قيمة_المخزون: b.inventoryValue, قطع_المخزون: b.inventoryQty, مخزون_منخفض: b.lowStock,
        الشحنات: b.shipments, تكلفة_الشحنات: b.shipmentsCost,
        مدفوع_للموردين: b.supplierPayments,
        الموظفين: b.employeesCount, العملاء: b.customersCount,
        وارد_الخزنة: b.cashIn, صادر_الخزنة: b.cashOut, رصيد_الخزنة: b.treasuryBalance,
        المرتجعات: b.returnsCount, قيمة_المرتجعات: b.returnsTotal,
      })) },
      { name: "أكثر_المنتجات_مبيعاً", rows: topProducts.map((p) => ({ المنتج: p.name, الكمية: p.qty, الإيراد: p.revenue })) },
      { name: "الموردين", rows: suppliers.map((s) => ({ الشركة: s.company_name, جهة_الاتصال: s.contact_name, الهاتف: s.phone, الرصيد_المستحق: s.balance })) },
      { name: "الموظفين", rows: employees.map((e) => ({
        الاسم: e.name, الوظيفة: e.job_title, الفرع: branches.find((b) => b.id === e.branch_id)?.name ?? "—",
        الراتب: e.base_salary, الهاتف: e.phone, تاريخ_التعيين: e.hire_date,
      })) },
    ]);
  };

  const printSummary = () => {
    const html = `
      <div class="kpi">
        <div>المبيعات<b class="pos">${formatEGP(totals.sales)}</b></div>
        <div>إجمالي الربح<b class="pos">${formatEGP(totals.profit)}</b></div>
        <div>المصروفات<b class="neg">${formatEGP(totals.exp)}</b></div>
        <div>صافي الربح<b class="${totals.net >= 0 ? "pos" : "neg"}">${formatEGP(totals.net)}</b></div>
        <div>قيمة المخزون<b>${formatEGP(totals.inventoryValue)}</b></div>
        <div>مديونية الموردين<b class="neg">${formatEGP(totals.supplierDebt)}</b></div>
        <div>رصيد الخزنة<b class="${totals.treasuryBalance >= 0 ? "pos" : "neg"}">${formatEGP(totals.treasuryBalance)}</b></div>
      </div>

      <h3>أداء الفروع التفصيلي</h3>
      <table><thead><tr>
        <th>الفرع</th><th>الفواتير</th><th>المبيعات</th><th>الربح</th><th>المصروفات</th>
        <th>الصافي</th><th>المخزون</th><th>الخزنة</th><th>الموظفين</th>
      </tr></thead><tbody>
        ${perBranch.map((b) => `<tr>
          <td><b>${b.name}</b><br/><small>${b.code}</small></td>
          <td>${b.invoices}</td>
          <td>${formatEGP(b.sales)}</td>
          <td class="pos">${formatEGP(b.profit)}</td>
          <td class="neg">${formatEGP(b.expenses)}</td>
          <td class="${b.net >= 0 ? "pos" : "neg"}"><b>${formatEGP(b.net)}</b></td>
          <td>${formatEGP(b.inventoryValue)}<br/><small>${b.inventoryQty} قطعة</small></td>
          <td class="${b.treasuryBalance >= 0 ? "pos" : "neg"}">${formatEGP(b.treasuryBalance)}</td>
          <td>${b.employeesCount}</td>
        </tr>`).join("")}
      </tbody></table>

      <h3>أكثر المنتجات مبيعاً</h3>
      <table><thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>الإيراد</th></tr></thead><tbody>
        ${topProducts.map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.qty}</td><td>${formatEGP(p.revenue)}</td></tr>`).join("")}
      </tbody></table>

      <h3>الموردين والمستحقات</h3>
      <table><thead><tr><th>الشركة</th><th>جهة الاتصال</th><th>الهاتف</th><th>الرصيد المستحق</th></tr></thead><tbody>
        ${topSuppliers.map((s) => `<tr><td>${s.company_name}</td><td>${s.contact_name ?? "—"}</td><td>${s.phone ?? "—"}</td><td class="${Number(s.balance) > 0 ? "neg" : "pos"}"><b>${formatEGP(s.balance)}</b></td></tr>`).join("") || "<tr><td colspan='4'>لا يوجد</td></tr>"}
      </tbody></table>
    `;
    printReport(`التقرير الشامل (${from} → ${to})`, html);
  };

  // Branch comparison data
  const branchChartData = perBranch.map((b) => ({ name: b.name, مبيعات: b.sales, ربح: b.profit, مصروفات: b.expenses }));

  return (
    <AdminLayout>
      <PageHeader
        title="التقارير الشاملة"
        subtitle={`تقرير لكل فرع + إجمالي مدمج • ${from} → ${to}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportXlsx} className="gap-2"><FileSpreadsheet className="w-4 h-4" /> Excel</Button>
            <Button onClick={printSummary} className="gap-2"><Printer className="w-4 h-4" /> طباعة / PDF</Button>
          </div>
        }
      />

      <div className="card-elevated p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div><Label>من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1.5" /></div>
        <div><Label>إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1.5" /></div>
        <Button onClick={load} disabled={loading}>تحديث</Button>
        <div className="flex gap-2 mr-auto flex-wrap">
          <Button size="sm" variant="ghost" onClick={() => { setFrom(today()); setTo(today()); }}>اليوم</Button>
          <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(7)); setTo(today()); }}>7 أيام</Button>
          <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(30)); setTo(today()); }}>30 يوم</Button>
          <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(365)); setTo(today()); }}>سنة</Button>
        </div>
      </div>

      {/* Global KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard label="المبيعات" value={formatEGP(totals.sales)} icon={<ShoppingCart className="w-4 h-4" />} hint={`${activeInv.length} فاتورة`} />
        <StatCard label="إجمالي الربح" value={formatEGP(totals.profit)} icon={<TrendingUp className="w-4 h-4" />} accent="success" />
        <StatCard label="المصروفات" value={formatEGP(totals.exp)} icon={<TrendingDown className="w-4 h-4" />} accent="destructive" />
        <StatCard label="صافي الربح" value={formatEGP(totals.net)} icon={<Wallet className="w-4 h-4" />} accent={totals.net >= 0 ? "success" : "destructive"} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="قيمة المخزون" value={formatEGP(totals.inventoryValue)} icon={<Store className="w-4 h-4" />} hint={`${totals.inventoryQty} قطعة`} accent="primary" />
        <StatCard label="مديونية الموردين" value={formatEGP(totals.supplierDebt)} icon={<Truck className="w-4 h-4" />} accent="warning" hint={`${suppliers.length} مورد`} />
        <StatCard label="رصيد الخزنة الكلي" value={formatEGP(totals.treasuryBalance)} icon={<Wallet className="w-4 h-4" />} accent={totals.treasuryBalance >= 0 ? "success" : "destructive"} />
        <StatCard label="الموظفين" value={String(employees.length)} icon={<Users className="w-4 h-4" />} hint={`${branches.length} فرع`} accent="secondary" />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">📊 نظرة عامة</TabsTrigger>
          <TabsTrigger value="branches">🏢 الفروع</TabsTrigger>
          <TabsTrigger value="products">📦 المنتجات</TabsTrigger>
          <TabsTrigger value="suppliers">🚚 الموردين</TabsTrigger>
          <TabsTrigger value="employees">👥 الموظفين</TabsTrigger>
          <TabsTrigger value="treasury">💰 الخزنة</TabsTrigger>
        </TabsList>

        {/* Overview / Charts */}
        <TabsContent value="overview" className="mt-4 space-y-6">
          <div className="card-elevated p-4">
            <h4 className="font-bold mb-3">مقارنة الفروع</h4>
            {branchChartData.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">لا توجد بيانات</div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={branchChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip formatter={(v: any) => formatEGP(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Legend />
                  <Bar dataKey="مبيعات" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="ربح" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="مصروفات" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="card-elevated p-4">
              <h4 className="font-bold mb-3">توزيع المبيعات على الفروع</h4>
              {branchChartData.filter((b) => b.مبيعات > 0).length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">لا توجد مبيعات</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={branchChartData.filter((b) => b.مبيعات > 0)} dataKey="مبيعات" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e: any) => `${e.name}`}>
                      {branchChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => formatEGP(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="card-elevated p-4">
              <h4 className="font-bold mb-3">أكثر 10 منتجات إيراداً</h4>
              {topProducts.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">لا توجد بيانات</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={topProducts.slice(0, 10)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip formatter={(v: any) => formatEGP(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Bar dataKey="revenue" name="الإيراد" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Per branch detailed */}
        <TabsContent value="branches" className="mt-4 space-y-4">
          {perBranch.length === 0 && !loading && (
            <div className="card-elevated p-12 text-center text-muted-foreground">لا توجد فروع</div>
          )}
          {perBranch.map((b) => (
            <div key={b.id} className="card-elevated p-5">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">{b.name}</h3>
                    <div className="text-xs text-muted-foreground">{b.code}</div>
                  </div>
                </div>
                <div className={`text-2xl font-extrabold ${b.net >= 0 ? "text-success" : "text-destructive"}`}>
                  {formatEGP(b.net)}
                  <div className="text-xs font-normal text-muted-foreground text-left">صافي الربح</div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                <Cell2 icon={<ShoppingCart className="w-3.5 h-3.5" />} label="المبيعات" value={formatEGP(b.sales)} hint={`${b.invoices} فاتورة`} />
                <Cell2 icon={<TrendingUp className="w-3.5 h-3.5" />} label="الربح" value={formatEGP(b.profit)} accent="success" />
                <Cell2 icon={<TrendingDown className="w-3.5 h-3.5" />} label="المصروفات" value={formatEGP(b.expenses)} accent="destructive" />
                <Cell2 icon={<Store className="w-3.5 h-3.5" />} label="المخزون" value={formatEGP(b.inventoryValue)} hint={`${b.inventoryQty} قطعة • ${b.lowStock} منخفض`} />
                <Cell2 icon={<Truck className="w-3.5 h-3.5" />} label="الشحنات" value={formatEGP(b.shipmentsCost)} hint={`${b.shipments} شحنة`} />
                <Cell2 icon={<Wallet className="w-3.5 h-3.5" />} label="مدفوع للموردين" value={formatEGP(b.supplierPayments)} accent="warning" />
                <Cell2 icon={<Wallet className="w-3.5 h-3.5" />} label="رصيد الخزنة" value={formatEGP(b.treasuryBalance)} accent={b.treasuryBalance >= 0 ? "success" : "destructive"} hint={`+${formatEGP(b.cashIn)} / -${formatEGP(b.cashOut)}`} />
                <Cell2 icon={<Users className="w-3.5 h-3.5" />} label="الموظفين" value={String(b.employeesCount)} />
                <Cell2 icon={<Users className="w-3.5 h-3.5" />} label="العملاء" value={String(b.customersCount)} />
                <Cell2 icon={<RotateCcw className="w-3.5 h-3.5" />} label="المرتجعات" value={formatEGP(b.returnsTotal)} hint={`${b.returnsCount} مرتجع`} accent="warning" />
                <Cell2 icon={<Package className="w-3.5 h-3.5" />} label="التكلفة" value={formatEGP(b.cost)} />
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="products" className="mt-4">
          <DataTable rows={topProducts} loading={loading} empty="لا توجد مبيعات"
            columns={[
              { key: "name", header: "المنتج", render: (r: any) => <b>{r.name}</b> },
              { key: "qty", header: "الكمية" },
              { key: "revenue", header: "الإيراد", render: (r: any) => <b className="text-primary">{formatEGP(r.revenue)}</b> },
            ]} />
        </TabsContent>

        <TabsContent value="suppliers" className="mt-4">
          <DataTable rows={topSuppliers} loading={loading} empty="لا يوجد موردين"
            columns={[
              { key: "company_name", header: "الشركة", render: (r: any) => <b>{r.company_name}</b> },
              { key: "contact_name", header: "جهة الاتصال", render: (r: any) => r.contact_name ?? "—" },
              { key: "phone", header: "الهاتف", render: (r: any) => r.phone ?? "—" },
              { key: "balance", header: "الرصيد المستحق", render: (r: any) => <b className={Number(r.balance) > 0 ? "text-destructive" : "text-success"}>{formatEGP(r.balance)}</b> },
            ]} />
        </TabsContent>

        <TabsContent value="employees" className="mt-4">
          <DataTable rows={employees.map((e) => ({ ...e, branch_name: branches.find((b) => b.id === e.branch_id)?.name ?? "—" }))} loading={loading} empty="لا يوجد موظفين"
            columns={[
              { key: "name", header: "الاسم", render: (r: any) => <b>{r.name}</b> },
              { key: "job_title", header: "الوظيفة" },
              { key: "branch_name", header: "الفرع" },
              { key: "base_salary", header: "الراتب", render: (r: any) => formatEGP(r.base_salary) },
              { key: "phone", header: "الهاتف", render: (r: any) => r.phone ?? "—" },
            ]} />
        </TabsContent>

        <TabsContent value="treasury" className="mt-4">
          <DataTable rows={perBranch} loading={loading} empty="لا توجد بيانات"
            columns={[
              { key: "name", header: "الفرع", render: (r: any) => <b>{r.name}</b> },
              { key: "cashIn", header: "وارد", render: (r: any) => <span className="text-success">{formatEGP(r.cashIn)}</span> },
              { key: "cashOut", header: "صادر", render: (r: any) => <span className="text-destructive">{formatEGP(r.cashOut)}</span> },
              { key: "treasuryBalance", header: "الرصيد", render: (r: any) => <b className={r.treasuryBalance >= 0 ? "text-success" : "text-destructive"}>{formatEGP(r.treasuryBalance)}</b> },
              { key: "supplierPayments", header: "مدفوع للموردين", render: (r: any) => <span className="text-warning">{formatEGP(r.supplierPayments)}</span> },
            ]} />
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}

function Cell2({ icon, label, value, hint, accent }: { icon: React.ReactNode; label: string; value: string; hint?: string; accent?: "success" | "destructive" | "warning" }) {
  const colorMap = {
    success: "text-success",
    destructive: "text-destructive",
    warning: "text-warning",
  };
  return (
    <div className="bg-surface-2 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}<span>{label}</span>
      </div>
      <div className={`font-bold ${accent ? colorMap[accent] : ""}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
