import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Building2, Users, Store, Receipt, TrendingUp, Loader2, AlertOctagon, CheckCircle2, Power } from "lucide-react";
import { FinancialAmount } from "@/components/FinancialAmount";
import { TenantsProfitSection } from "@/components/super/TenantsProfitSection";

interface Stats {
  tenants: number; activeTenants: number; suspendedTenants: number;
  users: number; branches: number; invoices: number; totalRevenue: number;
}

export default function SuperDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "suspended">("all");

  const load = async () => {
    const [t, u, b, i, rev] = await Promise.all([
      supabase.from("tenants").select("id, name, slug, is_suspended, suspension_reason, created_at").order("created_at", { ascending: false }),
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("branches").select("*", { count: "exact", head: true }).eq("is_system", false),
      supabase.from("invoices").select("*", { count: "exact", head: true }),
      // every active invoice of the platform (not only the first 1,000 rows) — lean column, paged by id
      fetchAllRows<{ total: number }>(() => supabase.from("invoices").select("id,total").eq("status", "active").order("id"))
        .then((data) => ({ data })).catch(() => ({ data: [] as { total: number }[] })),
    ]);
    const ts = t.data ?? [];
    setTenants(ts);
    setStats({
      tenants: ts.length,
      activeTenants: ts.filter((x: any) => !x.is_suspended).length,
      suspendedTenants: ts.filter((x: any) => x.is_suspended).length,
      users: u.count ?? 0,
      branches: b.count ?? 0,
      invoices: i.count ?? 0,
      totalRevenue: (rev.data ?? []).reduce((s, r: any) => s + Number(r.total ?? 0), 0),
    });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleSuspend = async (t: any) => {
    const suspending = !t.is_suspended;
    const { error } = await supabase.from("tenants").update({
      is_suspended: suspending,
      suspended_at: suspending ? new Date().toISOString() : null,
      suspension_reason: suspending ? (t.suspension_reason ?? null) : null,
    }).eq("id", t.id);
    if (error) return toast.error(error.message);
    toast.success(suspending ? "تم الإيقاف" : "تم التفعيل");
    load();
  };

  const cards = stats ? [
    { label: "إجمالي الشركات", value: stats.tenants, icon: Building2, sub: `${stats.activeTenants} نشطة • ${stats.suspendedTenants} موقوفة` },
    { label: "إجمالي المستخدمين", value: stats.users, icon: Users },
    { label: "إجمالي الفروع", value: stats.branches, icon: Store },
    { label: "إجمالي الفواتير", value: stats.invoices, icon: Receipt },
    { label: "إجمالي المبيعات (كل المنصة)", value: stats.totalRevenue, icon: TrendingUp, wide: true, currency: true },
  ] : [];

  const filtered = tenants.filter((t) => {
    if (filter === "active") return !t.is_suspended;
    if (filter === "suspended") return t.is_suspended;
    return true;
  });

  return (
    <SuperAdminLayout>
      <PageHeader title="نظرة عامة على المنصة" subtitle="إحصائيات شاملة لجميع الشركات" />
      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {cards.map((c, i) => (
              <div key={i} className={`card-elevated p-5 ${c.wide ? "lg:col-span-2" : ""}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm text-muted-foreground">{c.label}</div>
                  <div className="w-9 h-9 rounded-lg gradient-primary flex items-center justify-center">
                    <c.icon className="w-5 h-5 text-white" />
                  </div>
                </div>
                {c.currency ? <FinancialAmount value={c.value} size="lg" className="justify-start font-extrabold" /> : <div className="text-2xl font-extrabold">{c.value}</div>}
                {c.sub && <div className="text-xs text-muted-foreground mt-1">{c.sub}</div>}
              </div>
            ))}
          </div>

          <TenantsProfitSection tenants={tenants} />

          <div className="card-elevated p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-bold">كل الشركات</h3>
              <div className="flex gap-1">
                {(["all", "active", "suspended"] as const).map((f) => (
                  <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
                    {f === "all" ? "الكل" : f === "active" ? "النشطة" : "الموقوفة"}
                  </Button>
                ))}
                <Button size="sm" variant="outline" asChild><Link to="/super/tenants">إدارة شاملة</Link></Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-right px-3 py-2">الشركة</th>
                    <th className="text-right px-3 py-2">تاريخ الإنشاء</th>
                    <th className="text-right px-3 py-2">الحالة</th>
                    <th className="text-right px-3 py-2">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} className="border-t">
                      <td className="px-3 py-2">
                        <div className="font-semibold">{t.name}</div>
                        <div className="text-xs text-muted-foreground" dir="ltr">{t.slug}</div>
                      </td>
                      <td className="px-3 py-2">{new Date(t.created_at).toLocaleDateString("ar-EG")}</td>
                      <td className="px-3 py-2">
                        {t.is_suspended
                          ? <Badge className="bg-destructive text-destructive-foreground"><AlertOctagon className="w-3 h-3 ml-1" /> موقوفة</Badge>
                          : <Badge className="bg-success text-success-foreground"><CheckCircle2 className="w-3 h-3 ml-1" /> نشطة</Badge>}
                      </td>
                      <td className="px-3 py-2">
                        <Button size="sm" variant={t.is_suspended ? "default" : "outline"}
                          className={t.is_suspended ? "bg-success text-success-foreground hover:bg-success/90" : "text-destructive border-destructive/40"}
                          onClick={() => toggleSuspend(t)}>
                          <Power className="w-3.5 h-3.5 ml-1" /> {t.is_suspended ? "تفعيل" : "إيقاف"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">لا توجد شركات</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </SuperAdminLayout>
  );
}
