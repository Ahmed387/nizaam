import { useCallback, useEffect, useState } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime } from "@/lib/format";
import { DollarSign, Wallet, AlertTriangle, Package } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [salesToday, setSalesToday] = useState(0);
  const [treasury, setTreasury] = useState(0);
  const [lowStock, setLowStock] = useState(0);
  const [shipmentsToday, setShipmentsToday] = useState(0);
  const [branchSummary, setBranchSummary] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();

      const [{ data: invToday }, { data: trAll }, { data: prods }, { data: shipsToday }, { data: branches }, { data: recentInv }] =
        await Promise.all([
          supabase.from("invoices").select("total").eq("status", "active").gte("created_at", todayIso),
          supabase.from("treasury").select("type, amount, branch_id"),
          supabase.from("products").select("quantity, low_stock_alert"),
          supabase.from("shipments").select("id").gte("created_at", todayIso),
          supabase.from("branches").select("*").eq("is_active", true),
          supabase.from("invoices").select("*, branches(name)").order("created_at", { ascending: false }).limit(10),
        ]);

      setSalesToday((invToday ?? []).reduce((s, x) => s + Number(x.total), 0));
      setTreasury((trAll ?? []).reduce((s, x) => s + (x.type === "income" ? 1 : -1) * Number(x.amount), 0));
      setLowStock((prods ?? []).filter((p) => p.quantity <= p.low_stock_alert).length);
      setShipmentsToday((shipsToday ?? []).length);
      setRecent(recentInv ?? []);

      // Per-branch summary
      const summary = await Promise.all(
        (branches ?? []).map(async (b) => {
          const [{ data: sales }, { data: exp }, { data: tr }] = await Promise.all([
            supabase.from("invoices").select("total").eq("branch_id", b.id).eq("status", "active"),
            supabase.from("expenses").select("amount").eq("branch_id", b.id),
            supabase.from("treasury").select("type, amount").eq("branch_id", b.id),
          ]);
          const totalSales = (sales ?? []).reduce((s, x) => s + Number(x.total), 0);
          const totalExp = (exp ?? []).reduce((s, x) => s + Number(x.amount), 0);
          const trBal = (tr ?? []).reduce((s, x) => s + (x.type === "income" ? 1 : -1) * Number(x.amount), 0);
          return { ...b, sales: totalSales, expenses: totalExp, profit: totalSales - totalExp, treasury: trBal };
        })
      );
      setBranchSummary(summary);
      setChartData(summary.map((s) => ({ name: s.name, sales: s.sales, profit: s.profit })));
      setLoading(false);
    })();
  }, []);

  return (
    <AdminLayout>
      <PageHeader title="لوحة التحكم العامة" subtitle="نظرة شاملة على كل الفروع" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="مبيعات اليوم" value={formatEGP(salesToday)} icon={<DollarSign className="w-5 h-5" />} accent="success" />
        <StatCard label="رصيد الخزن" value={formatEGP(treasury)} icon={<Wallet className="w-5 h-5" />} accent="primary" />
        <StatCard label="منتجات تحت الحد" value={lowStock} icon={<AlertTriangle className="w-5 h-5" />} accent="warning" />
        <StatCard label="شحنات اليوم" value={shipmentsToday} icon={<Package className="w-5 h-5" />} accent="secondary" />
      </div>

      <div className="card-elevated p-5 mb-6">
        <h3 className="font-bold mb-4">مقارنة أداء الفروع</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" />
              <YAxis stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} name="المبيعات" />
              <Bar dataKey="profit" fill="hsl(var(--secondary))" radius={[6, 6, 0, 0]} name="الربح" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <h3 className="font-bold mb-3">ملخص الفروع</h3>
          <DataTable
            loading={loading}
            rows={branchSummary}
            columns={[
              { key: "name", header: "الفرع" },
              { key: "sales", header: "المبيعات", render: (r: any) => formatEGP(r.sales) },
              { key: "expenses", header: "المصروفات", render: (r: any) => formatEGP(r.expenses) },
              { key: "profit", header: "الربح", render: (r: any) => <span className={r.profit >= 0 ? "text-success" : "text-destructive"}>{formatEGP(r.profit)}</span> },
              { key: "treasury", header: "الخزنة", render: (r: any) => formatEGP(r.treasury) },
            ]}
          />
        </div>

        <div>
          <h3 className="font-bold mb-3">آخر الفواتير</h3>
          <DataTable
            loading={loading}
            rows={recent}
            columns={[
              { key: "invoice_number", header: "رقم" },
              { key: "branch", header: "الفرع", render: (r: any) => r.branches?.name ?? "—" },
              { key: "total", header: "المبلغ", render: (r: any) => formatEGP(r.total) },
              { key: "created_at", header: "الوقت", render: (r: any) => formatDateTime(r.created_at) },
            ]}
          />
        </div>
      </div>
    </AdminLayout>
  );
}
