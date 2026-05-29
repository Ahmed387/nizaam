import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/DataTable";

interface Row {
  user_id: string;
  last_login_at: string | null;
  last_seen_at: string;
  name?: string;
  username?: string;
  roles?: string[];
}

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "الآن";
  if (diff < 3600) return `منذ ${Math.floor(diff / 60)} د`;
  if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} س`;
  return `منذ ${Math.floor(diff / 86400)} يوم`;
}

function isOnline(iso: string) {
  return (Date.now() - new Date(iso).getTime()) < 3 * 60_000;
}

export default function Presence() {
  const { tenantId, isAdmin, hasRole } = useAuth();
  const allowed = isAdmin || hasRole("supervisor") || hasRole("super_admin");
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [, tick] = useState(0);

  useEffect(() => {
    const i = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(i);
  }, []);

  const load = async () => {
    if (!tenantId) return;
    const { data: pres } = await supabase
      .from("user_presence" as any)
      .select("user_id, last_login_at, last_seen_at")
      .eq("tenant_id", tenantId)
      .order("last_seen_at", { ascending: false });
    const list = (pres ?? []) as any[];
    const ids = list.map((r) => r.user_id);
    if (ids.length === 0) { setRows([]); return; }
    const [{ data: profs }, { data: ur }] = await Promise.all([
      supabase.from("profiles").select("id, name, username").in("id", ids),
      supabase.from("user_roles").select("user_id, role").in("user_id", ids),
    ]);
    const pmap = new Map((profs ?? []).map((p: any) => [p.id, p]));
    const rmap = new Map<string, string[]>();
    (ur ?? []).forEach((r: any) => {
      const arr = rmap.get(r.user_id) ?? [];
      arr.push(r.role);
      rmap.set(r.user_id, arr);
    });
    setRows(list.map((r) => ({
      ...r,
      name: pmap.get(r.user_id)?.name,
      username: pmap.get(r.user_id)?.username,
      roles: rmap.get(r.user_id) ?? [],
    })));
  };

  useEffect(() => { load(); }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`presence-${tenantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_presence", filter: `tenant_id=eq.${tenantId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.name ?? "").toLowerCase().includes(s) ||
      (r.username ?? "").toLowerCase().includes(s) ||
      (r.roles ?? []).join(",").toLowerCase().includes(s)
    );
  }, [rows, q]);

  if (!allowed) {
    return <div className="p-6">غير مصرح بالعرض.</div>;
  }

  const onlineCount = rows.filter((r) => isOnline(r.last_seen_at)).length;

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">تتبع تواجد المستخدمين</h1>
          <p className="text-muted-foreground text-sm">
            متصل الآن: <span className="font-semibold text-foreground">{onlineCount}</span> من {rows.length}
          </p>
        </div>
        <Input
          placeholder="بحث بالاسم أو الدور..."
          className="max-w-xs"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <DataTable
          columns={[
            {
              header: "الحالة",
              cell: (r: Row) => (
                <Badge variant={isOnline(r.last_seen_at) ? "default" : "secondary"}>
                  {isOnline(r.last_seen_at) ? "متصل الآن" : "غير متصل"}
                </Badge>
              ),
            },
            { header: "الاسم", cell: (r: Row) => r.name ?? "—" },
            { header: "اسم المستخدم", cell: (r: Row) => r.username ?? "—" },
            {
              header: "الدور",
              cell: (r: Row) => (r.roles?.length ? r.roles.join(", ") : "—"),
            },
            {
              header: "آخر دخول",
              cell: (r: Row) => (
                <span title={r.last_login_at ?? ""}>{timeAgo(r.last_login_at)}</span>
              ),
            },
            {
              header: "آخر ظهور",
              cell: (r: Row) => (
                <span title={r.last_seen_at}>{timeAgo(r.last_seen_at)}</span>
              ),
            },
          ]}
          rows={filtered}
          emptyMessage="لا يوجد بيانات تواجد بعد"
        />
      </Card>
    </div>
  );
}
