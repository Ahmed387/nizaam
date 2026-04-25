import { useEffect, useState } from "react";
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
import { FileSpreadsheet, Printer, ShoppingCart, TrendingUp, TrendingDown, Wallet, Store } from "lucide-react";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export default function AdminReports() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    const fromIso = new Date(from).toISOString();
    const toIso = new Date(to + "T23:59:59").toISOString();
    const [b, inv, exp, pr] = await Promise.all([
      supabase.from("branches").select("*").eq("is_active", true),
      supabase.from("invoices").select("*, invoice_items(*)").gte("created_at", fromIso).lte("created_at", toIso),
      supabase.from("expenses").select("*").gte("date", from).lte("date", to),
      supabase.from("products").select("*"),
    ]);
    setBranches(b.data ?? []);
    setInvoices(inv.data ?? []);
    setExpenses(exp.data ?? []);
    setProducts(pr.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const activeInv = invoices.filter((i) => i.status === "active");

  // Per branch
  const perBranch = branches.map((b) => {
    const bInv = activeInv.filter((i) => i.branch_id === b.id);
    const sales = bInv.reduce((s, i) => s + Number(i.total), 0);
    const cost = bInv.reduce((s, i) => s + i.invoice_items.reduce((x: number, it: any) => x + Number(it.cost_price) * it.quantity, 0), 0);
    const exp = expenses.filter((e) => e.branch_id === b.id).reduce((s, e) => s + Number(e.amount), 0);
    return {
      id: b.id, name: b.name, code: b.code,
      invoices: bInv.length, sales, cost,
      profit: sales - cost,
      expenses: exp,
      net: sales - cost - exp,
    };
  });

  const totalSales = perBranch.reduce((s, b) => s + b.sales, 0);
  const totalCost = perBranch.reduce((s, b) => s + b.cost, 0);
  const totalProfit = totalSales - totalCost;
  const totalExpenses = perBranch.reduce((s, b) => s + b.expenses, 0);
  const netProfit = totalProfit - totalExpenses;

  // Top products globally
  const productMap: Record<string, { name: string; qty: number; revenue: number }> = {};
  for (const inv of activeInv) for (const it of inv.invoice_items) {
    const k = it.product_name;
    if (!productMap[k]) productMap[k] = { name: k, qty: 0, revenue: 0 };
    productMap[k].qty += it.quantity;
    productMap[k].revenue += Number(it.total);
  }
  const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 15);

  // Inventory value
  const invValue = products.reduce((s, p) => s + Number(p.cost_price) * p.quantity, 0);
  const invCount = products.reduce((s, p) => s + p.quantity, 0);

  const exportXlsx = () => {
    exportToExcel(`تقرير-مركزي-${from}-${to}`, [
      { name: "ملخص_عام", rows: [
        { البند: "إجمالي المبيعات", القيمة: totalSales },
        { البند: "إجمالي التكلفة", القيمة: totalCost },
        { البند: "إجمالي الربح", القيمة: totalProfit },
        { البند: "المصروفات", القيمة: totalExpenses },
        { البند: "صافي الربح", القيمة: netProfit },
        { البند: "قيمة المخزون", القيمة: invValue },
      ]},
      { name: "حسب_الفرع", rows: perBranch.map((b) => ({ الفرع: b.name, الكود: b.code, الفواتير: b.invoices, المبيعات: b.sales, التكلفة: b.cost, الربح: b.profit, المصروفات: b.expenses, الصافي: b.net })) },
      { name: "أكثر_مبيعاً", rows: topProducts.map((p) => ({ المنتج: p.name, الكمية: p.qty, الإيراد: p.revenue })) },
    ]);
  };

  const printSummary = () => {
    const html = `
      <div class="kpi">
        <div>إجمالي المبيعات<b class="pos">${formatEGP(totalSales)}</b></div>
        <div>إجمالي الربح<b class="pos">${formatEGP(totalProfit)}</b></div>
        <div>المصروفات<b class="neg">${formatEGP(totalExpenses)}</b></div>
        <div>صافي الربح<b class="${netProfit >= 0 ? "pos" : "neg"}">${formatEGP(netProfit)}</b></div>
        <div>قيمة المخزون<b>${formatEGP(invValue)}</b></div>
      </div>
      <h3>أداء الفروع</h3>
      <table><thead><tr><th>الفرع</th><th>الفواتير</th><th>المبيعات</th><th>الربح</th><th>المصروفات</th><th>الصافي</th></tr></thead><tbody>
        ${perBranch.map((b) => `<tr><td>${b.name}</td><td>${b.invoices}</td><td>${formatEGP(b.sales)}</td><td class="pos">${formatEGP(b.profit)}</td><td class="neg">${formatEGP(b.expenses)}</td><td class="${b.net >= 0 ? "pos" : "neg"}">${formatEGP(b.net)}</td></tr>`).join("")}
      </tbody></table>
      <h3>أكثر المنتجات مبيعاً</h3>
      <table><thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>الإيراد</th></tr></thead><tbody>
        ${topProducts.map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.qty}</td><td>${formatEGP(p.revenue)}</td></tr>`).join("")}
      </tbody></table>
    `;
    printReport(`التقرير المركزي (${from} → ${to})`, html);
  };

  return (
    <AdminLayout>
      <PageHeader
        title="التقارير المركزية"
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
          <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(7)); setTo(today()); }}>7 أيام</Button>
          <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(30)); setTo(today()); }}>30 يوم</Button>
          <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgo(365)); setTo(today()); }}>سنة</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <StatCard label="المبيعات" value={formatEGP(totalSales)} icon={<ShoppingCart className="w-4 h-4" />} />
        <StatCard label="إجمالي الربح" value={formatEGP(totalProfit)} icon={<TrendingUp className="w-4 h-4" />} accent="success" />
        <StatCard label="المصروفات" value={formatEGP(totalExpenses)} icon={<TrendingDown className="w-4 h-4" />} accent="destructive" />
        <StatCard label="صافي الربح" value={formatEGP(netProfit)} icon={<Wallet className="w-4 h-4" />} accent={netProfit >= 0 ? "success" : "destructive"} />
        <StatCard label="قيمة المخزون" value={formatEGP(invValue)} icon={<Store className="w-4 h-4" />} hint={`${invCount} قطعة`} />
      </div>

      <Tabs defaultValue="branches">
        <TabsList>
          <TabsTrigger value="branches">أداء الفروع</TabsTrigger>
          <TabsTrigger value="products">أكثر مبيعاً</TabsTrigger>
        </TabsList>
        <TabsContent value="branches" className="mt-4">
          <DataTable rows={perBranch} loading={loading} empty="لا توجد بيانات"
            columns={[
              { key: "name", header: "الفرع", render: (r: any) => <div><b>{r.name}</b><div className="text-xs text-muted-foreground">{r.code}</div></div> },
              { key: "invoices", header: "الفواتير" },
              { key: "sales", header: "المبيعات", render: (r: any) => formatEGP(r.sales) },
              { key: "profit", header: "إجمالي الربح", render: (r: any) => <b className="text-success">{formatEGP(r.profit)}</b> },
              { key: "expenses", header: "المصروفات", render: (r: any) => <span className="text-destructive">{formatEGP(r.expenses)}</span> },
              { key: "net", header: "الصافي", render: (r: any) => <b className={r.net >= 0 ? "text-success" : "text-destructive"}>{formatEGP(r.net)}</b> },
            ]} />
        </TabsContent>
        <TabsContent value="products" className="mt-4">
          <DataTable rows={topProducts} loading={loading} empty="لا توجد مبيعات"
            columns={[
              { key: "rank", header: "#", render: (_: any, ) => "" },
              { key: "name", header: "المنتج", render: (r: any) => <b>{r.name}</b> },
              { key: "qty", header: "الكمية" },
              { key: "revenue", header: "الإيراد", render: (r: any) => <b className="text-primary">{formatEGP(r.revenue)}</b> },
            ]} />
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
