import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Building2, Users, Store, Receipt, TrendingUp, Loader2 } from "lucide-react";

interface Stats {
  tenants: number;
  activeTenants: number;
  users: number;
  branches: number;
  invoices: number;
  totalRevenue: number;
}

export default function SuperDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [t, ta, u, b, i, rev] = await Promise.all([
        supabase.from("tenants").select("*", { count: "exact", head: true }),
        supabase.from("tenants").select("*", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("branches").select("*", { count: "exact", head: true }),
        supabase.from("invoices").select("*", { count: "exact", head: true }),
        supabase.from("invoices").select("total").eq("status", "active"),
      ]);
      setStats({
        tenants: t.count ?? 0,
        activeTenants: ta.count ?? 0,
        users: u.count ?? 0,
        branches: b.count ?? 0,
        invoices: i.count ?? 0,
        totalRevenue: (rev.data ?? []).reduce((s, r: any) => s + Number(r.total ?? 0), 0),
      });
      setLoading(false);
    })();
  }, []);

  const cards = stats
    ? [
        { label: "إجمالي الشركات", value: stats.tenants, icon: Building2, sub: `${stats.activeTenants} نشطة` },
        { label: "إجمالي المستخدمين", value: stats.users, icon: Users },
        { label: "إجمالي الفروع", value: stats.branches, icon: Store },
        { label: "إجمالي الفواتير", value: stats.invoices, icon: Receipt },
        {
          label: "إجمالي المبيعات (كل المنصة)",
          value: stats.totalRevenue.toLocaleString("ar-EG", { maximumFractionDigits: 2 }) + " ج.م",
          icon: TrendingUp,
          wide: true,
        },
      ]
    : [];

  return (
    <SuperAdminLayout>
      <PageHeader title="نظرة عامة على المنصة" subtitle="إحصائيات شاملة لجميع الشركات" />
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c, i) => (
            <div key={i} className={`card-elevated p-5 ${c.wide ? "lg:col-span-2" : ""}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm text-muted-foreground">{c.label}</div>
                <div className="w-9 h-9 rounded-lg gradient-primary flex items-center justify-center">
                  <c.icon className="w-5 h-5 text-white" />
                </div>
              </div>
              <div className="text-2xl font-extrabold">{c.value}</div>
              {c.sub && <div className="text-xs text-muted-foreground mt-1">{c.sub}</div>}
            </div>
          ))}
        </div>
      )}
    </SuperAdminLayout>
  );
}
