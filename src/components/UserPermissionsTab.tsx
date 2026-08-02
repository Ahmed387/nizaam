import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import {
  BRANCH_PERMISSION_GROUPS,
  ADMIN_NAV_PERMISSION_GROUPS,
  ADMIN_SUBSECTION_PERMISSION_GROUPS,
  USER_PERMISSION_GROUPS,
} from "@/lib/roles";

type Tri = "default" | "allow" | "deny";

const ACTION_LABELS: Record<string, string> = { view: "عرض", create: "إنشاء", update: "تعديل", delete: "حذف" };

const SECTIONS = [
  { title: "صفحات الفرع والعمليات", groups: BRANCH_PERMISSION_GROUPS },
  { title: "قائمة الإدارة الجانبية", groups: ADMIN_NAV_PERMISSION_GROUPS },
  { title: "الأقسام الفرعية داخل الصفحات (التبويبات)", groups: ADMIN_SUBSECTION_PERMISSION_GROUPS },
];

export function UserPermissionsTab() {
  const { tenantId } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [rolesByUser, setRolesByUser] = useState<Record<string, string[]>>({});
  const [branchesByUser, setBranchesByUser] = useState<Record<string, string[]>>({});
  const [userId, setUserId] = useState<string>("");
  const [state, setState] = useState<Record<string, Tri>>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      setLoading(true);
      const [{ data: profs }, { data: roles }, { data: bu }] = await Promise.all([
        supabase.from("profiles").select("id, name, username").eq("tenant_id", tenantId).order("name"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("branch_users").select("user_id, branches(name)"),
      ]);
      setUsers(profs ?? []);
      const rmap: Record<string, string[]> = {};
      (roles ?? []).forEach((r: any) => { (rmap[r.user_id] = rmap[r.user_id] || []).push(r.role); });
      setRolesByUser(rmap);
      const bmap: Record<string, string[]> = {};
      (bu ?? []).forEach((r: any) => {
        if (r.branches?.name) (bmap[r.user_id] = bmap[r.user_id] || []).push(r.branches.name);
      });
      setBranchesByUser(bmap);
      setLoading(false);
    })();
  }, [tenantId]);

  useEffect(() => {
    if (!userId) { setState({}); return; }
    supabase
      .from("user_permissions" as any)
      .select("permission_key, allowed")
      .eq("user_id", userId)
      .then(({ data }) => {
        const s: Record<string, Tri> = {};
        (data ?? []).forEach((r: any) => { s[r.permission_key] = r.allowed ? "allow" : "deny"; });
        setState(s);
      });
  }, [userId]);

  const filteredSections = useMemo(() => {
    const term = q.trim();
    if (!term) return SECTIONS;
    return SECTIONS.map((s) => ({ ...s, groups: s.groups.filter((g) => g.label.includes(term)) })).filter((s) => s.groups.length);
  }, [q]);

  const set = (key: string, v: Tri) => setState((p) => ({ ...p, [key]: v }));

  const save = async () => {
    if (!tenantId || !userId) return;
    setSaving(true);
    const upserts: any[] = [];
    const removals: string[] = [];
    USER_PERMISSION_GROUPS.forEach((g) =>
      g.actions.forEach((a) => {
        const key = `${g.key}.${a}`;
        const v = state[key] ?? "default";
        if (v === "default") removals.push(key);
        else upserts.push({ tenant_id: tenantId, user_id: userId, permission_key: key, allowed: v === "allow" });
      }),
    );
    let error: any = null;
    if (removals.length) {
      const r = await supabase.from("user_permissions" as any).delete().eq("user_id", userId).in("permission_key", removals);
      error = r.error;
    }
    if (!error && upserts.length) {
      const r = await supabase.from("user_permissions" as any).upsert(upserts, { onConflict: "tenant_id,user_id,permission_key" });
      error = r.error;
    }
    setSaving(false);
    if (error) toast.error("فشل الحفظ: " + error.message);
    else toast.success("تم حفظ صلاحيات المستخدم");
  };

  if (loading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <Card dir="rtl" className="text-right">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>صلاحيات موظف بعينه</CardTitle>
        <Button onClick={save} disabled={!userId || saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Save className="w-4 h-4 ml-1" />} حفظ
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs bg-primary/10 border border-primary/30 rounded p-2">
          💡 هنا تقدر تدي موظف معيّن صلاحية إضافية أو تمنعه من قسم فرعي جوه صفحة (زي تبويب معيّن في التقارير).
          الاستثناء ده بيتفوّق على صلاحيات الدور. أما <b>الفروع اللي يشوفها</b> فبتتحدد من الفروع المربوطة بالموظف
          (صفحة الموظفين ← الفروع المسموح بها) — والصفحات المركزية بتفلتر تلقائيًا على فروعه بس.
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <div className="text-sm mb-1">الموظف</div>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue placeholder="اختر موظف" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name || u.username || u.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-sm mb-1">بحث في الصلاحيات</div>
            <div className="relative">
              <Search className="w-4 h-4 absolute top-3 right-2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم القسم..." className="pr-8" />
            </div>
          </div>
        </div>

        {userId && (
          <div className="flex flex-wrap gap-2 text-xs">
            {(rolesByUser[userId] ?? []).map((r) => <Badge key={r} variant="secondary">{r}</Badge>)}
            {(branchesByUser[userId] ?? []).length > 0
              ? (branchesByUser[userId] ?? []).map((b) => <Badge key={b} variant="outline">🏬 {b}</Badge>)
              : <Badge variant="outline">🏬 كل الفروع / غير مربوط</Badge>}
          </div>
        )}

        {!userId ? (
          <div className="text-sm text-muted-foreground py-8 text-center">اختر موظف عشان تظهر صلاحياته.</div>
        ) : (
          <div className="space-y-6">
            {filteredSections.map((sec) => (
              <div key={sec.title}>
                <div className="font-bold mb-2">{sec.title}</div>
                <div className="space-y-1">
                  {sec.groups.map((g) => (
                    <div key={g.key} className="rounded border p-2">
                      <div className="text-sm font-medium mb-2">{g.label}</div>
                      <div className="flex flex-wrap gap-4">
                        {g.actions.map((a) => {
                          const key = `${g.key}.${a}`;
                          const v = state[key] ?? "default";
                          return (
                            <div key={key} className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground w-10">{ACTION_LABELS[a]}</span>
                              <div className="flex rounded-md overflow-hidden border">
                                {(["default", "allow", "deny"] as Tri[]).map((opt) => (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() => set(key, opt)}
                                    className={`px-2 py-1 text-xs transition-colors ${
                                      v === opt
                                        ? opt === "allow"
                                          ? "bg-primary text-primary-foreground"
                                          : opt === "deny"
                                            ? "bg-destructive text-destructive-foreground"
                                            : "bg-muted text-foreground"
                                        : "bg-background hover:bg-muted"
                                    }`}
                                  >
                                    {opt === "default" ? "افتراضي" : opt === "allow" ? "مسموح" : "ممنوع"}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setState({})}>
              <RotateCcw className="w-4 h-4 ml-1" /> رجّع الكل للافتراضي
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
