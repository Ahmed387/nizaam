import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { PageHeader } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, User } from "lucide-react";
import { ROLE_LABELS, AppRole } from "@/lib/roles";

interface Row {
  id: string;
  name: string;
  username: string;
  tenant_id: string | null;
  is_active: boolean;
  created_at: string;
  tenants: { name: string; slug: string } | null;
  user_roles: { role: AppRole }[];
}

export default function AllUsers() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*, tenants(name, slug), user_roles(role)")
        .order("created_at", { ascending: false });
      setRows((data ?? []) as any);
      setLoading(false);
    })();
  }, []);

  const filtered = rows.filter(
    (r) =>
      r.name?.toLowerCase().includes(q.toLowerCase()) ||
      r.username?.toLowerCase().includes(q.toLowerCase()) ||
      r.tenants?.name?.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <SuperAdminLayout>
      <PageHeader title="كل مستخدمي المنصة" subtitle={`${rows.length} مستخدم`} />

      <div className="card-elevated p-4 mb-4">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث بالاسم، المستخدم، أو الشركة..."
            className="pr-10"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="card-elevated overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-right p-3">المستخدم</th>
                  <th className="text-right p-3">الشركة</th>
                  <th className="text-right p-3">الأدوار</th>
                  <th className="text-right p-3">الحالة</th>
                  <th className="text-right p-3">تاريخ الإنشاء</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-border/40 hover:bg-muted/20">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center">
                          <User className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground" dir="ltr">{r.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      {r.tenants ? (
                        <div>
                          <div className="font-medium">{r.tenants.name}</div>
                          <div className="text-xs text-muted-foreground" dir="ltr">{r.tenants.slug}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">— بدون شركة —</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-1 flex-wrap">
                        {(r.user_roles ?? []).map((ur, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {ROLE_LABELS[ur.role] ?? ur.role}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge variant={r.is_active ? "default" : "secondary"}>
                        {r.is_active ? "نشط" : "معطل"}
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground text-xs">
                      {new Date(r.created_at).toLocaleDateString("ar-EG")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">لا توجد نتائج</div>
            )}
          </div>
        </div>
      )}
    </SuperAdminLayout>
  );
}
