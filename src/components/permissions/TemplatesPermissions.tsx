import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, RotateCcw, Plus, Trash2, Eye, EyeOff, Pencil } from "lucide-react";
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
import { isTplRole, tplId, tplRole } from "@/lib/companyRoles";
import { useSearchParams } from "react-router-dom";

type Template = { id: string; name: string; base_role: string; perms: Overrides };
type Selected = { kind: "role"; role: string } | { kind: "custom"; id: string };

/** A key the role's own matrix stores (page actions of the old matrix); parts / tabs are stored only when set. */
const MATRIX_KEYS = PERMISSION_GROUPS.flatMap((g) => g.actions.map((a) => `${g.key}.${a}`));

export function TemplatesPermissions() {
  const { tenantId, roleLabel, roleSettings, refresh, branches } = useAuth();
  const [params] = useSearchParams();
  // «افتح الصفحة وظبطها» for a whole role: the real page with ?perm_role=… (a branch page opens in the first branch)
  const roleHref = (role: string) => (p: CatalogPage) => {
    if (!p.route) return null;
    const b = branches[0]?.id;
    if (p.route.includes(":branch") && !b) return null;
    return `${p.route.replace(":branch", b ?? "")}?perm_role=${encodeURIComponent(role)}`;
  };
  const hidden = new Set(roleSettings.filter((x) => x.hidden).map((x) => x.role));
  const [usersByTpl, setUsersByTpl] = useState<Record<string, number>>({});
  const [renameOpen, setRenameOpen] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [delOpen, setDelOpen] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rolePerms, setRolePerms] = useState<RolePerms>({});
  const [draft, setDraft] = useState<RolePerms>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tplDraft, setTplDraft] = useState<Record<string, Template>>({});
  const [usersByRole, setUsersByRole] = useState<Record<string, number>>({});
  const initial = params.get("role");
  const [sel, setSel] = useState<Selected>(initial ? (isTplRole(initial) ? { kind: "custom", id: tplId(initial) } : { kind: "role", role: initial }) : { kind: "role", role: MANAGED_ROLES[0] });
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBase, setNewBase] = useState<string>("cashier");

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const [rp, tpl, ur, ucr] = await Promise.all([
      supabase.from("role_permissions" as any).select("role, permission_key, allowed").eq("tenant_id", tenantId),
      supabase.from("permission_templates" as any).select("id, name, base_role, perms").order("name"),
      supabase.from("user_roles").select("user_id, role").eq("tenant_id", tenantId),
      supabase.from("user_company_roles" as any).select("user_id, template_id").eq("tenant_id", tenantId),
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
    const tcounts: Record<string, number> = {};
    (((ucr as any).data ?? []) as any[]).forEach((x) => (tcounts[x.template_id] = (tcounts[x.template_id] ?? 0) + 1));
    setUsersByTpl(tcounts);
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
      customizeHref: roleHref(role),
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
      customizeHref: roleHref(tplRole(id)),
      get: (k: string) => effective([t.base_role], rolePerms, t.perms, k),
      changed: (k: string) => k in t.perms,
      set: (k: string, v: boolean) => put(setOverride([t.base_role], rolePerms, t.perms, k, v)),
      resetPage: (p: CatalogPage) => put(resetPage(p, t.perms)),
      allowAll: (p: CatalogPage) => put(allowAllPage([t.base_role], rolePerms, p, t.perms)),
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
    if (error || del.error) return toast.error(rpcErrorText((error ?? del.error) as any, "حفظ الدور"));
    toast.success(`اتحفظ دور «${roleLabel(role)}» — بيتطبق على كل الموظفين اللي عليه`);
    load();
  };

  const saveCustom = async (id: string) => {
    const t = tplDraft[id];
    setSaving(true);
    const { error } = await supabase.from("permission_templates" as any).update({ perms: t.perms, base_role: t.base_role, name: t.name, updated_at: new Date().toISOString() } as any).eq("id", id);
    setSaving(false);
    if (error) return toast.error(rpcErrorText(error as any, "حفظ الدور"));
    toast.success(`اتحفظ دور «${t.name}» — وصل لكل اللي عليه`);
    load();
  };

  // delete a company role: its employees move first (delete_company_role, migration 0115)
  const removeCustom = async (id: string) => {
    const n = usersByTpl[id] ?? 0;
    const args: any = { p_template: id, p_move_to_template: null, p_move_to_role: null };
    if (n > 0) {
      if (!moveTo) return toast.error("اختار هتنقل موظفينه على أنهي دور");
      if (moveTo.startsWith("tpl:")) args.p_move_to_template = moveTo.slice(4); else args.p_move_to_role = moveTo;
    }
    const { error } = await supabase.rpc("delete_company_role" as any, args);
    if (error) return toast.error(rpcErrorText(error as any, "مسح الدور"));
    toast.success(n ? `اتنقل ${n} موظف واتمسح الدور` : "اتمسح الدور");
    setDelOpen(null); setMoveTo("");
    setSel({ kind: "role", role: MANAGED_ROLES[0] });
    load();
  };

  // hide / show / rename a ready role for this company (set_role_setting, migration 0115)
  const roleSetting = async (role: string, hide: boolean, label: string | null) => {
    const { error } = await supabase.rpc("set_role_setting" as any, { p_role: role, p_hidden: hide, p_label: label } as any);
    if (error) return toast.error(rpcErrorText(error as any, "إعداد الدور"));
    toast.success(hide ? `«${roleLabel(role)}» اتخفى — محدش يقدر يتعيّن عليه` : label ? `اسمه بقى «${label}»` : "اتحفظ");
    setRenameOpen(null);
    await refresh();
    load();
  };
  const labelOf = (role: string) => roleSettings.find((x) => x.role === role)?.label ?? null;

  const createCustom = async () => {
    if (!tenantId || !newName.trim()) return;
    const { data, error } = await supabase.from("permission_templates" as any).insert({ tenant_id: tenantId, name: newName.trim(), base_role: newBase, perms: {} } as any).select("id").single();
    if (error) return toast.error(rpcErrorText(error as any, "دور جديد"));
    setNewOpen(false); setNewName("");
    await load();
    setSel({ kind: "custom", id: (data as any).id });
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  const title = sel.kind === "role" ? `دور «${roleLabel(sel.role)}»` : `دور «${tplDraft[sel.id]?.name}»`;

  return (
    <div dir="rtl" className="flex flex-wrap gap-4 items-start">
      <aside aria-label="الأدوار" className="flex-[1_1_260px] max-w-[320px] rounded-xl border bg-card p-3 space-y-1">
        <div className="text-xs font-bold text-muted-foreground px-1 pb-1">الأدوار الجاهزة</div>
        {MANAGED_ROLES.map((r) => {
          const on = sel.kind === "role" && sel.role === r;
          const isHidden = hidden.has(r);
          const n = usersByRole[r] ?? 0;
          return (
            <div key={r} className={`flex items-center gap-1 rounded-lg border ${on ? "bg-primary/10 border-primary/40" : "border-transparent hover:bg-muted/50"} ${isHidden ? "opacity-60" : ""}`}>
              <button type="button" aria-current={on} onClick={() => setSel({ kind: "role", role: r })} className="flex-1 min-w-0 flex justify-between items-center gap-2 p-2.5 text-right">
                <span className="font-bold text-sm truncate">{roleLabel(r)}{labelOf(r) && <span className="block text-[10px] font-normal text-muted-foreground">أصله «{ROLE_LABELS[r]}»</span>}</span>
                <span className="text-xs text-muted-foreground shrink-0">{isHidden ? "مخفي" : n ? `${n} موظف` : "مفيش"}</span>
              </button>
              <button type="button" aria-label={`غيّر اسم ${roleLabel(r)}`} title="غيّر الاسم" onClick={() => { setRenameTo(labelOf(r) ?? ""); setRenameOpen(r); }}
                className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted"><Pencil className="w-3.5 h-3.5" /></button>
              {r !== "viewer" && (
                <button type="button" aria-label={`${isHidden ? "إظهار" : "إخفاء"} ${roleLabel(r)}`} title={isHidden ? "إظهار" : n ? `عليه ${n} موظف — انقلهم الأول` : "إخفاء من الشركة"}
                  onClick={() => roleSetting(r, !isHidden, labelOf(r))}
                  className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted">
                  {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          );
        })}
        <div className="text-xs font-bold text-muted-foreground px-1 pt-3 pb-1">أدوار الشركة</div>
        {templates.map((t) => {
          const on = sel.kind === "custom" && sel.id === t.id;
          const n = usersByTpl[t.id] ?? 0;
          return (
            <button key={t.id} type="button" aria-current={on} onClick={() => setSel({ kind: "custom", id: t.id })}
              className={`w-full flex justify-between items-center gap-2 rounded-lg p-2.5 text-right border ${on ? "bg-primary/10 border-primary/40" : "border-transparent hover:bg-muted/50"}`}>
              <span className="min-w-0"><span className="block font-bold text-sm truncate">{t.name}</span><span className="block text-[10px] text-muted-foreground">مبني على {roleLabel(t.base_role)}</span></span>
              <span className="text-xs text-muted-foreground shrink-0">{n ? `${n} موظف` : "مفيش"}</span>
            </button>
          );
        })}
        {!templates.length && <div className="text-xs text-muted-foreground px-1">لسه مفيش. اعمل واحد من هنا أو من «احفظه كدور جديد» عند أي موظف.</div>}
        <Button variant="outline" size="sm" className="w-full mt-2 border-dashed" onClick={() => setNewOpen(true)}><Plus className="w-4 h-4 ml-1" /> دور جديد</Button>
      </aside>

      <main className="flex-[999_1_600px] min-w-0 space-y-3">
        <section className="rounded-xl border bg-card p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px]">
            <div className="text-xl font-extrabold">{title}</div>
            <div className="text-xs text-muted-foreground">
              {sel.kind === "role"
                ? "أي تغيير هنا بيتطبق على كل الموظفين اللي بالدور ده، ماعدا الحاجات اللي متعدّلة للموظف نفسه."
                : `دور من عندك مبني على «${roleLabel(tplDraft[sel.id]?.base_role ?? "")}». أي تغيير هنا بيوصل لكل الـ ${usersByTpl[sel.id] ?? 0} موظف اللي عليه على طول، ماعدا اللي متعدّل للموظف نفسه.`}
            </div>
          </div>
          {sel.kind === "role" ? (
            <Button variant="outline" size="sm" onClick={() => setDraft((d) => ({ ...d, [sel.role]: { ...(DEFAULT_ROLE_PERMISSIONS[sel.role] ?? {}) } }))}><RotateCcw className="w-4 h-4 ml-1" /> رجّع الدور للأصل</Button>
          ) : (
            <>
              <Select value={tplDraft[sel.id]?.base_role} onValueChange={(v) => setTplDraft((d) => ({ ...d, [sel.id]: { ...d[sel.id], base_role: v } }))}>
                <SelectTrigger className="w-44" aria-label="الدور الأساسي"><SelectValue /></SelectTrigger>
                <SelectContent>{MANAGED_ROLES.filter((r) => !hidden.has(r)).map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => { setMoveTo(""); setDelOpen(sel.id); }}><Trash2 className="w-4 h-4 ml-1" /> امسح الدور</Button>
            </>
          )}
          <Button size="sm" disabled={saving || !dirty} onClick={() => (sel.kind === "role" ? saveRole(sel.role) : saveCustom(sel.id))}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Save className="w-4 h-4 ml-1" />} حفظ الدور
          </Button>
        </section>
        {sel.kind === "role" && (
          <div className="text-xs rounded-lg border border-primary/30 bg-primary/5 p-2.5 leading-relaxed">
            <b>ملاحظ</b>: دوره متابعة الحضور والانصراف بس. <b>مراقب (Viewer)</b>: بيشوف كل بيانات الشركة قراية بس، من غير تعديل.
            أما <b>الفروع</b> اللي الموظف يشتغل فيها فبتتحدد عند الموظف نفسه، مش في القالب.
          </div>
        )}
        {sel.kind === "role" ? <PermissionEditor bind={roleBind(sel.role)} />
          : tplDraft[sel.id] ? <PermissionEditor bind={customBind(sel.id)} />
          : <div className="p-6 text-sm text-muted-foreground text-center">الدور ده مش موجود — اختار دور من القايمة.</div>}
      </main>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>دور جديد</DialogTitle>
            <DialogDescription>الدور بيتبني على دور جاهز، وبعدين تقفل وتفتح فيه اللي انت عاوزه. أي موظف تحطه عليه بيمشي عليه، ولما تعدّل الدور بيتعدّل عندهم كلهم.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor="new-tpl">اسم الدور</Label><Input id="new-tpl" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} placeholder="مثلاً: مندوب مبيعات" /></div>
            <div className="space-y-1">
              <Label htmlFor="new-base">مبني على دور</Label>
              <Select value={newBase} onValueChange={setNewBase}>
                <SelectTrigger id="new-base"><SelectValue /></SelectTrigger>
                <SelectContent>{MANAGED_ROLES.filter((r) => !hidden.has(r)).map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>إلغاء</Button>
            <Button onClick={createCustom} disabled={!newName.trim()}>اعمل الدور</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameOpen} onOpenChange={(o) => !o && setRenameOpen(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>اسم الدور عندك</DialogTitle>
            <DialogDescription>الاسم بيتغير عند شركتك بس. شغل الدور وصلاحياته على السيرفر زي ما هي (أصله «{renameOpen ? ROLE_LABELS[renameOpen as AppRole] : ""}»).</DialogDescription>
          </DialogHeader>
          <div className="space-y-1"><Label htmlFor="rename-role">الاسم الجديد</Label><Input id="rename-role" value={renameTo} onChange={(e) => setRenameTo(e.target.value)} maxLength={40} placeholder="مثلاً: مسؤول المخزن" /></div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => renameOpen && roleSetting(renameOpen, hidden.has(renameOpen), null)}>رجّع الاسم الأصلي</Button>
            <Button variant="outline" onClick={() => setRenameOpen(null)}>إلغاء</Button>
            <Button onClick={() => renameOpen && roleSetting(renameOpen, hidden.has(renameOpen), renameTo.trim() || null)} disabled={!renameTo.trim()}>حفظ الاسم</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!delOpen} onOpenChange={(o) => !o && setDelOpen(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>امسح دور «{delOpen ? templates.find((t) => t.id === delOpen)?.name : ""}»</DialogTitle>
            <DialogDescription>
              {delOpen && (usersByTpl[delOpen] ?? 0) > 0
                ? `عليه ${usersByTpl[delOpen]} موظف. اختار هيتنقلوا على أنهي دور قبل ما يتمسح — محدش هيفضل من غير دور.`
                : "مفيش حد عليه. هيتمسح على طول."}
            </DialogDescription>
          </DialogHeader>
          {delOpen && (usersByTpl[delOpen] ?? 0) > 0 && (
            <Select value={moveTo} onValueChange={setMoveTo}>
              <SelectTrigger aria-label="انقلهم على"><SelectValue placeholder="انقلهم على…" /></SelectTrigger>
              <SelectContent>
                {templates.filter((t) => t.id !== delOpen).map((t) => <SelectItem key={t.id} value={tplRole(t.id)}>{t.name} (دور الشركة)</SelectItem>)}
                {MANAGED_ROLES.filter((r) => !hidden.has(r)).map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelOpen(null)}>إلغاء</Button>
            <Button variant="destructive" onClick={() => delOpen && removeCustom(delOpen)} disabled={!!delOpen && (usersByTpl[delOpen] ?? 0) > 0 && !moveTo}>امسح الدور</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
