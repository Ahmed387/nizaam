import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, Save, Copy, BookmarkPlus, RotateCcw, AlertTriangle, Search, KeyRound, Check, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AppRole, DEFAULT_ROLE_PERMISSIONS, MANAGED_ROLES, ROLE_LABELS } from "@/lib/roles";
import { CatalogPage } from "@/lib/permissionCatalog";
import {
  Overrides, RolePerms, allowAllPage, clearExtras, diffOverrides, effective, keyLabel, resetPage, setOverride, sidebarPreview, toRows,
} from "@/lib/permissionModel";
import { rpcErrorText } from "@/lib/rpcError";
import { PermissionEditor } from "./PermissionEditor";

/** Owners / admins / super admins / partners hold full company access and are never managed here. */
export const FULL_ACCESS_ROLES = ["owner", "admin", "super_admin", "partner"];

type Person = { id: string; name: string; username: string };
type Template = { id: string; name: string; base_role: string; perms: Overrides };

export function EmployeesPermissions() {
  const { tenantId } = useAuth();
  const [params, setParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<Person[]>([]);
  const [rolesByUser, setRolesByUser] = useState<Record<string, string[]>>({});
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [linksByUser, setLinksByUser] = useState<Record<string, Record<string, "manage" | "read">>>({});
  const [empByUser, setEmpByUser] = useState<Record<string, string>>({});
  const [rolePerms, setRolePerms] = useState<RolePerms>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [overrideCount, setOverrideCount] = useState<Record<string, number>>({});

  const [userId, setUserId] = useState<string>(params.get("user") ?? "");
  const [role, setRole] = useState("");
  const [links, setLinks] = useState<Record<string, "manage" | "read">>({});
  const [overrides, setOverrides] = useState<Overrides>({});
  const [saved, setSaved] = useState<{ role: string; links: string; overrides: string }>({ role: "", links: "{}", overrides: "{}" });
  const [saving, setSaving] = useState(false);
  const [who, setWho] = useState("");
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");
  const [copyRole, setCopyRole] = useState(true);
  const [copyBranches, setCopyBranches] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplName, setTplName] = useState("");
  const [showDiff, setShowDiff] = useState(false);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const [profs, roles, bu, brs, emps, rp, tpl, ups] = await Promise.all([
      supabase.from("profiles").select("id, name, username").eq("tenant_id", tenantId).order("name"),
      supabase.from("user_roles").select("user_id, role").eq("tenant_id", tenantId),
      supabase.from("branch_users").select("user_id, branch_id, access_level"),
      (supabase.from("branches") as any).select("id, name").eq("tenant_id", tenantId).eq("is_system", false).order("name"),
      supabase.from("employees").select("id, user_id").eq("tenant_id", tenantId).not("user_id", "is", null),
      supabase.from("role_permissions" as any).select("role, permission_key, allowed").eq("tenant_id", tenantId),
      supabase.from("permission_templates" as any).select("id, name, base_role, perms").order("name"),
      supabase.from("user_permissions" as any).select("user_id, permission_key, allowed").eq("tenant_id", tenantId),
    ]);
    const rmap: Record<string, string[]> = {};
    ((roles.data ?? []) as any[]).forEach((r) => (rmap[r.user_id] = [...(rmap[r.user_id] ?? []), r.role]));
    const lmap: Record<string, Record<string, "manage" | "read">> = {};
    ((bu.data ?? []) as any[]).forEach((r) => ((lmap[r.user_id] = lmap[r.user_id] ?? {})[r.branch_id] = r.access_level === "read" ? "read" : "manage"));
    const pmap: RolePerms = {};
    ((rp.data ?? []) as any[]).forEach((r) => ((pmap[r.role] = pmap[r.role] ?? {})[r.permission_key] = !!r.allowed));
    Object.entries(DEFAULT_ROLE_PERMISSIONS).forEach(([r, d]) => { if (!pmap[r]) pmap[r] = { ...d }; });
    const ocount: Record<string, number> = {};
    ((ups.data ?? []) as any[]).forEach((r) => (ocount[r.user_id] = (ocount[r.user_id] ?? 0) + 1));
    setPeople(((profs.data ?? []) as any[]).filter((u) => !(rmap[u.id] ?? []).some((r) => FULL_ACCESS_ROLES.includes(r))));
    setRolesByUser(rmap);
    setLinksByUser(lmap);
    setBranches((brs.data ?? []) as any);
    setEmpByUser(Object.fromEntries(((emps.data ?? []) as any[]).map((e) => [e.user_id, e.id])));
    setRolePerms(pmap);
    setTemplates(((tpl.data ?? []) as any[]).map((t) => ({ ...t, perms: t.perms ?? {} })));
    setOverrideCount(ocount);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId]);

  const managedRole = (uid: string) => (rolesByUser[uid] ?? []).find((r) => MANAGED_ROLES.includes(r as AppRole)) ?? "";

  const openUser = async (uid: string) => {
    setUserId(uid);
    if (!uid) return;
    const next = new URLSearchParams(params); next.set("user", uid); setParams(next, { replace: true });
    const { data, error } = await supabase.from("user_permissions" as any).select("permission_key, allowed").eq("user_id", uid);
    if (error) return toast.error("تعذر تحميل صلاحيات الموظف: " + error.message);
    const o: Overrides = Object.fromEntries(((data ?? []) as any[]).map((r) => [r.permission_key, !!r.allowed]));
    const r = managedRole(uid);
    const l = { ...(linksByUser[uid] ?? {}) };
    setRole(r); setLinks(l); setOverrides(o);
    setSaved({ role: r, links: JSON.stringify(l), overrides: JSON.stringify(o) });
  };
  useEffect(() => { if (!loading && userId) openUser(userId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [loading]);

  const dirty = !!userId && (role !== saved.role || JSON.stringify(links) !== saved.links || JSON.stringify(overrides) !== saved.overrides);
  const pick = (uid: string) => {
    if (dirty) return toast.error("فيه تغييرات مااتحفظتش — احفظها أو دوس «فضّي التغييرات» الأول");
    openUser(uid);
  };

  const unassigned = useMemo(() => people.filter((u) => managedRole(u.id) && !Object.keys(linksByUser[u.id] ?? {}).length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [people, rolesByUser, linksByUser]);
  const shown = people.filter((u) => {
    const t = who.trim();
    if (!t) return true;
    const branchNames = Object.keys(linksByUser[u.id] ?? {}).map((b) => branches.find((x) => x.id === b)?.name ?? "").join(" ");
    return (u.name ?? "").includes(t) || (u.username ?? "").includes(t) || branchNames.includes(t);
  });
  const person = people.find((p) => p.id === userId);
  const diff = useMemo(() => diffOverrides(role, rolePerms, overrides), [role, rolePerms, overrides]);
  const preview = useMemo(() => sidebarPreview(role, rolePerms, overrides), [role, rolePerms, overrides]);
  const firstBranch = Object.keys(links)[0] ?? branches[0]?.id;

  const bind = {
    resetWord: "القالب",
    get: (k: string) => effective(role, rolePerms, overrides, k),
    changed: (k: string) => k in overrides,
    set: (k: string, v: boolean) => setOverrides((o) => setOverride(role, rolePerms, o, k, v)),
    resetPage: (p: CatalogPage) => setOverrides((o) => resetPage(p, o)),
    allowAll: (p: CatalogPage) => setOverrides((o) => allowAllPage(role, rolePerms, p, o)),
    customizeHref: (p: CatalogPage) => {
      if (!p.route || !userId) return null;
      if (p.route.includes(":branch")) return firstBranch ? `${p.route.replace(":branch", firstBranch)}?perm_for=${userId}` : null;
      return `${p.route}?perm_for=${userId}`;
    },
  };

  const save = async () => {
    if (!tenantId || !userId) return;
    setSaving(true);
    try {
      // role
      const current = rolesByUser[userId] ?? [];
      if (role && !current.includes(role)) {
        const old = current.filter((r) => MANAGED_ROLES.includes(r as AppRole));
        if (old.length) {
          const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).in("role", old as any);
          if (error) throw error;
        }
        const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: role as any, tenant_id: tenantId } as any);
        if (error) throw error;
      }
      // branches + level
      const prev = linksByUser[userId] ?? {};
      const removed = Object.keys(prev).filter((b) => !(b in links));
      const added = Object.keys(links).filter((b) => !(b in prev));
      if (removed.length) {
        const { error } = await supabase.from("branch_users").delete().eq("user_id", userId).in("branch_id", removed);
        if (error) throw error;
      }
      if (added.length) {
        const { error } = await supabase.from("branch_users").insert(added.map((b) => ({ user_id: userId, branch_id: b, tenant_id: tenantId, access_level: links[b] })) as any);
        if (error) throw error;
      }
      for (const b of Object.keys(links).filter((x) => x in prev && prev[x] !== links[x])) {
        const { error } = await supabase.from("branch_users").update({ access_level: links[b] } as any).eq("user_id", userId).eq("branch_id", b);
        if (error) throw error;
      }
      // overrides: one transaction on the server (migration 0114)
      const { error } = await supabase.rpc("save_user_permissions" as any, { p_user: userId, p_rows: toRows(overrides) } as any);
      if (error) throw error;
      toast.success(`اتحفظ — ${Object.keys(overrides).length} اختلاف عن قالب «${ROLE_LABELS[role as AppRole] ?? role}»`);
      setSaved({ role, links: JSON.stringify(links), overrides: JSON.stringify(overrides) });
      await load();
    } catch (e: any) {
      toast.error(rpcErrorText(e, "حفظ الصلاحيات"));
    } finally {
      setSaving(false);
    }
  };

  const doCopy = async () => {
    if (!copyFrom || !userId) return;
    const { error } = await supabase.rpc("copy_user_permissions" as any, { p_from: copyFrom, p_to: userId, p_with_role: copyRole, p_with_branches: copyBranches } as any);
    if (error) return toast.error(rpcErrorText(error, "نسخ الصلاحيات"));
    toast.success("اتنسخت الصلاحيات");
    setCopyOpen(false);
    await load();
    openUser(userId);
  };

  const saveTemplate = async () => {
    if (!tenantId || !tplName.trim() || !role) return toast.error("اكتب اسم للقالب واختار دور");
    const { error } = await supabase.from("permission_templates" as any).insert({ tenant_id: tenantId, name: tplName.trim(), base_role: role, perms: overrides } as any);
    if (error) return toast.error(rpcErrorText(error, "حفظ القالب"));
    toast.success(`اتحفظ قالب «${tplName.trim()}»`);
    setTplOpen(false); setTplName("");
    load();
  };

  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setRole(t.base_role); setOverrides({ ...t.perms });
    toast.message(`اتطبّق قالب «${t.name}» — دوس حفظ عشان يتسجل`);
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div dir="rtl" className="flex flex-wrap gap-4 items-start">
      {/* people */}
      <aside aria-label="الموظفين" className="flex-[1_1_240px] max-w-[300px] rounded-xl border bg-card p-3 space-y-2">
        <Label htmlFor="who">ابحث عن موظف</Label>
        <div className="relative">
          <Search className="w-4 h-4 absolute top-3 right-3 text-muted-foreground" aria-hidden="true" />
          <Input id="who" value={who} onChange={(e) => setWho(e.target.value)} placeholder="الاسم أو الفرع" className="pr-9" />
        </div>
        {unassigned.length > 0 && (
          <div role="alert" className="text-xs rounded-lg border border-warning/40 bg-warning/10 p-2 leading-relaxed">
            <AlertTriangle className="w-3.5 h-3.5 inline ml-1" aria-hidden="true" />
            {unassigned.length} موظف بدور شغّال ومش مربوط بأي فرع، فمش هيعرف يفتح أي شاشة فرع: <b>{unassigned.map((u) => u.name || u.username).join("، ")}</b>
          </div>
        )}
        {shown.map((u) => {
          const sel = u.id === userId;
          const r = managedRole(u.id);
          const bnames = Object.keys(linksByUser[u.id] ?? {}).map((b) => branches.find((x) => x.id === b)?.name).filter(Boolean);
          return (
            <button key={u.id} type="button" onClick={() => pick(u.id)} aria-current={sel}
              className={`w-full flex items-center gap-2 rounded-lg p-2 text-right border ${sel ? "bg-primary/10 border-primary/40" : "border-transparent hover:bg-muted/50"}`}>
              <span className="w-9 h-9 rounded-full bg-primary/10 text-primary font-extrabold flex items-center justify-center shrink-0">{(u.name || u.username || "?").slice(0, 1)}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold truncate">{u.name || u.username}</span>
                <span className="block text-xs text-muted-foreground truncate">{r ? ROLE_LABELS[r as AppRole] : "بدون دور"} · {bnames.length ? bnames.join("، ") : "مش مربوط بفرع"}</span>
              </span>
              {(overrideCount[u.id] ?? 0) > 0 && <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-warning/15 text-warning">متعدّل</span>}
            </button>
          );
        })}
        {!people.length && <div className="text-xs text-muted-foreground p-2">مفيش موظفين ينفع تتحكم في صلاحياتهم.</div>}
        <p className="text-xs text-muted-foreground leading-relaxed pt-1">المالك والمدير العام والشركاء عندهم كل حاجة، فمش بيظهروا هنا.</p>
      </aside>

      {/* the employee */}
      <main className="flex-[999_1_600px] min-w-0 space-y-3">
        {!person ? (
          <div className="rounded-xl border bg-card p-10 text-center text-muted-foreground">اختار موظف من القايمة عشان تظبط اللي يظهرله.</div>
        ) : (
          <>
            <section aria-label="بيانات الموظف" className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="text-xl font-extrabold">{person.name || person.username}</div>
                  <div className="text-xs text-muted-foreground">حساب الدخول: {person.username}</div>
                </div>
                {empByUser[person.id] && (
                  <Button asChild variant="ghost" size="sm"><Link to={`/admin/employees/${empByUser[person.id]}?tab=account`}><KeyRound className="w-4 h-4 ml-1" /> حساب الدخول</Link></Button>
                )}
                <Button variant="outline" size="sm" onClick={() => { setCopyFrom(""); setCopyOpen(true); }}><Copy className="w-4 h-4 ml-1" /> انسخ من موظف تاني</Button>
                <Button variant="outline" size="sm" onClick={() => setTplOpen(true)}><BookmarkPlus className="w-4 h-4 ml-1" /> احفظه كقالب</Button>
                <Button size="sm" onClick={save} disabled={saving || !dirty}>{saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Save className="w-4 h-4 ml-1" />} حفظ</Button>
              </div>
              <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                <div className="space-y-1">
                  <Label htmlFor="role">بيبدأ من قالب (الدور)</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger id="role"><SelectValue placeholder="اختار الدور" /></SelectTrigger>
                    <SelectContent>{MANAGED_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
                  </Select>
                  {templates.length > 0 && (
                    <Select value="" onValueChange={applyTemplate}>
                      <SelectTrigger aria-label="طبّق قالب من قوالبك"><SelectValue placeholder="أو طبّق قالب من قوالبك" /></SelectTrigger>
                      <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} ({ROLE_LABELS[t.base_role as AppRole] ?? t.base_role})</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium">الفروع اللي شغال فيها — دوس على الفرع يتربط، ودوس على المستوى يبدّل</div>
                  <div className="flex flex-wrap gap-2">
                    {branches.map((b) => {
                      const on = b.id in links;
                      const level = links[b.id] ?? "manage";
                      return (
                        <div key={b.id} className="flex items-center gap-1">
                          <button type="button" aria-pressed={on} onClick={() => setLinks((l) => { const n = { ...l }; if (on) delete n[b.id]; else n[b.id] = "manage"; return n; })}
                            className={`min-h-[36px] rounded-full border px-3 text-xs font-bold ${on ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
                            {on && <Check className="w-3 h-3 inline ml-1" aria-hidden="true" />}{b.name}
                          </button>
                          {on && (
                            <button type="button" onClick={() => setLinks((l) => ({ ...l, [b.id]: level === "manage" ? "read" : "manage" }))}
                              className={`min-h-[36px] rounded-full border px-3 text-[11px] font-bold ${level === "manage" ? "bg-success/15 text-success border-success/40" : "bg-warning/15 text-warning border-warning/40"}`}>
                              {level === "manage" ? "إدارة كاملة" : "عرض فقط"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {!branches.length && <span className="text-xs text-muted-foreground">مفيش فروع</span>}
                  </div>
                </div>
              </div>
            </section>

            {(diff.extra.length > 0 || diff.revoked.length > 0 || dirty) && (
              <div role="status" className="rounded-xl border border-warning/40 bg-warning/10 p-3 space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">مختلف عن قالب «{ROLE_LABELS[role as AppRole] ?? (role || "بدون دور")}»:</span>
                  <button type="button" className="rounded-full px-2 py-0.5 bg-success/15 text-success text-xs font-bold" onClick={() => setShowDiff((s) => !s)}>مسموح زيادة {diff.extra.length}</button>
                  <button type="button" className="rounded-full px-2 py-0.5 bg-destructive/15 text-destructive text-xs font-bold" onClick={() => setShowDiff((s) => !s)}>ممنوع استثناءً {diff.revoked.length}</button>
                  {dirty && <span className="text-xs font-bold">· فيه تغييرات لسه مااتحفظتش</span>}
                  <span className="flex-1" />
                  <Button size="sm" variant="outline" disabled={!diff.extra.length} onClick={() => setOverrides((o) => clearExtras(role, rolePerms, o))}><RotateCcw className="w-3.5 h-3.5 ml-1" /> شيل الزيادة بس</Button>
                  <Button size="sm" variant="outline" disabled={!Object.keys(overrides).length} onClick={() => setOverrides({})}><RotateCcw className="w-3.5 h-3.5 ml-1" /> رجّعه للقالب</Button>
                  <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => openUser(userId)}><Undo2 className="w-3.5 h-3.5 ml-1" /> فضّي التغييرات</Button>
                </div>
                {showDiff && (
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="space-y-1"><div className="text-xs font-bold text-success">مسموح له غير القالب</div><div className="flex flex-wrap gap-1">{diff.extra.map((k) => <span key={k} className="text-[11px] rounded-full bg-success/15 px-2 py-0.5">{keyLabel(k)}</span>)}{!diff.extra.length && <span className="text-xs text-muted-foreground">مفيش</span>}</div></div>
                    <div className="space-y-1"><div className="text-xs font-bold text-destructive">ممنوع منه رغم إن القالب بيسمح</div><div className="flex flex-wrap gap-1">{diff.revoked.map((k) => <span key={k} className="text-[11px] rounded-full bg-destructive/15 px-2 py-0.5">{keyLabel(k)}</span>)}{!diff.revoked.length && <span className="text-xs text-muted-foreground">مفيش</span>}</div></div>
                  </div>
                )}
              </div>
            )}

            <PermissionEditor bind={bind} />
          </>
        )}
      </main>

      {/* live sidebar preview */}
      {person && (
        <aside aria-label="معاينة القايمة الجانبية" className="flex-[1_1_220px] max-w-[280px] space-y-2">
          <div className="text-sm font-extrabold text-muted-foreground">معاينة: القايمة الجانبية عنده</div>
          <div className="rounded-xl border bg-card p-3 space-y-3">
            {preview.map((s) => (
              <div key={s.id} className="space-y-1">
                <div className="text-sm font-extrabold text-primary">{s.label}</div>
                {s.items.map((it) => <div key={it} className="text-sm rounded-md bg-muted/50 px-2 py-1">{it}</div>)}
                {!s.items.length && <div className="text-xs text-muted-foreground px-2">(القسم مش هيظهر خالص)</div>}
              </div>
            ))}
          </div>
        </aside>
      )}

      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>انسخ صلاحيات موظف تاني</DialogTitle>
            <DialogDescription>كل استثناءات {person?.name || person?.username} الحالية هتتشال، وهياخد استثناءات الموظف اللي هتختاره.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={copyFrom} onValueChange={setCopyFrom}>
              <SelectTrigger aria-label="انسخ من"><SelectValue placeholder="اختار الموظف" /></SelectTrigger>
              <SelectContent>{people.filter((p) => p.id !== userId).map((p) => <SelectItem key={p.id} value={p.id}>{p.name || p.username}</SelectItem>)}</SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={copyRole} onCheckedChange={(v) => setCopyRole(!!v)} /> انسخ الدور كمان</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={copyBranches} onCheckedChange={(v) => setCopyBranches(!!v)} /> انسخ الفروع كمان</label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyOpen(false)}>إلغاء</Button>
            <Button onClick={doCopy} disabled={!copyFrom}>انسخ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tplOpen} onOpenChange={setTplOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>احفظ صلاحياته كقالب</DialogTitle>
            <DialogDescription>القالب بيتحفظ على دور «{ROLE_LABELS[role as AppRole] ?? role}» ومعاه الاختلافات الحالية، وتقدر تطبّقه على أي موظف بعدين.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="tpl-name">اسم القالب</Label>
            <Input id="tpl-name" value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="مثلاً: كاشير من غير خزنة" maxLength={60} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTplOpen(false)}>إلغاء</Button>
            <Button onClick={saveTemplate} disabled={!tplName.trim()}>حفظ القالب</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
