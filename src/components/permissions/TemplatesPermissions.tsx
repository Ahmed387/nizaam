import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, RotateCcw, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AppRole, DEFAULT_ROLE_PERMISSIONS, MANAGED_ROLES, PERMISSION_GROUPS, ROLE_LABELS, checkPermission } from "@/lib/roles";
import { CatalogPage } from "@/lib/permissionCatalog";
import { Overrides, RolePerms, allowAllPage, effective, pageKeys, resetPage, setOverride } from "@/lib/permissionModel";
import { rpcErrorText } from "@/lib/rpcError";
import { PermissionEditor } from "./PermissionEditor";

type Template = { id: string; name: string; base_role: string; perms: Overrides };
type Selected = { kind: "role"; role: string } | { kind: "custom"; id: string };

/** A key the role's own matrix stores (page actions of the old matrix); parts / tabs are stored only when set. */
const MATRIX_KEYS = PERMISSION_GROUPS.flatMap((g) => g.actions.map((a) => `${g.key}.${a}`));

export function TemplatesPermissions() {
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rolePerms, setRolePerms] = useState<RolePerms>({});
  const [draft, setDraft] = useState<RolePerms>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tplDraft, setTplDraft] = useState<Record<string, Template>>({});
  const [usersByRole, setUsersByRole] = useState<Record<string, number>>({});
  const [sel, setSel] = useState<Selected>({ kind: "role", role: MANAGED_ROLES[0] });
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBase, setNewBase] = useState<string>("cashier");

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const [rp, tpl, ur] = await Promise.all([
      supabase.from("role_permissions" as any).select("role, permission_key, allowed").eq("tenant_id", tenantId),
      supabase.from("permission_templates" as any).select("id, name, base_role, perms").order("name"),
      supabase.from("user_roles").select("role").eq("tenant_id", tenantId),
    ]);
    const map: RolePerms = {};
    MANAGED_ROLES.forEach((r) => (map[r] = { ...(DEFAULT_ROLE_PERMISSIONS[r] ?? {}) }));
    const stored = new Set<string>();
    ((rp.data ?? []) as any[]).forEach((row) => {
      if (!stored.has(row.role)) { stored.add(row.role); map[row.role] = {}; }
      map[row.role][row.permission_key] = !!row.allowed;
    });
    MANAGED_ROLES.forEach((r) => { if (!stored.has(r)) map[r] = { ...(DEFAULT_ROLE_PERMISSIONS[r] ?? {}) }; });
    const counts: Record<string, number> = {};
    ((ur.data ?? []) as any[]).forEach((x) => (counts[x.role] = (counts[x.role] ?? 0) + 1));
    const t = ((tpl.data ?? []) as any[]).map((x) => ({ ...x, perms: x.perms ?? {} })) as Template[];
    setRolePerms(map); setDraft(JSON.parse(JSON.stringify(map)));
    setTemplates(t); setTplDraft(Object.fromEntries(t.map((x) => [x.id, JSON.parse(JSON.stringify(x))])));
    setUsersByRole(counts);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId]);

  const roleBind = (role: string) => {
    const map = draft[role] ?? {};
    const def = (k: string) => checkPermission([role as AppRole], { [role]: DEFAULT_ROLE_PERMISSIONS[role] ?? {} }, k, {});
    const get = (k: string) => checkPermission([role as AppRole], { [role]: map }, k, {});
    const put = (next: Record<string, boolean>) => setDraft((d) => ({ ...d, [role]: next }));
    const setKey = (m: Record<string, boolean>, k: string, v: boolean) => {
      const n = { ...m };
      if (MATRIX_KEYS.includes(k)) n[k] = v;
      else {
        // parts / tabs: store only when different from what they inherit
        delete n[k];
        if (checkPermission([role as AppRole], { [role]: n }, k, {}) !== v) n[k] = v;
      }
      return n;
    };
    return {
      resetWord: "الافتراضي",
      get,
      changed: (k: string) => get(k) !== def(k),
      set: (k: string, v: boolean) => put(setKey(map, k, v)),
      resetPage: (p: CatalogPage) => {
        let n = { ...map };
        pageKeys(p).forEach((k) => {
          if (MATRIX_KEYS.includes(k)) n[k] = (DEFAULT_ROLE_PERMISSIONS[role] ?? {})[k] === true;
          else delete n[k];
        });
        put(n);
      },
      allowAll: (p: CatalogPage) => { let n = { ...map }; pageKeys(p).forEach((k) => { n = setKey(n, k, true); }); put(n); },
    };
  };

  const customBind = (id: string) => {
    const t = tplDraft[id];
    const put = (perms: Overrides) => setTplDraft((d) => ({ ...d, [id]: { ...d[id], perms } }));
    return {
      resetWord: "الدور",
      get: (k: string) => effective(t.base_role, rolePerms, t.perms, k),
      changed: (k: string) => k in t.perms,
      set: (k: string, v: boolean) => put(setOverride(t.base_role, rolePerms, t.perms, k, v)),
      resetPage: (p: CatalogPage) => put(resetPage(p, t.perms)),
      allowAll: (p: CatalogPage) => put(allowAllPage(t.base_role, rolePerms, p, t.perms)),
    };
  };

  const dirty = useMemo(() => {
    if (sel.kind === "role") return JSON.stringify(draft[sel.role] ?? {}) !== JSON.stringify(rolePerms[sel.role] ?? {});
    return JSON.stringify(tplDraft[sel.id]) !== JSON.stringify(templates.find((t) => t.id === sel.id));
  }, [sel, draft, rolePerms, tplDraft, templates]);

  const saveRole = async (role: string) => {
    if (!tenantId) return;
    setSaving(true);
    const map = draft[role] ?? {};
    const rows = Array.from(new Set([...MATRIX_KEYS, ...Object.keys(map)])).map((k) => ({ tenant_id: tenantId, role, permission_key: k, allowed: !!map[k] }));
    const { error } = await supabase.from("role_permissions" as any).upsert(rows, { onConflict: "tenant_id,role,permission_key" });
    // parts / tabs that went back to «follow the page» lose their stored row
    const dropped = Object.keys(rolePerms[role] ?? {}).filter((k) => !MATRIX_KEYS.includes(k) && !(k in map));
    const del = !error && dropped.length
      ? await supabase.from("role_permissions" as any).delete().eq("tenant_id", tenantId).eq("role", role).in("permission_key", dropped)
      : { error: null };
    setSaving(false);
    if (error || del.error) return toast.error(rpcErrorText((error ?? del.error) as any, "حفظ القالب"));
    toast.success(`اتحفظ قالب «${ROLE_LABELS[role as AppRole]}» — بيتطبق على كل الموظفين اللي بالدور ده`);
    load();
  };

  const saveCustom = async (id: string) => {
    const t = tplDraft[id];
    setSaving(true);
    const { error } = await supabase.from("permission_templates" as any).update({ perms: t.perms, base_role: t.base_role, name: t.name, updated_at: new Date().toISOString() } as any).eq("id", id);
    setSaving(false);
    if (error) return toast.error(rpcErrorText(error as any, "حفظ القالب"));
    toast.success(`اتحفظ قالب «${t.name}»`);
    load();
  };

  const removeCustom = async (id: string) => {
    const { error } = await supabase.from("permission_templates" as any).delete().eq("id", id);
    if (error) return toast.error(rpcErrorText(error as any, "حذف القالب"));
    toast.success("اتمسح القالب — الموظفين اللي اتطبّق عليهم بيفضلوا بصلاحياتهم");
    setSel({ kind: "role", role: MANAGED_ROLES[0] });
    load();
  };

  const createCustom = async () => {
    if (!tenantId || !newName.trim()) return;
    const { data, error } = await supabase.from("permission_templates" as any).insert({ tenant_id: tenantId, name: newName.trim(), base_role: newBase, perms: {} } as any).select("id").single();
    if (error) return toast.error(rpcErrorText(error as any, "قالب جديد"));
    setNewOpen(false); setNewName("");
    await load();
    setSel({ kind: "custom", id: (data as any).id });
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  const title = sel.kind === "role" ? `قالب «${ROLE_LABELS[sel.role as AppRole]}»` : `قالب «${tplDraft[sel.id]?.name}»`;

  return (
    <div dir="rtl" className="flex flex-wrap gap-4 items-start">
      <aside aria-label="القوالب" className="flex-[1_1_240px] max-w-[300px] rounded-xl border bg-card p-3 space-y-1">
        <div className="text-xs font-bold text-muted-foreground px-1 pb-1">الأدوار الأساسية</div>
        {MANAGED_ROLES.map((r) => {
          const on = sel.kind === "role" && sel.role === r;
          return (
            <button key={r} type="button" aria-current={on} onClick={() => setSel({ kind: "role", role: r })}
              className={`w-full flex justify-between items-center gap-2 rounded-lg p-2.5 text-right border ${on ? "bg-primary/10 border-primary/40" : "border-transparent hover:bg-muted/50"}`}>
              <span className="font-bold text-sm">{ROLE_LABELS[r]}</span>
              <span className="text-xs text-muted-foreground shrink-0">{usersByRole[r] ? `${usersByRole[r]} موظف` : "مفيش"}</span>
            </button>
          );
        })}
        <div className="text-xs font-bold text-muted-foreground px-1 pt-3 pb-1">قوالبك</div>
        {templates.map((t) => {
          const on = sel.kind === "custom" && sel.id === t.id;
          return (
            <button key={t.id} type="button" aria-current={on} onClick={() => setSel({ kind: "custom", id: t.id })}
              className={`w-full flex justify-between items-center gap-2 rounded-lg p-2.5 text-right border ${on ? "bg-primary/10 border-primary/40" : "border-transparent hover:bg-muted/50"}`}>
              <span className="font-bold text-sm">{t.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">من {ROLE_LABELS[t.base_role as AppRole] ?? t.base_role}</span>
            </button>
          );
        })}
        {!templates.length && <div className="text-xs text-muted-foreground px-1">لسه مفيش. اعمل واحد من هنا أو من «احفظه كقالب» عند أي موظف.</div>}
        <Button variant="outline" size="sm" className="w-full mt-2 border-dashed" onClick={() => setNewOpen(true)}><Plus className="w-4 h-4 ml-1" /> قالب جديد</Button>
      </aside>

      <main className="flex-[999_1_600px] min-w-0 space-y-3">
        <section className="rounded-xl border bg-card p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px]">
            <div className="text-xl font-extrabold">{title}</div>
            <div className="text-xs text-muted-foreground">
              {sel.kind === "role"
                ? "أي تغيير هنا بيتطبق على كل الموظفين اللي بالدور ده، ماعدا الحاجات اللي متعدّلة للموظف نفسه."
                : "قالب من عندك: دور أساسي ومعاه اختلافات. لما تطبّقه على موظف بياخد الدور والاختلافات دي."}
            </div>
          </div>
          {sel.kind === "role" ? (
            <Button variant="outline" size="sm" onClick={() => setDraft((d) => ({ ...d, [sel.role]: { ...(DEFAULT_ROLE_PERMISSIONS[sel.role] ?? {}) } }))}><RotateCcw className="w-4 h-4 ml-1" /> رجّع القالب للأصل</Button>
          ) : (
            <>
              <Select value={tplDraft[sel.id]?.base_role} onValueChange={(v) => setTplDraft((d) => ({ ...d, [sel.id]: { ...d[sel.id], base_role: v } }))}>
                <SelectTrigger className="w-44" aria-label="الدور الأساسي"><SelectValue /></SelectTrigger>
                <SelectContent>{MANAGED_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => removeCustom(sel.id)}><Trash2 className="w-4 h-4 ml-1" /> امسح القالب</Button>
            </>
          )}
          <Button size="sm" disabled={saving || !dirty} onClick={() => (sel.kind === "role" ? saveRole(sel.role) : saveCustom(sel.id))}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Save className="w-4 h-4 ml-1" />} حفظ القالب
          </Button>
        </section>
        {sel.kind === "role" && (
          <div className="text-xs rounded-lg border border-primary/30 bg-primary/5 p-2.5 leading-relaxed">
            <b>ملاحظ</b>: دوره متابعة الحضور والانصراف بس. <b>مراقب (Viewer)</b>: بيشوف كل بيانات الشركة قراية بس، من غير تعديل.
            أما <b>الفروع</b> اللي الموظف يشتغل فيها فبتتحدد عند الموظف نفسه، مش في القالب.
          </div>
        )}
        <PermissionEditor bind={sel.kind === "role" ? roleBind(sel.role) : customBind(sel.id)} />
      </main>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>قالب جديد</DialogTitle>
            <DialogDescription>القالب بيبدأ من دور أساسي، وبعدين تقفل وتفتح فيه اللي انت عاوزه.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor="new-tpl">اسم القالب</Label><Input id="new-tpl" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} placeholder="مثلاً: كاشير الفترة المسائية" /></div>
            <div className="space-y-1">
              <Label htmlFor="new-base">بيبدأ من دور</Label>
              <Select value={newBase} onValueChange={setNewBase}>
                <SelectTrigger id="new-base"><SelectValue /></SelectTrigger>
                <SelectContent>{MANAGED_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>إلغاء</Button>
            <Button onClick={createCustom} disabled={!newName.trim()}>اعمل القالب</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
