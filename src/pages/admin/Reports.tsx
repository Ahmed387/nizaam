import { useEffect, useState, useMemo } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { exportToExcel, printReport } from "@/lib/export";
import {
  FileSpreadsheet, Printer, ShoppingCart, TrendingUp, TrendingDown,
  Wallet, Store, Users, Truck, Package, RotateCcw, Building2, AlertTriangle,
  Receipt, ArrowDownCircle, ArrowUpCircle, Layers, ChevronLeft,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell as RCell,
} from "recharts";

const CHART_COLORS = ["hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--destructive))", "hsl(var(--accent))", "#8b5cf6", "#06b6d4"];
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

type Branch = { id: string; name: string; code: string };

export default function AdminReports({ embedded }: { embedded?: boolean } = {}) {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<"global" | string>("global"); // "global" or branch id

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
  const [allShipments, setAllShipments] = useState<any[]>([]);
  const [allSupPayments, setAllSupPayments] = useState<any[]>([]);
  const [payTx, setPayTx] = useState<any[]>([]);
  const [overdueIns, setOverdueIns] = useState<any[]>([]);
  const [payPlans, setPayPlans] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    const fromIso = new Date(from).toISOString();
    const toIso = new Date(to + "T23:59:59").toISOString();
    const [b, inv, exp, pr, sup, sh, sp, emp, tr, ret, cu, ash, asp, ptx, oi, pp] = await Promise.all([
      supabase.from("branches").select("id,name,code").eq("is_active", true),
      supabase.from("invoices").select("*, invoice_items(*)").gte("created_at", fromIso).lte("created_at", toIso),
      supabase.from("vouchers").select("*, voucher_categories(name)").eq("type", "payment").eq("status", "active").gte("voucher_date", from).lte("voucher_date", to),
      supabase.from("products").select("*"),
      supabase.from("contacts").select("*"),
      supabase.from("shipments").select("*").gte("arrival_date", from).lte("arrival_date", to),
      supabase.from("supplier_payments").select("*").gte("paid_at", fromIso).lte("paid_at", toIso),
      supabase.from("employees").select("*").eq("is_active", true),
      supabase.from("vouchers" as any).select("type, amount, branch_id, voucher_date").eq("status", "active").gte("voucher_date", from).lte("voucher_date", to),
      supabase.from("returns").select("*").gte("created_at", fromIso).lte("created_at", toIso),
      supabase.from("contacts").select("id,branch_id"),
      supabase.from("shipments").select("contact_id,total_cost"),
      supabase.from("supplier_payments").select("contact_id,amount"),
      supabase.from("payment_transactions").select("*").gte("created_at", fromIso).lte("created_at", toIso),
      supabase.from("payment_installments").select("*, payment_plans!inner(entity_type,entity_name,branch_id)").eq("status", "overdue"),
      supabase.from("payment_plans").select("*").neq("status", "completed"),
    ]);
    setBranches(b.data ?? []);
    setInvoices(inv.data ?? []);
    setExpenses((exp.data ?? []).map((v: any) => ({
      id: v.id, branch_id: v.branch_id, date: v.voucher_date, amount: v.amount,
      type: v.voucher_categories?.name ?? "أخرى",
      description: v.description ?? v.voucher_number,
    })));
    setProducts(pr.data ?? []);
    setSuppliers(sup.data ?? []);
    setShipments(sh.data ?? []);
    setSupplierPayments(sp.data ?? []);
    setEmployees(emp.data ?? []);
    setTreasury(tr.data ?? []);
    setReturns(ret.data ?? []);
    setCustomers(cu.data ?? []);
    setAllShipments(ash.data ?? []);
    setAllSupPayments(asp.data ?? []);
    setPayTx(ptx.data ?? []);
    setOverdueIns(oi.data ?? []);
    setPayPlans(pp.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useRealtimeRefresh(
    ["invoices", "vouchers", "products", "suppliers", "shipments", "supplier_payments", "employees", "treasury", "returns", "customers", "branches"],
    load
  );

  // Filter helper based on current scope
  const inScope = (branchId: string | null | undefined) =>
    scope === "global" ? true : branchId === scope;

  const activeInv = invoices.filter((i) => i.status === "active" && inScope(i.branch_id));
  const scopedExpenses = expenses.filter((e) => inScope(e.branch_id));
  const scopedProducts = products.filter((p) => inScope(p.branch_id));
  const scopedShipments = shipments.filter((s) => inScope(s.branch_id));
  const scopedSupPayments = supplierPayments.filter((s) => inScope(s.branch_id));
  const scopedEmployees = employees.filter((e) => inScope(e.branch_id));
  const scopedTreasury = treasury.filter((t) => inScope(t.branch_id));
  const scopedReturns = returns.filter((r) => inScope(r.branch_id));
  const scopedCustomers = customers.filter((c) => inScope(c.branch_id));
  const scopedPayTx = payTx.filter((t) => inScope(t.branch_id));
  const scopedOverdue = overdueIns.filter((o: any) => inScope(o.payment_plans?.branch_id));
  const scopedPlans = payPlans.filter((p) => inScope(p.branch_id));

  // ====== Payments / commissions analysis ======
  const commissionAnalysis = useMemo(() => {
    const methods = ["cash", "vodafone", "instapay", "bank"] as const;
    const byMethod = methods.map((m) => {
      const txs = scopedPayTx.filter((t) => t.payment_method === m);
      const volume = txs.reduce((s, t) => s + Number(t.amount), 0);
      const fees = txs.reduce((s, t) => s + Number(t.fee_amount || 0), 0);
      return { method: m, label: m === "cash" ? "نقدي" : m === "vodafone" ? "فودافون كاش" : m === "instapay" ? "انستاباي" : "بنك", count: txs.length, volume, fees };
    });
    const totalFees = byMethod.reduce((s, x) => s + x.fees, 0);
    const totalVolume = byMethod.reduce((s, x) => s + x.volume, 0);
    return { byMethod, totalFees, totalVolume };
  }, [scopedPayTx]);

  // ====== Top overdue customers ======
  const topOverdueCustomers = useMemo(() => {
    const map = new Map<string, { name: string; type: string; branch_id: string; overdueCount: number; overdueAmount: number }>();
    scopedOverdue.forEach((i: any) => {
      const pp = i.payment_plans;
      if (!pp) return;
      const key = `${pp.entity_type}:${pp.entity_name}`;
      const row = map.get(key) ?? { name: pp.entity_name, type: pp.entity_type, branch_id: pp.branch_id, overdueCount: 0, overdueAmount: 0 };
      row.overdueCount += 1;
      row.overdueAmount += Number(i.amount) - Number(i.paid_amount || 0);
      map.set(key, row);
    });
    return Array.from(map.values()).sort((a, b) => b.overdueAmount - a.overdueAmount).slice(0, 20);
  }, [scopedOverdue]);


  // ============ Aggregated KPIs for current scope ============
  const k = useMemo(() => {
    const sales = activeInv.reduce((s, i) => s + Number(i.total), 0);
    const cost = activeInv.reduce((s, i) => s + i.invoice_items.reduce((x: number, it: any) => x + Number(it.cost_price) * it.quantity, 0), 0);
    const exp = scopedExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const inventoryValue = scopedProducts.reduce((s, p) => s + Number(p.cost_price) * p.quantity, 0);
    const inventoryQty = scopedProducts.reduce((s, p) => s + p.quantity, 0);
    const lowStock = scopedProducts.filter((p) => p.quantity <= p.low_stock_alert);
    const shipmentsCost = scopedShipments.reduce((s, x) => s + Number(x.total_cost), 0);
    const supPaid = scopedSupPayments.reduce((s, x) => s + Number(x.amount), 0);
    const cashIn = scopedTreasury.filter((t) => t.type === "receipt").reduce((s, t) => s + Number(t.amount), 0);
    const cashOut = scopedTreasury.filter((t) => t.type === "payment").reduce((s, t) => s + Number(t.amount), 0);
    const returnsTotal = scopedReturns.reduce((s, r) => s + Number(r.total_refund), 0);
    return {
      sales, cost, profit: sales - cost, exp, net: sales - cost - exp,
      inventoryValue, inventoryQty, lowStockCount: lowStock.length,
      shipmentsCost, supPaid,
      cashIn, cashOut, treasuryBalance: cashIn - cashOut,
      returnsTotal,
      invoicesCount: activeInv.length,
    };
  }, [activeInv, scopedExpenses, scopedProducts, scopedShipments, scopedSupPayments, scopedTreasury, scopedReturns]);

  // Per-branch (used in global mode)
  const perBranch = useMemo(() => branches.map((b) => {
    const bInv = invoices.filter((i) => i.status === "active" && i.branch_id === b.id);
    const sales = bInv.reduce((s, i) => s + Number(i.total), 0);
    const cost = bInv.reduce((s, i) => s + i.invoice_items.reduce((x: number, it: any) => x + Number(it.cost_price) * it.quantity, 0), 0);
    const exp = expenses.filter((e) => e.branch_id === b.id).reduce((s, e) => s + Number(e.amount), 0);
    const bProducts = products.filter((p) => p.branch_id === b.id);
    return {
      ...b,
      invoices: bInv.length, sales, cost, profit: sales - cost,
      expenses: exp, net: sales - cost - exp,
      inventoryValue: bProducts.reduce((s, p) => s + Number(p.cost_price) * p.quantity, 0),
      inventoryQty: bProducts.reduce((s, p) => s + p.quantity, 0),
      employees: employees.filter((e) => e.branch_id === b.id).length,
      treasuryBalance:
        treasury.filter((t) => t.branch_id === b.id && t.type === "receipt").reduce((s, t) => s + Number(t.amount), 0) -
        treasury.filter((t) => t.branch_id === b.id && t.type === "payment").reduce((s, t) => s + Number(t.amount), 0),
    };
  }), [branches, invoices, expenses, products, employees, treasury]);

  // Top products in scope
  const topProducts = useMemo(() => {
    const m: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const inv of activeInv) for (const it of inv.invoice_items) {
      const key = it.product_name;
      if (!m[key]) m[key] = { name: key, qty: 0, revenue: 0 };
      m[key].qty += it.quantity;
      m[key].revenue += Number(it.total);
    }
    return Object.values(m).sort((a, b) => b.revenue - a.revenue).slice(0, 15);
  }, [activeInv]);

  const expByType = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of scopedExpenses) m[e.type] = (m[e.type] ?? 0) + Number(e.amount);
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, [scopedExpenses]);

  const lowStockList = useMemo(() => scopedProducts.filter((p) => p.quantity <= p.low_stock_alert), [scopedProducts]);

  // Suppliers — global only. Compute total invoiced (علينا) + total paid (سددنا) historically.
  const suppliersWithTotals = useMemo(() => {
    return suppliers.map((s) => {
      const totalOwed = allShipments
        .filter((sh) => sh.contact_id === s.id)
        .reduce((sum, sh) => sum + Number(sh.total_cost ?? 0), 0);
      const totalPaid = allSupPayments
        .filter((p) => p.contact_id === s.id)
        .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
      return { ...s, totalOwed, totalPaid, remaining: Number(s.balance ?? 0) };
    });
  }, [suppliers, allShipments, allSupPayments]);

  const topSuppliers = useMemo(
    () => [...suppliersWithTotals].sort((a, b) => b.remaining - a.remaining).slice(0, 50),
    [suppliersWithTotals]
  );
  const supplierDebt = suppliersWithTotals.reduce((s, x) => s + x.remaining, 0);
  const supplierTotalOwed = suppliersWithTotals.reduce((s, x) => s + x.totalOwed, 0);
  const supplierTotalPaid = suppliersWithTotals.reduce((s, x) => s + x.totalPaid, 0);

  const currentBranchName = scope === "global" ? "كل الفروع" : (branches.find((b) => b.id === scope)?.name ?? "—");

  // ============ Export ============
  const exportXlsx = () => {
    const sheets: { name: string; rows: any[] }[] = [
      { name: "ملخص", rows: [
        { البند: "النطاق", القيمة: currentBranchName },
        { البند: "من", القيمة: from },
        { البند: "إلى", القيمة: to },
        { البند: "المبيعات", القيمة: k.sales },
        { البند: "التكلفة", القيمة: k.cost },
        { البند: "إجمالي الربح", القيمة: k.profit },
        { البند: "المصروفات", القيمة: k.exp },
        { البند: "صافي الربح", القيمة: k.net },
        { البند: "قيمة المخزون", القيمة: k.inventoryValue },
        { البند: "قطع المخزون", القيمة: k.inventoryQty },
        { البند: "تكلفة الشحنات", القيمة: k.shipmentsCost },
        { البند: "مدفوع للموردين", القيمة: k.supPaid },
        { البند: "وارد الخزنة", القيمة: k.cashIn },
        { البند: "صادر الخزنة", القيمة: k.cashOut },
        { البند: "رصيد الخزنة", القيمة: k.treasuryBalance },
        { البند: "المرتجعات", القيمة: k.returnsTotal },
      ]},
      { name: "أكثر_المنتجات", rows: topProducts.map((p) => ({ المنتج: p.name, الكمية: p.qty, الإيراد: p.revenue })) },
      { name: "المصروفات_حسب_النوع", rows: expByType.map((e) => ({ النوع: e.name, المبلغ: e.value })) },
      { name: "مخزون_منخفض", rows: lowStockList.map((p) => ({ المنتج: p.name, المتوفر: p.quantity, "حد التنبيه": p.low_stock_alert })) },
    ];
    if (scope === "global") {
      sheets.push({ name: "مقارنة_الفروع", rows: perBranch.map((b) => ({
        الفرع: b.name, الكود: b.code, الفواتير: b.invoices,
        المبيعات: b.sales, التكلفة: b.cost, الربح: b.profit,
        المصروفات: b.expenses, الصافي: b.net,
        قيمة_المخزون: b.inventoryValue, الموظفين: b.employees, رصيد_الخزنة: b.treasuryBalance,
      })) });
      sheets.push({ name: "الموردين", rows: topSuppliers.map((s) => ({
        الشركة: s.company_name,
        الهاتف: s.phone ?? "",
        "علينا (إجمالي)": s.totalOwed,
        "سددنا": s.totalPaid,
        "المتبقي": s.remaining,
      })) });
    }
    exportToExcel(`تقرير-${currentBranchName}-${from}-${to}`, sheets);
  };

  const printSummary = () => {
    const branchTable = scope === "global" ? `
      <h3>أداء الفروع</h3>
      <table><thead><tr><th>الفرع</th><th>الفواتير</th><th>المبيعات</th><th>الربح</th><th>المصروفات</th><th>الصافي</th><th>المخزون</th></tr></thead><tbody>
        ${perBranch.map((b) => `<tr>
          <td><b>${b.name}</b></td><td>${b.invoices}</td>
          <td>${formatEGP(b.sales)}</td>
          <td class="pos">${formatEGP(b.profit)}</td>
          <td class="neg">${formatEGP(b.expenses)}</td>
          <td class="${b.net >= 0 ? "pos" : "neg"}"><b>${formatEGP(b.net)}</b></td>
          <td>${formatEGP(b.inventoryValue)}</td>
        </tr>`).join("")}
      </tbody></table>` : "";

    const html = `
      <div class="kpi">
        <div>المبيعات<b class="pos">${formatEGP(k.sales)}</b></div>
        <div>إجمالي الربح<b class="pos">${formatEGP(k.profit)}</b></div>
        <div>المصروفات<b class="neg">${formatEGP(k.exp)}</b></div>
        <div>صافي الربح<b class="${k.net >= 0 ? "pos" : "neg"}">${formatEGP(k.net)}</b></div>
        <div>قيمة المخزون<b>${formatEGP(k.inventoryValue)}</b></div>
        <div>رصيد الخزنة<b class="${k.treasuryBalance >= 0 ? "pos" : "neg"}">${formatEGP(k.treasuryBalance)}</b></div>
      </div>
      ${branchTable}
      <h3>أكثر المنتجات مبيعاً</h3>
      <table><thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>الإيراد</th></tr></thead><tbody>
        ${topProducts.map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.qty}</td><td>${formatEGP(p.revenue)}</td></tr>`).join("") || "<tr><td colspan='4'>لا توجد بيانات</td></tr>"}
      </tbody></table>
    `;
    printReport(`تقرير ${currentBranchName} (${from} → ${to})`, html);
  };

  return (
    <ConditionalLayout variant="admin" embedded={embedded}>
      <PageHeader
        title="التقارير"
        subtitle={`${currentBranchName} • ${from} → ${to}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportXlsx} className="gap-2"><FileSpreadsheet className="w-4 h-4" /> Excel</Button>
            <Button onClick={printSummary} className="gap-2"><Printer className="w-4 h-4" /> طباعة</Button>
          </div>
        }
      />

      {/* ===== Scope selector — clear top-level switch ===== */}
      <div className="card-elevated p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Layers className="w-4 h-4 text-primary" />
          <h3 className="font-bold">نطاق التقرير</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setScope("global")}
            className={`px-4 py-2.5 rounded-lg border-2 transition text-sm font-bold flex items-center gap-2 ${
              scope === "global"
                ? "bg-primary/10 border-primary text-primary"
                : "border-border bg-surface hover:border-primary/50"
            }`}
          >
            <Building2 className="w-4 h-4" />
            إجمالي كل الفروع
          </button>
          {branches.map((b) => (
            <button
              key={b.id}
              onClick={() => setScope(b.id)}
              className={`px-4 py-2.5 rounded-lg border-2 transition text-sm font-bold flex items-center gap-2 ${
                scope === b.id
                  ? "bg-primary/10 border-primary text-primary"
                  : "border-border bg-surface hover:border-primary/50"
              }`}
            >
              <Store className="w-4 h-4" />
              {b.name}
              <span className="text-[10px] text-muted-foreground font-normal">({b.code})</span>
            </button>
          ))}
        </div>
      </div>

      {/* ===== Date range ===== */}
      <div className="card-elevated p-4 mb-6 flex flex-wrap gap-3 items-end">
        <div><Label>من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1.5" /></div>
        <div><Label>إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1.5" /></div>
        <Button onClick={load} disabled={loading}>تحديث البيانات</Button>
        <div className="flex gap-1 mr-auto flex-wrap">
          <Button size="sm" variant="ghost" onClick={() => { setFrom(today()); setTo(today()); }}>اليوم</Button>
          <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(7)); setTo(today()); }}>7 أيام</Button>
          <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(30)); setTo(today()); }}>30 يوم</Button>
          <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(90)); setTo(today()); }}>3 شهور</Button>
          <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(365)); setTo(today()); }}>سنة</Button>
        </div>
      </div>

      {/* ===== Section 1: Profitability ===== */}
      <Section icon={<TrendingUp className="w-5 h-5" />} title="الربحية والمبيعات" color="success">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <MiniKpi label="المبيعات" value={formatEGP(k.sales)} icon={<ShoppingCart className="w-4 h-4" />} hint={`${k.invoicesCount} فاتورة`} />
          <MiniKpi label="التكلفة" value={formatEGP(k.cost)} icon={<Package className="w-4 h-4" />} />
          <MiniKpi label="إجمالي الربح" value={formatEGP(k.profit)} icon={<TrendingUp className="w-4 h-4" />} accent="success" />
          <MiniKpi label="المصروفات" value={formatEGP(k.exp)} icon={<TrendingDown className="w-4 h-4" />} accent="destructive" />
          <MiniKpi label="صافي الربح" value={formatEGP(k.net)} icon={<Wallet className="w-4 h-4" />} accent={k.net >= 0 ? "success" : "destructive"} />
        </div>
      </Section>

      {/* ===== Section 2: Inventory & Suppliers ===== */}
      <Section icon={<Store className="w-5 h-5" />} title="المخزون والموردين" color="primary">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MiniKpi label="قيمة المخزون" value={formatEGP(k.inventoryValue)} icon={<Store className="w-4 h-4" />} hint={`${k.inventoryQty} قطعة`} />
          <MiniKpi label="مخزون منخفض" value={String(k.lowStockCount)} icon={<AlertTriangle className="w-4 h-4" />} accent={k.lowStockCount > 0 ? "warning" : "success"} hint="منتج تحت الحد" />
          <MiniKpi label="تكلفة الشحنات" value={formatEGP(k.shipmentsCost)} icon={<Truck className="w-4 h-4" />} hint={`${scopedShipments.length} شحنة`} />
          <MiniKpi label="مدفوع للموردين" value={formatEGP(k.supPaid)} icon={<ArrowUpCircle className="w-4 h-4" />} accent="warning" />
        </div>
        {scope === "global" && (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-3">
            <MiniKpi label="إجمالي علينا للموردين" value={formatEGP(supplierTotalOwed)} icon={<Truck className="w-4 h-4" />} hint="من جميع الشحنات" />
            <MiniKpi label="إجمالي ما سددناه" value={formatEGP(supplierTotalPaid)} icon={<ArrowUpCircle className="w-4 h-4" />} accent="success" hint="من جميع الدفعات" />
            <MiniKpi label="المتبقي علينا" value={formatEGP(supplierDebt)} icon={<Wallet className="w-4 h-4" />} accent="destructive" hint={`${suppliers.length} مورد`} />
          </div>
        )}
      </Section>

      {/* ===== Section 3: Treasury & Operations ===== */}
      <Section icon={<Wallet className="w-5 h-5" />} title="الخزنة والعمليات" color="warning">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <MiniKpi label="وارد الخزنة" value={formatEGP(k.cashIn)} icon={<ArrowDownCircle className="w-4 h-4" />} accent="success" />
          <MiniKpi label="صادر الخزنة" value={formatEGP(k.cashOut)} icon={<ArrowUpCircle className="w-4 h-4" />} accent="destructive" />
          <MiniKpi label="رصيد الخزنة" value={formatEGP(k.treasuryBalance)} icon={<Wallet className="w-4 h-4" />} accent={k.treasuryBalance >= 0 ? "success" : "destructive"} />
          <MiniKpi label="المرتجعات" value={formatEGP(k.returnsTotal)} icon={<RotateCcw className="w-4 h-4" />} accent="warning" hint={`${scopedReturns.length} مرتجع`} />
          <MiniKpi label="الموظفين / العملاء" value={`${scopedEmployees.length} / ${scopedCustomers.length}`} icon={<Users className="w-4 h-4" />} />
        </div>
      </Section>

      {/* ===== Detailed tabs ===== */}
      <Tabs defaultValue={scope === "global" ? "branches" : "products"} className="mt-2">
        <TabsList className="flex-wrap h-auto">
          {scope === "global" && <TabsTrigger value="branches">🏢 مقارنة الفروع</TabsTrigger>}
          <TabsTrigger value="products">📦 المنتجات</TabsTrigger>
          <TabsTrigger value="expenses">💸 المصروفات</TabsTrigger>
          <TabsTrigger value="lowstock">⚠️ مخزون منخفض</TabsTrigger>
          {scope === "global" && <TabsTrigger value="suppliers">🚚 الموردين</TabsTrigger>}
          <TabsTrigger value="payments">💳 المدفوعات والعمولات</TabsTrigger>
          <TabsTrigger value="overdue">⏰ المتأخرات</TabsTrigger>
        </TabsList>

        {scope === "global" && (
          <TabsContent value="branches" className="mt-4 space-y-6">
            {/* Branch comparison chart */}
            <div className="card-elevated p-5">
              <h4 className="font-bold mb-4">مقارنة أداء الفروع</h4>
              {perBranch.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">لا توجد فروع</div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={perBranch.map((b) => ({ name: b.name, مبيعات: b.sales, ربح: b.profit, مصروفات: b.expenses }))}>
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

            {/* Per-branch detailed cards */}
            <div className="grid lg:grid-cols-2 gap-4">
              {perBranch.map((b) => (
                <div key={b.id} className="card-elevated p-5 hover:border-primary/50 transition cursor-pointer" onClick={() => setScope(b.id)}>
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold">{b.name}</h3>
                        <div className="text-xs text-muted-foreground">{b.code}</div>
                      </div>
                    </div>
                    <div className="text-left">
                      <div className={`text-xl font-extrabold ${b.net >= 0 ? "text-success" : "text-destructive"}`}>{formatEGP(b.net)}</div>
                      <div className="text-[10px] text-muted-foreground">صافي الربح</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Row label="الفواتير" value={String(b.invoices)} />
                    <Row label="المبيعات" value={formatEGP(b.sales)} />
                    <Row label="الربح" value={formatEGP(b.profit)} accent="success" />
                    <Row label="المصروفات" value={formatEGP(b.expenses)} accent="destructive" />
                    <Row label="المخزون" value={formatEGP(b.inventoryValue)} hint={`${b.inventoryQty} قطعة`} />
                    <Row label="الخزنة" value={formatEGP(b.treasuryBalance)} accent={b.treasuryBalance >= 0 ? "success" : "destructive"} />
                    <Row label="الموظفين" value={String(b.employees)} />
                  </div>
                  <div className="flex items-center justify-end gap-1 text-xs text-primary mt-3 pt-3 border-t border-border">
                    عرض تقرير الفرع التفصيلي <ChevronLeft className="w-3 h-3" />
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        )}

        <TabsContent value="products" className="mt-4 space-y-4">
          <div className="card-elevated p-4">
            <h4 className="font-bold mb-3">أكثر 10 منتجات إيراداً</h4>
            {topProducts.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">لا توجد بيانات</div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={topProducts.slice(0, 10)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip formatter={(v: any) => formatEGP(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="revenue" name="الإيراد" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <DataTable rows={topProducts} loading={loading} empty="لا توجد بيانات"
            columns={[
              { key: "name", header: "المنتج", render: (r: any) => <b>{r.name}</b> },
              { key: "qty", header: "الكمية" },
              { key: "revenue", header: "الإيراد", render: (r: any) => <b className="text-primary">{formatEGP(r.revenue)}</b> },
            ]} />
        </TabsContent>

        <TabsContent value="expenses" className="mt-4 space-y-4">
          {expByType.length > 0 && (
            <div className="card-elevated p-4">
              <h4 className="font-bold mb-3">المصروفات حسب النوع</h4>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={expByType} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e: any) => `${e.name}: ${formatEGP(e.value)}`}>
                    {expByType.map((_, i) => <RCell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => formatEGP(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <DataTable rows={expByType} empty="لا توجد مصروفات"
            columns={[
              { key: "name", header: "النوع" },
              { key: "value", header: "المبلغ", render: (r: any) => <b className="text-destructive">{formatEGP(r.value)}</b> },
            ]} />
        </TabsContent>

        <TabsContent value="lowstock" className="mt-4">
          <DataTable rows={lowStockList} loading={loading} empty="✅ كل المنتجات بمخزون كافي"
            columns={[
              { key: "name", header: "المنتج", render: (r: any) => <b>{r.name}</b> },
              { key: "sku", header: "الكود" },
              { key: "quantity", header: "المتوفر", render: (r: any) => <b className="text-destructive">{r.quantity}</b> },
              { key: "low_stock_alert", header: "الحد الأدنى" },
            ]} />
        </TabsContent>

        {scope === "global" && (
          <TabsContent value="suppliers" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <MiniKpi label="إجمالي علينا" value={formatEGP(supplierTotalOwed)} icon={<Truck className="w-4 h-4" />} hint="قيمة كل الشحنات تاريخياً" />
              <MiniKpi label="إجمالي سددناه" value={formatEGP(supplierTotalPaid)} icon={<ArrowUpCircle className="w-4 h-4" />} accent="success" hint="كل الدفعات تاريخياً" />
              <MiniKpi label="المتبقي علينا" value={formatEGP(supplierDebt)} icon={<Wallet className="w-4 h-4" />} accent="destructive" />
            </div>
            <DataTable rows={topSuppliers} loading={loading} empty="لا يوجد موردين"
              columns={[
                { key: "company_name", header: "الشركة", render: (r: any) => <b>{r.company_name}</b> },
                { key: "phone", header: "الهاتف", render: (r: any) => r.phone ?? "—" },
                { key: "totalOwed", header: "علينا (إجمالي)", render: (r: any) => <span className="text-muted-foreground">{formatEGP(r.totalOwed)}</span> },
                { key: "totalPaid", header: "سددنا", render: (r: any) => <span className="text-success">{formatEGP(r.totalPaid)}</span> },
                { key: "remaining", header: "المتبقي", render: (r: any) => <b className={r.remaining > 0 ? "text-destructive" : "text-success"}>{formatEGP(r.remaining)}</b> },
              ]} />
          </TabsContent>
        )}

        <TabsContent value="payments" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <MiniKpi label="إجمالي المعاملات" value={formatEGP(commissionAnalysis.totalVolume)} icon={<Wallet className="w-4 h-4" />} hint={`${scopedPayTx.length} معاملة`} />
            <MiniKpi label="إجمالي العمولات" value={formatEGP(commissionAnalysis.totalFees)} icon={<Receipt className="w-4 h-4" />} accent="warning" />
            <MiniKpi label="نسبة العمولة من الحجم" value={`${commissionAnalysis.totalVolume > 0 ? ((commissionAnalysis.totalFees / commissionAnalysis.totalVolume) * 100).toFixed(2) : "0"}%`} icon={<TrendingDown className="w-4 h-4" />} />
          </div>
          <div className="card-elevated p-5">
            <h4 className="font-bold mb-4">المعاملات حسب طريقة الدفع</h4>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={commissionAnalysis.byMethod.map((m) => ({ name: m.label, "حجم المعاملات": m.volume, "عمولة": m.fees }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip formatter={(v: any) => formatEGP(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                <Bar dataKey="حجم المعاملات" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="عمولة" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <DataTable rows={commissionAnalysis.byMethod} loading={loading} empty="لا توجد معاملات"
            columns={[
              { key: "label", header: "طريقة الدفع", render: (r: any) => <b>{r.label}</b> },
              { key: "count", header: "عدد المعاملات" },
              { key: "volume", header: "إجمالي الحجم", render: (r: any) => formatEGP(r.volume) },
              { key: "fees", header: "إجمالي العمولة", render: (r: any) => <b className="text-warning">{formatEGP(r.fees)}</b> },
              { key: "ratio", header: "نسبة العمولة", render: (r: any) => <span className="text-muted-foreground">{r.volume > 0 ? ((r.fees / r.volume) * 100).toFixed(2) : "0"}%</span> },
            ]} />
        </TabsContent>

        <TabsContent value="overdue" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <MiniKpi label="إجمالي خطط نشطة" value={String(scopedPlans.length)} icon={<Layers className="w-4 h-4" />} />
            <MiniKpi label="عدد الأقساط المتأخرة" value={String(scopedOverdue.length)} icon={<AlertTriangle className="w-4 h-4" />} accent="warning" />
            <MiniKpi label="إجمالي قيمة المتأخرات" value={formatEGP(scopedOverdue.reduce((s: number, i: any) => s + (Number(i.amount) - Number(i.paid_amount || 0)), 0))} icon={<Wallet className="w-4 h-4" />} accent="destructive" />
          </div>
          <h4 className="font-bold mt-4">أكثر العملاء/الجهات تأخرًا</h4>
          <DataTable rows={topOverdueCustomers} loading={loading} empty="✅ لا توجد متأخرات"
            columns={[
              { key: "name", header: "الاسم", render: (r: any) => <b>{r.name}</b> },
              { key: "type", header: "النوع", render: (r: any) => r.type === "customer" ? "عميل" : r.type === "supplier" ? "مورد" : "موظف" },
              { key: "branch", header: "الفرع", render: (r: any) => branches.find((b) => b.id === r.branch_id)?.name ?? "—" },
              { key: "overdueCount", header: "أقساط متأخرة", render: (r: any) => <b className="text-warning">{r.overdueCount}</b> },
              { key: "overdueAmount", header: "إجمالي المتأخر", render: (r: any) => <b className="text-destructive">{formatEGP(r.overdueAmount)}</b> },
            ]} />
        </TabsContent>
      </Tabs>
    </ConditionalLayout>
  );
}

/* ===== Helper UI ===== */

function Section({ icon, title, color, children }: { icon: React.ReactNode; title: string; color: "success" | "primary" | "warning"; children: React.ReactNode }) {
  const colors = {
    success: "bg-success/10 text-success",
    primary: "bg-primary/10 text-primary",
    warning: "bg-warning/10 text-warning",
  };
  return (
    <div className="card-elevated p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color]}`}>{icon}</div>
        <h2 className="font-bold text-lg">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function MiniKpi({ label, value, icon, hint, accent }: { label: string; value: string; icon: React.ReactNode; hint?: string; accent?: "success" | "destructive" | "warning" }) {
  const colorMap = {
    success: "text-success",
    destructive: "text-destructive",
    warning: "text-warning",
  };
  return (
    <div className="bg-surface-2 rounded-xl p-4 border border-border">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
        {icon}<span className="font-medium">{label}</span>
      </div>
      <div className={`font-extrabold text-lg ${accent ? colorMap[accent] : ""}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function Row({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: "success" | "destructive" }) {
  const c = accent === "success" ? "text-success" : accent === "destructive" ? "text-destructive" : "";
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded bg-surface-2/50">
      <span className="text-muted-foreground">{label}</span>
      <div className="text-left">
        <div className={`font-bold ${c}`}>{value}</div>
        {hint && <div className="text-[9px] text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}
