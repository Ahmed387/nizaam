import { getCairoDayBounds } from "@/lib/cairoDate";
import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { ReportIntro } from "@/components/ReportIntro";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { formatEGP } from "@/lib/format";
import { lineProfit, invoiceProfit } from "@/lib/profitEngine";
import { exportToExcel, printReport } from "@/lib/export";
import { fetchSchedules, fetchClosures, countWorkingDays, type BranchSchedule, type BranchClosure } from "@/lib/branchSchedule";
import {
  FileSpreadsheet, Printer, ShoppingCart, TrendingUp, TrendingDown,
  Wallet, Store, Users, Truck, Package, RotateCcw, Building2, AlertTriangle,
  Receipt, ArrowDownCircle, ArrowUpCircle, Layers, ChevronLeft,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell as RCell,
} from "recharts";
import { useBranchScope } from "@/lib/branchScope";

const CHART_COLORS = ["hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--destructive))", "hsl(var(--accent))", "#8b5cf6", "#06b6d4"];
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

type Branch = { id: string; name: string; code: string };

export default function AdminReports({ embedded }: { embedded?: boolean } = {}) {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<"global" | string>("global");
  const [productSort, setProductSort] = useState<"profit" | "revenue" | "qty">("profit");

  const [branches, setBranches] = useState<Branch[]>([]);

  const { filterBranches } = useBranchScope();
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
  const [invPayments, setInvPayments] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<Record<string, BranchSchedule>>({});
  const [closures, setClosures] = useState<BranchClosure[]>([]);

  const load = async () => {
    setLoading(true);
    const fromIso = getCairoDayBounds(from).startIso!;
    const toIso = getCairoDayBounds(undefined, to).endIso!;
    const [b, inv, exp, pr, sup, sh, sp, emp, tr, ret, cu, ash, asp, ptx, oi, pp, ipay] = await Promise.all([
      // خزينة الشركاء (PARTNER-CASH) فرع افتراضي محاسبي — مش فرع تشغيلي، بيتستبعد من تقارير الفروع
      supabase.from("branches").select("id,name,code").eq("is_active", true).neq("code", "PARTNER-CASH"),
      // سحب كل الفواتير على دفعات (الحد الافتراضي 1000 صف كان بيقص التقارير في الفترات الكبيرة)
      fetchAllRows<any>(() => supabase.from("invoices").select("*, invoice_items(*)").gte("invoice_date", fromIso).lte("invoice_date", toIso.order("id"))).then((rows) => ({ data: rows })),
      fetchAllRows<any>(() => supabase.from("vouchers").select("*, voucher_categories!inner(name, is_deductible_from_profit)").eq("type", "payment").eq("status", "active").eq("voucher_categories.is_deductible_from_profit", true).gte("voucher_date", from).lte("voucher_date", to.order("id"))).then((rows) => ({ data: rows })),
      // المنتجات المؤرشفة مش بتتحسب في قيمة المخزون ولا تنبيهات النقص
      fetchAllRows<any>(() => supabase.from("products").select("*").is("archived_at", null.order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("contacts").select("*".order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("shipments").select("*").gte("arrival_date", from).lte("arrival_date", to.order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("supplier_payments").select("*").gte("paid_at", fromIso).lte("paid_at", toIso.order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("employees").select("*").eq("is_active", true.order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("vouchers" as any).select("id,type, amount, branch_id, voucher_date").eq("status", "active").gte("voucher_date", from).lte("voucher_date", to.order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("returns").select("*").eq("status", "active").gte("invoice_date", fromIso).lte("invoice_date", toIso.order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("contacts").select("id,branch_id".order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("shipments").select("contact_id,total_cost".order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("supplier_payments").select("contact_id,amount".order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("payment_transactions").select("*").gte("created_at", fromIso).lte("created_at", toIso.order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("payment_installments").select("*, payment_plans!inner(entity_type,entity_name,branch_id)").eq("status", "overdue".order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("payment_plans").select("*").neq("status", "completed".order("id")).then((data) => ({ data })),
      fetchAllRows<any>(() => supabase.from("invoice_payments").select("id,branch_id, payment_method, amount, created_at").gte("created_at", fromIso).lte("created_at", toIso.order("id")).then((data) => ({ data })),
    ]);
    setBranches(filterBranches((b.data ?? []) as any) as any);
    setInvoices(inv.data ?? []);
    setExpenses((exp.data ?? []).map((v: any) => ({
      id: v.id, branch_id: v.branch_id, date: v.voucher_date, amount: v.amount,
      type: v.voucher_categories?.name ?? "أخرى",
      description: v.description ?? v.voucher_number,
    })));
    setProducts(pr.data ?? []);
    // TODO Phase 2.2B: Remove after contacts.balance column is dropped — merge canonical balances
    const supList = (sup.data ?? []) as any[];
    const { fetchContactBalanceMap, mergeBalancesById } = await import("@/lib/contactBalances");
    const supBalMap = await fetchContactBalanceMap(supList.map((c: any) => c.id));
    setSuppliers(mergeBalancesById(supList, supBalMap) as any);
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
    setInvPayments(ipay.data ?? []);
    const [sch, clo] = await Promise.all([fetchSchedules(), fetchClosures()]);
    setSchedules(sch);
    setClosures(clo);
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
  // ⚠️ Single source of truth: src/lib/profitEngine.ts → lineProfit()
  const k = useMemo(() => {
    const sales = activeInv.reduce((s, i) => s + invoiceProfit(i).revenue, 0);
    let cost = 0, netRevenue = 0;
    for (const inv of activeInv) {
      const ip = invoiceProfit(inv);
      cost += ip.cost;
      netRevenue += ip.revenue;
    }
    const exp = scopedExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const inventoryValue = scopedProducts.reduce((s, p) => s + Number(p.cost_price) * p.quantity, 0);
    const inventoryQty = scopedProducts.reduce((s, p) => s + p.quantity, 0);
    const lowStock = scopedProducts.filter((p) => p.quantity <= p.low_stock_alert);
    const shipmentsCost = scopedShipments.reduce((s, x) => s + Number(x.total_cost), 0);
    const supPaid = scopedSupPayments.reduce((s, x) => s + Number(x.amount), 0);
    const cashIn = scopedTreasury.filter((t) => t.type === "receipt").reduce((s, t) => s + Number(t.amount), 0);
    const cashOut = scopedTreasury.filter((t) => t.type === "payment").reduce((s, t) => s + Number(t.amount), 0);
    const returnsTotal = scopedReturns.reduce((s, r) => s + Number(r.total_refund), 0);
    const profit = netRevenue - cost;
    return {
      sales, cost, profit, exp, net: profit - exp,
      netRevenue,
      inventoryValue, inventoryQty, lowStockCount: lowStock.length,
      shipmentsCost, supPaid,
      cashIn, cashOut, treasuryBalance: cashIn - cashOut,
      returnsTotal,
      invoicesCount: activeInv.length,
    };
  }, [activeInv, scopedExpenses, scopedProducts, scopedShipments, scopedSupPayments, scopedTreasury, scopedReturns]);

  // Per-branch (used in global mode)
  // ⚠️ Uses lineProfit() — single source of truth for revenue/cost/profit
  // Actual working days per branch (weekly off-days + exceptional closures excluded)
  const workingDaysByBranch = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of branches) {
      m[b.id] = countWorkingDays(schedules[b.id], closures.filter((c) => c.branch_id === b.id), from, to);
    }
    return m;
  }, [branches, schedules, closures, from, to]);

  const perBranch = useMemo(() => branches.map((b) => {
    const bInv = invoices.filter((i) => i.status === "active" && i.branch_id === b.id);
    let cost = 0, netRevenue = 0;
    for (const i of bInv) {
      const ip = invoiceProfit(i);
      cost += ip.cost;
      netRevenue += ip.revenue;
    }
    const sales = netRevenue;
    const profit = netRevenue - cost;
    const exp = expenses.filter((e) => e.branch_id === b.id).reduce((s, e) => s + Number(e.amount), 0);
    const bProducts = products.filter((p) => p.branch_id === b.id);

    // Payments received into treasury, grouped by method (for this branch)
    const bPays = invPayments.filter((p: any) => p.branch_id === b.id);
    const methodTotal = (m: string) =>
      bPays.filter((p: any) => p.payment_method === m).reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    const cashIn = methodTotal("cash");
    const walletIn = methodTotal("vodafone") + methodTotal("wallet") + methodTotal("etisalat") + methodTotal("orange");
    const instapayIn = methodTotal("instapay");
    const bankIn = methodTotal("bank") + methodTotal("bank_transfer");
    const creditIn = methodTotal("credit_balance");
    const otherIn = bPays
      .filter((p: any) => !["cash","vodafone","wallet","etisalat","orange","instapay","bank","bank_transfer","credit_balance"].includes(p.payment_method))
      .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    const totalReceived = cashIn + walletIn + instapayIn + bankIn + creditIn + otherIn;

    return {
      ...b,
      workingDays: workingDaysByBranch[b.id] ?? 0,
      invoices: bInv.length, sales, cost, profit,
      expenses: exp, net: profit - exp,
      inventoryValue: bProducts.reduce((s, p) => s + Number(p.cost_price) * p.quantity, 0),
      inventoryQty: bProducts.reduce((s, p) => s + p.quantity, 0),
      employees: employees.filter((e) => e.branch_id === b.id).length,
      treasuryBalance:
        treasury.filter((t) => t.branch_id === b.id && t.type === "receipt").reduce((s, t) => s + Number(t.amount), 0) -
        treasury.filter((t) => t.branch_id === b.id && t.type === "payment").reduce((s, t) => s + Number(t.amount), 0),
      cashIn, walletIn, instapayIn, bankIn, creditIn, otherIn, totalReceived,
    };
  }), [branches, invoices, expenses, products, employees, treasury, invPayments, workingDaysByBranch]);

  // Company-wide averages based on actual working days
  const companyWorkDays = useMemo(() => {
    const rows = scope === "global" ? perBranch : perBranch.filter((b: any) => b.id === scope);
    const days = rows.reduce((s: number, b: any) => s + (b.workingDays || 0), 0);
    const sales = rows.reduce((s: number, b: any) => s + b.sales, 0);
    const net = rows.reduce((s: number, b: any) => s + b.net, 0);
    const inv = rows.reduce((s: number, b: any) => s + b.invoices, 0);
    return {
      days,
      salesPerDay: days ? sales / days : 0,
      netPerDay: days ? net / days : 0,
      invPerDay: days ? inv / days : 0,
    };
  }, [perBranch, scope]);

  // Top products in scope — uses lineProfit() (single source of truth)
  const topProductsAll = useMemo(() => {
    const m: Record<string, { name: string; qty: number; returned: number; netQty: number; revenue: number; profit: number }> = {};
    for (const inv of activeInv) for (const it of inv.invoice_items) {
      const key = it.product_name;
      if (!m[key]) m[key] = { name: key, qty: 0, returned: 0, netQty: 0, revenue: 0, profit: 0 };
      const lp = lineProfit(it, { invoiceIsMigrated: !!inv.is_migrated });
      m[key].qty += Number(it.quantity) || 0;
      m[key].returned += Number(it.returned_quantity ?? 0);
      m[key].netQty += lp.netQty;
      m[key].revenue += lp.revenue;
      m[key].profit += lp.profit;
    }
    return Object.values(m);
  }, [activeInv]);

  // Sales breakdown by payment method (from invoices.payment_method)
  const salesByMethod = useMemo(() => {
    const m: Record<string, { method: string; label: string; count: number; total: number }> = {};
    const labels: Record<string, string> = {
      cash: "نقدي", credit: "آجل", vodafone: "فودافون كاش",
      instapay: "انستاباي", bank: "بنك", mixed: "متعدد",
    };
    for (const i of activeInv) {
      const pm = String(i.payment_method ?? "—");
      if (!m[pm]) m[pm] = { method: pm, label: labels[pm] ?? pm, count: 0, total: 0 };
      m[pm].count += 1;
      m[pm].total += Number(i.total);
    }
    return Object.values(m).sort((a, b) => b.total - a.total);
  }, [activeInv]);

  // Sales breakdown by cashier
  const salesByCashier = useMemo(() => {
    const m: Record<string, { id: string; name: string; count: number; total: number }> = {};
    for (const i of activeInv) {
      const id = i.cashier_id ?? "—";
      const name = employees.find((e) => e.id === id)?.name ?? "—";
      if (!m[id]) m[id] = { id, name, count: 0, total: 0 };
      m[id].count += 1;
      m[id].total += Number(i.total);
    }
    return Object.values(m).sort((a, b) => b.total - a.total);
  }, [activeInv, employees]);

  const expByType = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of scopedExpenses) m[e.type] = (m[e.type] ?? 0) + Number(e.amount);
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, [scopedExpenses]);

  const lowStockList = useMemo(() => scopedProducts.filter((p) => p.quantity <= p.low_stock_alert), [scopedProducts]);

  // Slow-moving products: zero qty sold in the period, still has stock
  const slowMoving = useMemo(() => {
    const sold = new Set<string>();
    for (const inv of activeInv) for (const it of inv.invoice_items) sold.add(it.product_id ?? it.product_name);
    return scopedProducts
      .filter((p) => p.quantity > 0 && !sold.has(p.id) && !sold.has(p.name))
      .map((p) => ({ ...p, stockValue: Number(p.cost_price ?? 0) * Number(p.quantity ?? 0) }))
      .sort((a, b) => b.stockValue - a.stockValue)
      .slice(0, 50);
  }, [activeInv, scopedProducts]);


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
        { البند: "تكلفة فواتير الشراء", القيمة: k.shipmentsCost },
        { البند: "مدفوع للموردين", القيمة: k.supPaid },
        { البند: "وارد الخزنة", القيمة: k.cashIn },
        { البند: "صادر الخزنة", القيمة: k.cashOut },
        { البند: "رصيد الخزنة", القيمة: k.treasuryBalance },
        { البند: "المرتجعات", القيمة: k.returnsTotal },
      ]},
      { name: "أكثر_المنتجات", rows: topProductsAll.slice(0, 50).map((p) => ({ المنتج: p.name, "الكمية المباعة": p.qty, "المرتجع": p.returned, "الصافي": p.netQty, "الإيراد الصافي": p.revenue, "الربح الصافي": p.profit })) },
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
        الشركة: s.name,
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
        ${[...topProductsAll].sort((a,b)=>b.revenue-a.revenue).slice(0,15).map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.qty}</td><td>${formatEGP(p.revenue)}</td></tr>`).join("") || "<tr><td colspan='4'>لا توجد بيانات</td></tr>"}
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

      <ReportIntro
        icon="🏢"
        title="التقارير المركزية — العمليات اليومية"
        purpose="نبض الشركة التشغيلي: مين باع، كام، إزاي اتسحبت الفلوس، وفين راحت."
        shows={[
          "إجمالي المبيعات، المرتجعات، عدد ومتوسط الفواتير",
          "تفصيل طرق الدفع (نقدي / محفظة / إنستاباي / تحويل)",
          "أداء كل كاشير ونسبته من إجمالي البيع",
          "حركة الخزنة، المصروفات التشغيلية، أقساط الموردين المتأخرة",
        ]}
        unique="يُظهر النشاط اليومي للفروع وطرق الدفع، بدون تفاصيل ربحية أو قوائم أفضل/أسوأ."
        accent="primary"
        extra={
          <div className="flex flex-wrap gap-2 text-[11px]">
            <Link to="/admin/cockpit" className="px-2.5 py-1 rounded bg-surface-2 border border-border hover:border-primary hover:text-primary transition">👑 لملخص لحظي → نظرة المالك</Link>
            <Link to="/admin/reports-hub?tab=profitability" className="px-2.5 py-1 rounded bg-surface-2 border border-border hover:border-primary hover:text-primary transition">📊 لتفاصيل الربح → الربحية</Link>
            <Link to="/admin/reports-hub?tab=insights" className="px-2.5 py-1 rounded bg-surface-2 border border-border hover:border-primary hover:text-primary transition">🎯 لأعلى/أقل → الرؤى</Link>
          </div>
        }
      />


      {/* ===== Section 1: Operational KPIs (no profit — moved to Profitability tab) ===== */}
      <Section icon={<ShoppingCart className="w-5 h-5" />} title="حركة المبيعات والمرتجعات" color="success">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <MiniKpi label="إجمالي المبيعات" value={formatEGP(k.sales)} icon={<ShoppingCart className="w-4 h-4" />} hint={`${k.invoicesCount} فاتورة`} />
          <MiniKpi label="متوسط الفاتورة" value={formatEGP(k.invoicesCount > 0 ? k.sales / k.invoicesCount : 0)} icon={<Receipt className="w-4 h-4" />} />
          <MiniKpi label="المرتجعات" value={formatEGP(k.returnsTotal)} icon={<RotateCcw className="w-4 h-4" />} accent="warning" hint={`${scopedReturns.length} مرتجع`} />
          <MiniKpi label="المصروفات التشغيلية" value={formatEGP(k.exp)} icon={<TrendingDown className="w-4 h-4" />} accent="destructive" />
        </div>
      </Section>

      {/* ===== Section 2: Inventory & Suppliers (operational only) ===== */}
      <Section icon={<Store className="w-5 h-5" />} title="حركة المخزون والمشتريات" color="primary">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <MiniKpi label="قيمة المخزون" value={formatEGP(k.inventoryValue)} icon={<Store className="w-4 h-4" />} hint={`${k.inventoryQty} قطعة`} />
          <MiniKpi label="تكلفة فواتير الشراء" value={formatEGP(k.shipmentsCost)} icon={<Truck className="w-4 h-4" />} hint={`${scopedShipments.length} فاتورة شراء`} />
          <MiniKpi label="مدفوع للموردين" value={formatEGP(k.supPaid)} icon={<ArrowUpCircle className="w-4 h-4" />} accent="warning" />
        </div>
        <div className="text-xs text-muted-foreground mt-3 text-end">
          أرصدة الموردين الكاملة (مدين/دائن) في{" "}
          <Link to="/admin/reports-hub?tab=insights" className="text-primary font-bold hover:underline">🎯 الرؤى التنفيذية</Link>
          {" "}— تنبيهات المخزون في{" "}
          <Link to="/admin/dashboard" className="text-primary font-bold hover:underline">لوحة التحكم</Link>
        </div>
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

      {/* ===== Detailed tabs — operations only (profit/Top-Bottom removed → see 📊 الربحية & 🎯 الرؤى) ===== */}
      <Tabs defaultValue={scope === "global" ? "branches" : "sales"} className="mt-2">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="sales">🛒 المبيعات وطرق الدفع</TabsTrigger>
          <TabsTrigger value="purchases">🚚 المشتريات والموردين (تشغيلي)</TabsTrigger>
          <TabsTrigger value="inventory">📦 المخزون</TabsTrigger>
          <TabsTrigger value="employees">👥 الموظفين</TabsTrigger>
          {scope === "global" && <TabsTrigger value="branches">🏢 أداء الفروع</TabsTrigger>}
          <TabsTrigger value="payments">💳 المدفوعات والعمولات</TabsTrigger>
        </TabsList>

        {/* ===== TAB 1: SALES ===== */}
        <TabsContent value="sales" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MiniKpi label="إجمالي المبيعات" value={formatEGP(k.sales)} icon={<ShoppingCart className="w-4 h-4" />} accent="success" />
            <MiniKpi label="عدد الفواتير" value={String(k.invoicesCount)} icon={<Receipt className="w-4 h-4" />} />
            <MiniKpi label="متوسط الفاتورة" value={formatEGP(k.invoicesCount > 0 ? k.sales / k.invoicesCount : 0)} icon={<TrendingUp className="w-4 h-4" />} accent="success" />
            <MiniKpi label="المرتجعات" value={formatEGP(k.returnsTotal)} icon={<RotateCcw className="w-4 h-4" />} accent="warning" hint={`${scopedReturns.length} مرتجع`} />
          </div>

          <div className="card-elevated p-4">
            <h4 className="font-bold mb-3">المبيعات حسب طريقة الدفع</h4>
            <DataTable rows={salesByMethod} loading={loading} empty="لا توجد فواتير"
              columns={[
                { key: "label", header: "الطريقة", render: (r: any) => <b>{r.label}</b> },
                { key: "count", header: "عدد الفواتير" },
                { key: "total", header: "الإجمالي", render: (r: any) => <b className="text-success">{formatEGP(r.total)}</b> },
                { key: "pct", header: "النسبة", render: (r: any) => `${k.sales > 0 ? ((r.total / k.sales) * 100).toFixed(1) : "0"}%` },
              ]} />
          </div>

          <div className="card-elevated p-4">
            <h4 className="font-bold mb-1">المبيعات حسب الكاشير / البائع</h4>
            <p className="text-[11px] text-muted-foreground mb-3">أداء تشغيلي لكل بائع — لتفاصيل الربحية والهامش لكل كاشير، فلتر "الكاشير" متاح في <Link to="/admin/reports-hub?tab=profitability" className="text-primary hover:underline">📊 الربحية</Link></p>
            <DataTable rows={salesByCashier} loading={loading} empty="لا توجد فواتير"
              columns={[
                { key: "name", header: "الكاشير", render: (r: any) => <b>{r.name}</b> },
                { key: "count", header: "عدد الفواتير" },
                { key: "total", header: "الإجمالي", render: (r: any) => <b className="text-primary">{formatEGP(r.total)}</b> },
                { key: "avg", header: "متوسط الفاتورة", render: (r: any) => formatEGP(r.count > 0 ? r.total / r.count : 0) },
                { key: "share", header: "نسبة من الإجمالي", render: (r: any) => {
                  const tot = salesByCashier.reduce((s, c) => s + c.total, 0);
                  const pct = tot > 0 ? (r.total / tot) * 100 : 0;
                  return (
                    <div className="flex items-center gap-2 min-w-[120px]">
                      <div className="flex-1 h-1.5 bg-surface-2 rounded overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} /></div>
                      <span className="text-xs font-bold tabular-nums w-12 text-end">{pct.toFixed(1)}%</span>
                    </div>
                  );
                } },
              ]} />
          </div>

        </TabsContent>

        {/* TAB Profitability removed — single source: /admin/reports-hub?tab=profitability (📊 الربحية) */}


        {/* ===== TAB 3: PURCHASES & SUPPLIERS (with payables aging) ===== */}
        <TabsContent value="purchases" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MiniKpi label="تكلفة فواتير الشراء (الفترة)" value={formatEGP(k.shipmentsCost)} icon={<Truck className="w-4 h-4" />} hint={`${scopedShipments.length} فاتورة شراء`} />
            <MiniKpi label="مدفوع للموردين (الفترة)" value={formatEGP(k.supPaid)} icon={<ArrowUpCircle className="w-4 h-4" />} accent="success" />
            <MiniKpi label="إجمالي علينا للموردين" value={formatEGP(supplierDebt)} icon={<Wallet className="w-4 h-4" />} accent="destructive" hint="من contacts.balance" />
            <MiniKpi label="أقساط موردين متأخرة" value={String(scopedOverdue.filter((o: any) => o.payment_plans?.entity_type === "supplier").length)} icon={<AlertTriangle className="w-4 h-4" />} accent="warning" />
          </div>

          <div className="text-xs text-muted-foreground text-end">
            قائمة الموردين الكاملة وأرصدتهم في{" "}
            <Link to="/admin/reports-hub?tab=insights" className="text-primary font-bold hover:underline">🎯 الرؤى التنفيذية</Link>
          </div>


          <div className="card-elevated p-4">
            <h4 className="font-bold mb-3">أقساط الموردين المتأخرة</h4>
            <DataTable
              rows={scopedOverdue.filter((o: any) => o.payment_plans?.entity_type === "supplier")}
              loading={loading}
              empty="✅ لا توجد أقساط موردين متأخرة"
              columns={[
                { key: "supplier", header: "المورد", render: (r: any) => <b>{r.payment_plans?.entity_name ?? "—"}</b> },
                { key: "due_date", header: "تاريخ الاستحقاق", render: (r: any) => new Date(r.due_date).toLocaleDateString("ar-EG") },
                { key: "days_late", header: "أيام التأخير", render: (r: any) => {
                  const days = Math.max(0, Math.floor((Date.now() - new Date(r.due_date).getTime()) / 86400000));
                  const tone = days > 30 ? "bg-destructive text-destructive-foreground" : days > 14 ? "bg-warning text-warning-foreground" : "bg-amber-500/20 text-amber-700 dark:text-amber-400";
                  return <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${tone}`}>{days} يوم</span>;
                } },
                { key: "amount", header: "المبلغ المستحق", render: (r: any) => <b className="text-destructive">{formatEGP(Number(r.amount) - Number(r.paid_amount || 0))}</b> },
              ]} />
          </div>
        </TabsContent>


        {/* ===== TAB 4: INVENTORY ===== */}
        <TabsContent value="inventory" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <MiniKpi label="قيمة المخزون" value={formatEGP(k.inventoryValue)} icon={<Store className="w-4 h-4" />} hint={`${k.inventoryQty} قطعة`} />
            <MiniKpi label="عدد المنتجات" value={String(scopedProducts.length)} icon={<Package className="w-4 h-4" />} />
          </div>

          <div className="text-xs text-muted-foreground text-end">
            تنبيهات المخزون المنخفض في{" "}
            <Link to="/admin/dashboard" className="text-primary font-bold hover:underline">لوحة التحكم</Link>
            {" "}— كل المخزون في{" "}
            <Link to="/admin/inventory" className="text-primary font-bold hover:underline">صفحة المخزون التفصيلية</Link>
            {" "}— تحليل المنتجات الراكدة في{" "}
            <Link to="/admin/reports-hub?tab=insights" className="text-primary font-bold hover:underline">🎯 الرؤى التنفيذية</Link>
          </div>
        </TabsContent>

        {/* ===== TAB 5: EMPLOYEES ===== */}
        <TabsContent value="employees" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <MiniKpi label="عدد الموظفين" value={String(scopedEmployees.length)} icon={<Users className="w-4 h-4" />} />
            <MiniKpi label="إجمالي الرواتب الأساسية" value={formatEGP(scopedEmployees.reduce((s, e: any) => s + Number(e.base_salary ?? 0), 0))} icon={<Wallet className="w-4 h-4" />} />
            <MiniKpi label="موظفي البيع النشطين" value={String(salesByCashier.filter((c) => c.id !== "—").length)} icon={<ShoppingCart className="w-4 h-4" />} />
          </div>
          <DataTable rows={scopedEmployees} loading={loading} empty="لا يوجد موظفين"
            columns={[
              { key: "name", header: "الاسم", render: (r: any) => <b>{r.name}</b> },
              { key: "role", header: "الوظيفة", render: (r: any) => r.role ?? "—" },
              { key: "branch", header: "الفرع", render: (r: any) => branches.find((b) => b.id === r.branch_id)?.name ?? "—" },
              { key: "base_salary", header: "الراتب الأساسي", render: (r: any) => formatEGP(Number(r.base_salary ?? 0)) },
            ]} />
        </TabsContent>

        {/* ===== TAB 6: BRANCHES (global only) ===== */}
        {scope === "global" && (
          <TabsContent value="branches" className="mt-4 space-y-6">

            {/* ===== Working-day averages (company wide) ===== */}
            <div className="card-elevated p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-border bg-gradient-to-b from-surface-2/60 to-transparent text-center">
                <h4 className="font-extrabold text-base md:text-lg">المتوسطات على أيام العمل الفعلية</h4>
                <p className="text-[11px] text-muted-foreground mt-1">
                  بعد استبعاد الإجازات الأسبوعية والإغلاق الاستثنائي لكل فرع (من {from} إلى {to})
                </p>
              </div>
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <MiniKpi label="إجمالي أيام العمل (كل الفروع)" value={String(companyWorkDays.days)} icon={<Layers className="w-4 h-4" />} />
                  <MiniKpi label="متوسط المبيعات / يوم عمل" value={formatEGP(companyWorkDays.salesPerDay)} icon={<ShoppingCart className="w-4 h-4" />} accent="success" />
                  <MiniKpi label="متوسط صافي التشغيل / يوم عمل" value={formatEGP(companyWorkDays.netPerDay)} icon={<Wallet className="w-4 h-4" />} accent={companyWorkDays.netPerDay >= 0 ? "success" : "destructive"} />
                  <MiniKpi label="متوسط الفواتير / يوم عمل" value={companyWorkDays.invPerDay.toFixed(1)} icon={<Receipt className="w-4 h-4" />} />
                </div>
                <DataTable rows={perBranch} loading={loading} empty="لا توجد فروع"
                  columns={[
                    { key: "name", header: "الفرع", render: (r: any) => <b>{r.name}</b> },
                    { key: "workingDays", header: "أيام العمل" },
                    { key: "spd", header: "مبيعات / يوم عمل", render: (r: any) => <b className="text-success">{formatEGP(r.workingDays ? r.sales / r.workingDays : 0)}</b> },
                    { key: "npd", header: "صافي / يوم عمل", render: (r: any) => <b className={r.net >= 0 ? "text-success" : "text-destructive"}>{formatEGP(r.workingDays ? r.net / r.workingDays : 0)}</b> },
                    { key: "ipd", header: "فواتير / يوم عمل", render: (r: any) => (r.workingDays ? r.invoices / r.workingDays : 0).toFixed(1) },
                  ]} />
              </div>
            </div>
            <div className="card-elevated p-5">
              <h4 className="font-bold mb-4">مقارنة الفروع — المبيعات والمصروفات التشغيلية</h4>
              {perBranch.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">لا توجد فروع</div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={perBranch.map((b) => ({ name: b.name, مبيعات: b.sales, مصروفات: b.expenses }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip formatter={(v: any) => formatEGP(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                    <Legend />
                    <Bar dataKey="مبيعات" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="مصروفات" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>


            {/* ===== Per-branch receipts × expenses (operational — net profit moved to 📊 الربحية / 👑 نظرة المالك) ===== */}
            <div className="card-elevated p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-border bg-gradient-to-b from-surface-2/60 to-transparent text-center relative">
                <h4 className="font-extrabold text-base md:text-lg">المتحصلات لكل فرع حسب طريقة الدفع والمصروفات التشغيلية</h4>
                <p className="mt-1 text-xs md:text-sm text-muted-foreground">قارن المتحصلات النقدية والإلكترونية لكل فرع مع المصروفات التشغيلية في نفس الفترة.</p>
                <Link to="/admin/cockpit" className="absolute top-3 left-3 text-[11px] text-primary hover:underline">صافي الربح لكل فرع → 👑 نظرة المالك</Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs md:text-sm border-collapse">
                  <thead className="bg-surface-2 border-b-2 border-border">
                    <tr>
                      <th className="px-3 py-3 text-right font-bold uppercase tracking-wider text-foreground/80">الفرع</th>
                      <th className="px-3 py-3 text-center font-bold uppercase tracking-wider text-foreground/80 border-r border-border/60">💵 نقدي</th>
                      <th className="px-3 py-3 text-center font-bold uppercase tracking-wider text-foreground/80 border-r border-border/60">📱 محفظة</th>
                      <th className="px-3 py-3 text-center font-bold uppercase tracking-wider text-foreground/80 border-r border-border/60">⚡ انستاباي</th>
                      <th className="px-3 py-3 text-center font-bold uppercase tracking-wider text-foreground/80 border-r border-border/60">🏦 تحويل بنكي</th>
                      <th className="px-3 py-3 text-center font-bold uppercase tracking-wider text-foreground/80 border-r border-border/60">💳 رصيد عميل</th>
                      <th className="px-3 py-3 text-center font-bold uppercase tracking-wider text-foreground/80 border-r border-border/60">⋯ أخرى</th>
                      <th className="px-3 py-3 text-center font-extrabold uppercase tracking-wider text-primary bg-primary/5 border-r border-border/60">إجمالي المتحصلات</th>
                      <th className="px-3 py-3 text-center font-bold uppercase tracking-wider text-destructive border-r border-border/60">المصروفات التشغيلية</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perBranch.map((b, i) => (
                      <tr key={b.id} className={`border-b border-border/60 hover:bg-primary/5 cursor-pointer transition-colors ${i % 2 === 1 ? "bg-surface-2/30" : ""}`} onClick={() => setScope(b.id)}>
                        <td className="px-3 py-3 font-bold">{b.name}<div className="text-[10px] text-muted-foreground font-normal">{b.code}</div></td>
                        <td className="px-3 py-3 text-center tabular-nums whitespace-nowrap border-r border-border/40">{b.cashIn > 0 ? formatEGP(b.cashIn) : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-3 text-center tabular-nums whitespace-nowrap border-r border-border/40">{b.walletIn > 0 ? formatEGP(b.walletIn) : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-3 text-center tabular-nums whitespace-nowrap border-r border-border/40">{b.instapayIn > 0 ? formatEGP(b.instapayIn) : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-3 text-center tabular-nums whitespace-nowrap border-r border-border/40">{b.bankIn > 0 ? formatEGP(b.bankIn) : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-3 text-center tabular-nums whitespace-nowrap border-r border-border/40">{b.creditIn > 0 ? formatEGP(b.creditIn) : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-3 text-center tabular-nums whitespace-nowrap border-r border-border/40">{b.otherIn > 0 ? formatEGP(b.otherIn) : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-3 text-center font-extrabold tabular-nums whitespace-nowrap bg-primary/5 text-primary border-r border-border/40">{formatEGP(b.totalReceived)}</td>
                        <td className="px-3 py-3 text-center font-bold tabular-nums whitespace-nowrap text-destructive border-r border-border/40">{formatEGP(b.expenses)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-surface-2 border-t-2 border-border font-extrabold">
                    <tr>
                      <td className="px-3 py-3">الإجمالي</td>
                      <td className="px-3 py-3 text-center tabular-nums whitespace-nowrap border-r border-border/40">{formatEGP(perBranch.reduce((s, b) => s + b.cashIn, 0))}</td>
                      <td className="px-3 py-3 text-center tabular-nums whitespace-nowrap border-r border-border/40">{formatEGP(perBranch.reduce((s, b) => s + b.walletIn, 0))}</td>
                      <td className="px-3 py-3 text-center tabular-nums whitespace-nowrap border-r border-border/40">{formatEGP(perBranch.reduce((s, b) => s + b.instapayIn, 0))}</td>
                      <td className="px-3 py-3 text-center tabular-nums whitespace-nowrap border-r border-border/40">{formatEGP(perBranch.reduce((s, b) => s + b.bankIn, 0))}</td>
                      <td className="px-3 py-3 text-center tabular-nums whitespace-nowrap border-r border-border/40">{formatEGP(perBranch.reduce((s, b) => s + b.creditIn, 0))}</td>
                      <td className="px-3 py-3 text-center tabular-nums whitespace-nowrap border-r border-border/40">{formatEGP(perBranch.reduce((s, b) => s + b.otherIn, 0))}</td>
                      <td className="px-3 py-3 text-center tabular-nums whitespace-nowrap bg-primary/10 text-primary border-r border-border/40">{formatEGP(perBranch.reduce((s, b) => s + b.totalReceived, 0))}</td>
                      <td className="px-3 py-3 text-center tabular-nums whitespace-nowrap text-destructive border-r border-border/40">{formatEGP(perBranch.reduce((s, b) => s + b.expenses, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

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
                      <div className="text-xl font-extrabold text-primary">{formatEGP(b.totalReceived)}</div>
                      <div className="text-[10px] text-muted-foreground">إجمالي المتحصلات</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Row label="الفواتير" value={String(b.invoices)} />
                    <Row label="المبيعات" value={formatEGP(b.sales)} />
                    <Row label="المصروفات التشغيلية" value={formatEGP(b.expenses)} accent="destructive" />
                    <Row label="المخزون" value={formatEGP(b.inventoryValue)} hint={`${b.inventoryQty} قطعة`} />
                    <Row label="الخزنة" value={formatEGP(b.treasuryBalance)} accent={b.treasuryBalance >= 0 ? "success" : "destructive"} />
                    <Row label="الموظفين" value={String(b.employees)} />
                  </div>
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="text-[10px] font-bold text-muted-foreground mb-2">تفصيل المتحصلات حسب طريقة الدفع</div>
                    <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                      <PMRow label="💵 نقدي" value={b.cashIn} />
                      <PMRow label="📱 محفظة" value={b.walletIn} />
                      <PMRow label="⚡ انستاباي" value={b.instapayIn} />
                      <PMRow label="🏦 تحويل بنكي" value={b.bankIn} />
                      {b.creditIn > 0 && <PMRow label="💳 رصيد عميل" value={b.creditIn} />}
                      {b.otherIn > 0 && <PMRow label="⋯ أخرى" value={b.otherIn} />}
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-1 text-xs text-primary mt-3 pt-3 border-t border-border">
                    عرض تقرير الفرع التفصيلي <ChevronLeft className="w-3 h-3" />
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        )}

        {/* Expenses moved to 🎯 الرؤى التنفيذية (Pie + Top/Bottom) — no duplication */}

        {/* ===== Extra: PAYMENT METHODS & COMMISSIONS ===== */}
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
  const styles = {
    success:     { bg: "bg-success/5",     border: "border-success/25",     chip: "bg-success/15 text-success",         value: "text-success",     label: "text-success/80" },
    destructive: { bg: "bg-destructive/5", border: "border-destructive/25", chip: "bg-destructive/15 text-destructive", value: "text-destructive", label: "text-destructive/80" },
    warning:     { bg: "bg-warning/5",     border: "border-warning/30",     chip: "bg-warning/15 text-warning",         value: "text-warning",     label: "text-warning/80" },
    neutral:     { bg: "bg-surface-2",     border: "border-border",         chip: "bg-primary/15 text-primary",         value: "text-foreground",  label: "text-muted-foreground" },
  } as const;
  const s = accent ? styles[accent] : styles.neutral;
  return (
    <div className={`rounded-xl p-4 border ${s.border} ${s.bg} flex flex-col items-center justify-center text-center`}>
      <div className="flex items-center justify-center gap-1.5 mb-2">
        <span className={`text-xs font-semibold ${s.label}`}>{label}</span>
        <span className={`w-5 h-5 rounded-full flex items-center justify-center ${s.chip} [&_svg]:w-3 [&_svg]:h-3`}>{icon}</span>
      </div>
      <div className={`font-extrabold text-2xl md:text-3xl tabular-nums leading-none ${s.value}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1.5 font-medium">{hint}</div>}
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

function PMRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between px-2 py-1 rounded bg-surface-2/70">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-bold ${value > 0 ? "" : "text-muted-foreground"}`}>{value > 0 ? formatEGP(value) : "—"}</span>
    </div>
  );
}
