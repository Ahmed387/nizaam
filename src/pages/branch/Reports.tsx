import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDate } from "@/lib/format";
import { exportToExcel, printReport } from "@/lib/export";
import { generateProfitReport } from "@/utils/generatePDFReport";
import { useAuth } from "@/contexts/AuthContext";
import { FileSpreadsheet, Printer, TrendingUp, TrendingDown, ShoppingCart, Wallet, RotateCcw, FileText } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";

const CHART_COLORS = ["hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--destructive))", "hsl(var(--accent))", "#8b5cf6", "#06b6d4"];

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export default function BranchReports() {
  const { id: branchId } = useParams<{ id: string }>();
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [treasury, setTreasury] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [branchName, setBranchName] = useState("");

  // Voucher categories that mirror business events already counted elsewhere.
  // We hide them from "expenses" and "treasury cash flow" to prevent double-counting:
  // - customer_return: refund of a sale return (already deducted from sales as net)
  // - supplier_payment: payment for a purchase (already a cost in inventory)
  // - branch_transfer_out: internal money movement (not a real expense)
  const EXCLUDE_KEYS = ["customer_return", "supplier_payment", "branch_transfer_out"];

  const load = async () => {
    if (!branchId) return;
    setLoading(true);
    const fromIso = new Date(from).toISOString();
    const toIso = new Date(to + "T23:59:59").toISOString();
    const [b, inv, exp, tr, pr, rt] = await Promise.all([
      supabase.from("branches").select("name").eq("id", branchId).maybeSingle(),
      supabase.from("invoices").select("*, invoice_items(*)").eq("branch_id", branchId).gte("created_at", fromIso).lte("created_at", toIso).order("created_at", { ascending: false }),
      supabase.from("vouchers").select("*, voucher_categories(name, system_key)").eq("branch_id", branchId).eq("type", "payment").eq("status", "active").gte("voucher_date", from).lte("voucher_date", to),
      supabase.from("vouchers" as any).select("type, amount, voucher_date, voucher_categories(system_key)").eq("branch_id", branchId).eq("status", "active").gte("voucher_date", from).lte("voucher_date", to),
      supabase.from("products").select("*").eq("branch_id", branchId),
      supabase.from("returns" as any).select("total_refund, created_at").eq("branch_id", branchId).eq("status", "active").gte("created_at", fromIso).lte("created_at", toIso),
    ]);
    setBranchName(b.data?.name ?? "");
    setInvoices(inv.data ?? []);
    setExpenses((exp.data ?? [])
      .filter((v: any) => !EXCLUDE_KEYS.includes(v.voucher_categories?.system_key))
      .map((v: any) => ({
        id: v.id, date: v.voucher_date, amount: v.amount,
        type: v.voucher_categories?.name ?? "أخرى",
        description: v.description ?? v.voucher_number,
      })));
    setTreasury((tr.data ?? []).filter((v: any) => !EXCLUDE_KEYS.includes(v.voucher_categories?.system_key)));
    setProducts(pr.data ?? []);
    setReturns(rt.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [branchId]);
  useRealtimeRefresh(["invoices", "invoice_items", "returns", "return_items", "products", "vouchers"], load);

  const activeInv = invoices.filter((i) => i.status === "active");
  const netQty = (it: any) => Math.max(0, (Number(it.quantity) || 0) - (Number(it.returned_quantity) || 0));
  const netLineTotal = (it: any) => {
    const qty = Number(it.quantity) || 0;
    return qty > 0 ? Number(it.total ?? 0) * (netQty(it) / qty) : 0;
  };
  const netInvoiceTotal = (i: any) => (i.invoice_items ?? []).reduce((s: number, it: any) => s + netLineTotal(it), 0);
  const totalSales = activeInv.reduce((s, i) => s + netInvoiceTotal(i), 0);
  const totalCost = activeInv.reduce((s, i) => s + i.invoice_items.reduce((x: number, it: any) => x + Number(it.cost_price) * netQty(it), 0), 0);
  const grossProfit = totalSales - totalCost;
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const netProfit = grossProfit - totalExpenses;
  const cashIn = treasury.filter((t) => t.type === "receipt").reduce((s, t) => s + Number(t.amount), 0);
  const cashOut = treasury.filter((t) => t.type === "payment").reduce((s, t) => s + Number(t.amount), 0);
  const totalReturns = returns.reduce((s, r: any) => s + Number(r.total_refund ?? 0), 0);

  // Top products
  const productMap: Record<string, { name: string; qty: number; revenue: number }> = {};
  for (const inv of activeInv) {
    for (const it of inv.invoice_items) {
      const k = it.product_name;
      if (!productMap[k]) productMap[k] = { name: k, qty: 0, revenue: 0 };
      productMap[k].qty += netQty(it);
      productMap[k].revenue += netLineTotal(it);
    }
  }
  const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  // Expenses by type
  const expByType: Record<string, number> = {};
  for (const e of expenses) expByType[e.type] = (expByType[e.type] ?? 0) + Number(e.amount);

  // Low stock
  const lowStock = products.filter((p) => p.quantity <= p.low_stock_alert);

  const exportXlsx = () => {
    exportToExcel(`تقرير-${branchName}-${from}-${to}`, [
      {
        name: "ملخص",
        rows: [
          { البند: "إجمالي المبيعات", القيمة: totalSales },
          { البند: "إجمالي التكلفة", القيمة: totalCost },
          { البند: "إجمالي الربح", القيمة: grossProfit },
          { البند: "إجمالي المصروفات", القيمة: totalExpenses },
          { البند: "صافي الربح", القيمة: netProfit },
          { البند: "وارد للخزنة", القيمة: cashIn },
          { البند: "صادر من الخزنة", القيمة: cashOut },
        ],
      },
      { name: "الفواتير", rows: activeInv.map((i) => ({ رقم: i.invoice_number, التاريخ: i.created_at, الإجمالي: netInvoiceTotal(i), الخصم: i.discount_amount })) },
      { name: "المنتجات_الأكثر_مبيعاً", rows: topProducts.map((p) => ({ المنتج: p.name, الكمية: p.qty, الإيراد: p.revenue })) },
      { name: "المصروفات", rows: expenses.map((e) => ({ التاريخ: e.date, النوع: e.type, المبلغ: e.amount, الوصف: e.description })) },
      { name: "مخزون_منخفض", rows: lowStock.map((p) => ({ المنتج: p.name, المتوفر: p.quantity, "حد التنبيه": p.low_stock_alert })) },
    ]);
  };

  const printSummary = () => {
    const html = `
      <div class="kpi">
        <div>إجمالي المبيعات<b class="pos">${formatEGP(totalSales)}</b></div>
        <div>إجمالي التكلفة<b>${formatEGP(totalCost)}</b></div>
        <div>إجمالي الربح<b class="pos">${formatEGP(grossProfit)}</b></div>
        <div>المصروفات<b class="neg">${formatEGP(totalExpenses)}</b></div>
        <div>صافي الربح<b class="${netProfit >= 0 ? "pos" : "neg"}">${formatEGP(netProfit)}</b></div>
      </div>
      <h3>أكثر المنتجات مبيعاً</h3>
      <table><thead><tr><th>المنتج</th><th>الكمية</th><th>الإيراد</th></tr></thead><tbody>
        ${topProducts.map((p) => `<tr><td>${p.name}</td><td>${p.qty}</td><td>${formatEGP(p.revenue)}</td></tr>`).join("")}
      </tbody></table>
      <h3>المصروفات حسب النوع</h3>
      <table><thead><tr><th>النوع</th><th>المبلغ</th></tr></thead><tbody>
        ${Object.entries(expByType).map(([k, v]) => `<tr><td>${k}</td><td>${formatEGP(v)}</td></tr>`).join("") || "<tr><td colspan='2'>لا يوجد</td></tr>"}
      </tbody></table>
      ${lowStock.length ? `<h3>تنبيه: مخزون منخفض (${lowStock.length})</h3>
        <table><thead><tr><th>المنتج</th><th>المتوفر</th><th>الحد الأدنى</th></tr></thead><tbody>
        ${lowStock.map((p) => `<tr><td>${p.name}</td><td class="neg">${p.quantity}</td><td>${p.low_stock_alert}</td></tr>`).join("")}
        </tbody></table>` : ""}
    `;
    printReport(`تقرير الفرع: ${branchName} (${from} → ${to})`, html);
  };

  return (
    <BranchLayout>
      <PageHeader
        title="تقارير الفرع"
        subtitle={`${from} → ${to}`}
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
        <div className="flex gap-2 mr-auto">
          <Button size="sm" variant="ghost" onClick={() => { setFrom(today()); setTo(today()); }}>اليوم</Button>
          <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(7)); setTo(today()); }}>آخر 7 أيام</Button>
          <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(30)); setTo(today()); }}>آخر 30 يوم</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
        <StatCard label="المبيعات (صافي)" value={formatEGP(totalSales)} icon={<ShoppingCart className="w-4 h-4" />} hint="بعد خصم المرتجعات" />
        <StatCard label="المرتجعات" value={formatEGP(totalReturns)} icon={<RotateCcw className="w-4 h-4" />} accent="warning" hint={`${returns.length} عملية`} />
        <StatCard label="إجمالي الربح" value={formatEGP(grossProfit)} icon={<TrendingUp className="w-4 h-4" />} accent="success" />
        <StatCard label="المصروفات" value={formatEGP(totalExpenses)} icon={<TrendingDown className="w-4 h-4" />} accent="destructive" hint="بدون مرتجعات / مشتريات" />
        <StatCard label="صافي الربح" value={formatEGP(netProfit)} icon={<Wallet className="w-4 h-4" />} accent={netProfit >= 0 ? "success" : "destructive"} />
        <StatCard label="عدد الفواتير" value={String(activeInv.length)} icon={<ShoppingCart className="w-4 h-4" />} />
      </div>

      <Tabs defaultValue="charts">
        <TabsList>
          <TabsTrigger value="charts">📊 التحليل البصري</TabsTrigger>
          <TabsTrigger value="products">أكثر مبيعاً</TabsTrigger>
          <TabsTrigger value="expenses">سندات الصرف</TabsTrigger>
          <TabsTrigger value="lowstock">مخزون منخفض</TabsTrigger>
        </TabsList>

        <TabsContent value="charts" className="mt-4 space-y-6">
          {(() => {
            // sales by day
            const dayMap: Record<string, { date: string; sales: number; profit: number }> = {};
            for (const inv of activeInv) {
              const d = inv.created_at.slice(0, 10);
              if (!dayMap[d]) dayMap[d] = { date: d.slice(5), sales: 0, profit: 0 };
              dayMap[d].sales += netInvoiceTotal(inv);
              const cost = inv.invoice_items.reduce((s: number, it: any) => s + Number(it.cost_price) * netQty(it), 0);
              dayMap[d].profit += netInvoiceTotal(inv) - cost;
            }
            const dailyData = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
            const expensesData = Object.entries(expByType).map(([name, value]) => ({ name, value }));

            return (
              <>
                <div className="grid lg:grid-cols-2 gap-6">
                  <div className="card-elevated p-4">
                    <h4 className="font-bold mb-3">المبيعات والأرباح اليومية</h4>
                    <ResponsiveContainer width="100%" height={280}>
                      <AreaChart data={dailyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                        <Tooltip formatter={(v: any) => formatEGP(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                        <Legend />
                        <Area type="monotone" dataKey="sales" name="المبيعات" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.3} />
                        <Area type="monotone" dataKey="profit" name="الربح" stroke="hsl(var(--success))" fill="hsl(var(--success))" fillOpacity={0.3} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="card-elevated p-4">
                    <h4 className="font-bold mb-3">المصروفات حسب النوع</h4>
                    {expensesData.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground text-sm">لا توجد مصروفات</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                          <Pie data={expensesData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e: any) => `${e.name}: ${formatEGP(e.value)}`}>
                            {expensesData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v: any) => formatEGP(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                <div className="card-elevated p-4">
                  <h4 className="font-bold mb-3">أكثر 10 منتجات إيراداً</h4>
                  {topProducts.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground text-sm">لا توجد بيانات</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(360, topProducts.length * 56)}>
                      <BarChart data={topProducts} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
                        <defs>
                          <linearGradient id="topProductsGradient" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.8} />
                            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={1} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: any) => formatEGP(Number(v))} />
                        <YAxis type="category" dataKey="name" width={180} interval={0} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: any) => (typeof v === "string" && v.length > 24 ? v.slice(0, 24) + "…" : v)} />
                        <Tooltip formatter={(v: any) => formatEGP(Number(v))} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                        <Bar dataKey="revenue" name="الإيراد" fill="url(#topProductsGradient)" radius={[0, 4, 4, 0]} background={{ fill: "hsl(var(--muted))", fillOpacity: 0.2 }} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </>
            );
          })()}
        </TabsContent>

        <TabsContent value="products" className="mt-4">
          <DataTable rows={topProducts} loading={loading} empty="لا توجد بيانات"
            columns={[
              { key: "name", header: "المنتج", align: "center", render: (r: any) => <b className="block text-center">{r.name}</b> },
              { key: "qty", header: "الكمية", align: "center" },
              { key: "revenue", header: "الإيراد", align: "center", render: (r: any) => <b className="text-primary block text-center">{formatEGP(r.revenue)}</b> },
            ]} />
        </TabsContent>
        <TabsContent value="expenses" className="mt-4">
          <DataTable rows={Object.entries(expByType).map(([type, amount]) => ({ type, amount }))} empty="لا توجد مصروفات"
            columns={[
              { key: "type", header: "النوع" },
              { key: "amount", header: "المبلغ", render: (r: any) => <b className="text-destructive">{formatEGP(r.amount)}</b> },
            ]} />
        </TabsContent>
        <TabsContent value="lowstock" className="mt-4">
          <DataTable rows={lowStock} empty="كل المنتجات بمخزون كافي"
            columns={[
              { key: "name", header: "المنتج", align: "center" },
              { key: "quantity", header: "المتوفر", align: "center", render: (r: any) => <b className="text-destructive">{r.quantity}</b> },
              { key: "low_stock_alert", header: "حد التنبيه", align: "center" },
            ]} />
        </TabsContent>
      </Tabs>
    </BranchLayout>
  );
}
