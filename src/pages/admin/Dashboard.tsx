import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { StatCard } from "@/components/StatCard";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDateTime } from "@/lib/format";
import { DollarSign, Wallet, AlertTriangle, Package, Trash2, Plus, Users, Boxes, Receipt, CheckSquare, BarChart3, Building2, ShoppingCart, PackagePlus, ArrowRightLeft, ArrowUpRight, HandCoins } from "lucide-react";
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

  const load = useCallback(async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    const [{ data: invToday }, { data: trAll }, { data: prods }, { data: shipsToday }, { data: branches }, { data: recentInv }] =
      await Promise.all([
        supabase.from("invoices").select("total").eq("status", "active").gte("created_at", todayIso),
        supabase.from("vouchers" as any).select("type, amount, branch_id").eq("status", "active"),
        supabase.from("products").select("quantity, low_stock_alert"),
        supabase.from("shipments").select("id").gte("created_at", todayIso),
        supabase.from("branches").select("*").eq("is_active", true),
        supabase.from("invoices").select("*, branches(name)").order("created_at", { ascending: false }).limit(10),
      ]);

    setSalesToday((invToday ?? []).reduce((s, x) => s + Number(x.total), 0));
    setTreasury((trAll ?? []).reduce((s, x: any) => s + (x.type === "receipt" ? 1 : -1) * Number(x.amount), 0));
    setLowStock((prods ?? []).filter((p) => p.quantity <= p.low_stock_alert).length);
    setShipmentsToday((shipsToday ?? []).length);
    setRecent(recentInv ?? []);

    const summary = await Promise.all(
      (branches ?? []).map(async (b) => {
        const [{ data: sales }, { data: exp }, { data: tr }] = await Promise.all([
          supabase.from("invoices").select("total").eq("branch_id", b.id).eq("status", "active"),
          supabase.from("vouchers").select("amount").eq("branch_id", b.id).eq("type", "payment").eq("status", "active"),
          supabase.from("vouchers" as any).select("type, amount").eq("branch_id", b.id).eq("status", "active"),
        ]);
        const totalSales = (sales ?? []).reduce((s, x) => s + Number(x.total), 0);
        const totalExp = (exp ?? []).reduce((s, x) => s + Number(x.amount), 0);
        const trBal = (tr ?? []).reduce((s, x: any) => s + (x.type === "receipt" ? 1 : -1) * Number(x.amount), 0);
        return { ...b, sales: totalSales, expenses: totalExp, profit: totalSales - totalExp, treasury: trBal };
      })
    );
    setBranchSummary(summary);
    setChartData(summary.map((s) => ({ name: s.name, sales: s.sales, profit: s.profit })));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Lazy overdue check on dashboard mount (fire-and-forget)
    (async () => { try { await supabase.rpc("mark_overdue_installments" as any); } catch {} })();
  }, []);
  useRealtimeRefresh(
    ["invoices", "treasury", "products", "shipments", "branches", "vouchers"],
    load
  );

  return (
    <AdminLayout>
      <PageHeader title="لوحة التحكم العامة" subtitle="نظرة شاملة على كل الفروع"
        actions={
          <Button asChild variant="destructive" size="sm" className="gap-2">
            <Link to="/admin/settings#reset"><Trash2 className="w-4 h-4" /> إعادة تعيين بيانات الشركة</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="مبيعات اليوم" value={formatEGP(salesToday)} icon={<DollarSign className="w-5 h-5" />} accent="success" />
        <StatCard label="رصيد الخزن" value={formatEGP(treasury)} icon={<Wallet className="w-5 h-5" />} accent="primary" />
        <StatCard label="منتجات تحت الحد" value={lowStock} icon={<AlertTriangle className="w-5 h-5" />} accent="warning" />
        <StatCard label="شحنات اليوم" value={shipmentsToday} icon={<Package className="w-5 h-5" />} accent="secondary" />
      </div>

      {/* General company-level quick actions */}
      <div className="card-elevated p-4 mb-6">
        <h3 className="font-bold mb-3 text-sm text-muted-foreground">إجراءات سريعة — على مستوى الشركة</h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { to: "/admin/branches", label: "إضافة فرع", icon: Plus, color: "text-primary", bg: "bg-primary/10" },
            { to: "/admin/employees", label: "الموظفين", icon: Users, color: "text-secondary", bg: "bg-secondary/10" },
            { to: "/admin/catalog", label: "الكتالوج", icon: Boxes, color: "text-primary", bg: "bg-primary/10" },
            { to: "/admin/vouchers", label: "كل السندات", icon: Receipt, color: "text-success", bg: "bg-success/10" },
            { to: "/admin/approvals", label: "الموافقات", icon: CheckSquare, color: "text-warning", bg: "bg-warning/10" },
            { to: "/admin/receivables", label: "المديونيات", icon: HandCoins, color: "text-destructive", bg: "bg-destructive/10" },
            { to: "/admin/reports", label: "التقارير", icon: BarChart3, color: "text-primary", bg: "bg-primary/10" },
          ].map((s) => (
            <Link key={s.label} to={s.to}
              className="flex flex-col items-center gap-2 p-3 rounded-lg border border-border hover:border-primary hover:shadow-md transition-all group">
              <div className={`w-11 h-11 rounded-full ${s.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
              <span className="text-[11px] font-semibold text-center leading-tight">{s.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Branch cards with direct shortcuts */}
      <div className="mb-6">
        <h3 className="font-bold mb-3 text-sm text-muted-foreground">الفروع — دخول مباشر</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {branchSummary.map((b: any) => (
            <div key={b.id} className="card-elevated p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold">{b.name}</div>
                    <div className="text-xs text-muted-foreground">{b.code ?? ""}</div>
                  </div>
                </div>
                <Button asChild size="sm" variant="outline" className="gap-1">
                  <Link to={`/branch/${b.id}/dashboard`}>دخول <ArrowUpRight className="w-3 h-3" /></Link>
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center justify-between p-2 rounded bg-surface-2">
                  <span className="text-muted-foreground">مبيعات</span>
                  <b className="text-success">{formatEGP(b.sales)}</b>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-surface-2">
                  <span className="text-muted-foreground">الخزنة</span>
                  <b>{formatEGP(b.treasury)}</b>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {[
                  { to: `/branch/${b.id}/sales/new`, label: "بيع", icon: ShoppingCart, color: "text-success", bg: "bg-success/10" },
                  { to: `/branch/${b.id}/shipments/new`, label: "شراء", icon: PackagePlus, color: "text-primary", bg: "bg-primary/10" },
                  { to: `/branch/${b.id}/treasury`, label: "خزنة", icon: Wallet, color: "text-primary", bg: "bg-primary/10" },
                  { to: `/branch/${b.id}/transfers`, label: "تحويل", icon: ArrowRightLeft, color: "text-warning", bg: "bg-warning/10" },
                  { to: `/branch/${b.id}/reports`, label: "تقارير", icon: BarChart3, color: "text-secondary", bg: "bg-secondary/10" },
                ].map((q) => (
                  <Link key={q.label} to={q.to}
                    className="flex flex-col items-center gap-1 p-1.5 rounded border border-border hover:border-primary hover:shadow-sm transition-all">
                    <div className={`w-7 h-7 rounded-full ${q.bg} flex items-center justify-center`}>
                      <q.icon className={`w-3.5 h-3.5 ${q.color}`} />
                    </div>
                    <span className="text-[10px] font-semibold">{q.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
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
