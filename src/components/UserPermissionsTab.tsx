import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, RotateCcw, Search, ChevronDown, FolderTree, FileText, Folder, FolderOpen, Building2, UserCog, Check } from "lucide-react";
import { toast } from "sonner";
import {
  BRANCH_PERMISSION_GROUPS,
  ADMIN_NAV_PERMISSION_GROUPS,
  ADMIN_SUBSECTION_PERMISSION_GROUPS,
  SUBSECTION_PARENT,
  USER_PERMISSION_GROUPS,
  MANAGED_ROLES,
  ROLE_LABELS,
  DEFAULT_ROLE_PERMISSIONS,
  AppRole,
} from "@/lib/roles";

type Tri = "default" | "allow" | "deny";
type Group = { key: string; label: string; actions: ("view" | "create" | "update" | "delete")[] };
type Node = { group: Group; children: Group[] };

const ACTION_LABELS: Record<string, string> = { view: "عرض", create: "إنشاء", update: "تعديل", delete: "حذف" };

/** permission_key → readable label (e.g. "المبيعات — إنشاء"). */
const PERM_LABELS: Record<string, string> = Object.fromEntries(
  USER_PERMISSION_GROUPS.flatMap((g) => g.actions.map((a) => [`${g.key}.${a}`, `${g.label} — ${ACTION_LABELS[a]}`])),
);

/** Strip the "الصفحة ← " prefix from sub-section labels for the tree view. */
const childLabel = (label: string) => (label.includes("←") ? label.split("←").slice(1).join("←").trim() : label);

const buildAdminTree = (): Node[] =>
  ADMIN_NAV_PERMISSION_GROUPS.map((g) => ({
    group: g,
    children: ADMIN_SUBSECTION_PERMISSION_GROUPS.filter((c) => SUBSECTION_PARENT[c.key] === g.key),
  }));

const SECTIONS: { title: string; nodes: Node[] }[] = [
  { title: "صفحات الفرع والعمليات", nodes: BRANCH_PERMISSION_GROUPS.map((g) => ({ group: g, children: [] })) },
  { title: "قائمة الإدارة الجانبية", nodes: buildAdminTree() },
];

export function UserPermissionsTab() {
  const { tenantId } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [employeeUserIds, setEmployeeUserIds] = useState<Set<string>>(new Set());
  const [allBranches, setAllBranches] = useState<{ id: string; name: string }[]>([]);
  const [rolesByUser, setRolesByUser] = useState<Record<string, string[]>>({});
  const [branchIdsByUser, setBranchIdsByUser] = useState<Record<string, string[]>>({});
  const [userId, setUserId] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [savingAccess, setSavingAccess] = useState(false);
  const [state, setState] = useState<Record<string, Tri>>({});
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rolePerms, setRolePerms] = useState<Record<string, Record<string, boolean>>>({});

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const [{ data: profs }, { data: roles }, { data: bu }, { data: brs }, { data: emps }, { data: rp }] = await Promise.all([
      supabase.from("profiles").select("id, name, username").eq("tenant_id", tenantId).order("name"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("branch_users").select("user_id, branch_id"),
      supabase.from("branches").select("id, name").eq("tenant_id", tenantId).order("name"),
      supabase.from("employees").select("user_id").eq("tenant_id", tenantId).eq("is_active", true).not("user_id", "is", null),
      supabase.from("role_permissions" as any).select("role, permission_key, allowed").eq("tenant_id", tenantId),
    ]);
    setEmployeeUserIds(new Set(((emps ?? []) as any[]).map((e) => e.user_id)));
    setUsers(profs ?? []);
    setAllBranches((brs ?? []) as any);
    const pmap: Record<string, Record<string, boolean>> = {};
    ((rp ?? []) as any[]).forEach((r) => { (pmap[r.role] = pmap[r.role] || {})[r.permission_key] = !!r.allowed; });
    Object.entries(DEFAULT_ROLE_PERMISSIONS).forEach(([r, defs]) => { if (!pmap[r]) pmap[r] = { ...defs }; });
    setRolePerms(pmap);
    const rmap: Record<string, string[]> = {};
    (roles ?? []).forEach((r: any) => { (rmap[r.user_id] = rmap[r.user_id] || []).push(r.role); });
    setRolesByUser(rmap);
    const bmap: Record<string, string[]> = {};
    (bu ?? []).forEach((r: any) => { (bmap[r.user_id] = bmap[r.user_id] || []).push(r.branch_id); });
    setBranchIdsByUser(bmap);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);

  /** Owners / admins / super admins / partners are never managed here — they hold full company access. */
  const FULL_ACCESS_ROLES = ["owner", "admin", "super_admin", "partner"];
  /** Only real, active employee records of this tenant appear here (deleted employees never show). */
  const selectableUsers = useMemo(
    () =>
      users.filter((u) => {
        if (!employeeUserIds.has(u.id)) return false;
        const rs = rolesByUser[u.id] ?? [];
        return !rs.some((r) => FULL_ACCESS_ROLES.includes(r));
      }),
    // eslint-disable-next-line
    [users, rolesByUser, employeeUserIds],
  );


  /** Load saved overrides for the selected user (source of truth = DB). */
  const loadOverrides = async (uid: string) => {
    const { data, error } = await supabase
      .from("user_permissions" as any)
      .select("permission_key, allowed")
      .eq("user_id", uid);
    if (error) { toast.error("تعذر تحميل الاستثناءات: " + error.message); return; }
    const s: Record<string, Tri> = {};
    (data ?? []).forEach((r: any) => { s[r.permission_key] = r.allowed ? "allow" : "deny"; });
    setState(s);
  };

  useEffect(() => {
    if (!userId) { setState({}); setRole(""); setBranchIds([]); return; }
    setRole((rolesByUser[userId] ?? []).find((r) => MANAGED_ROLES.includes(r as AppRole)) ?? (rolesByUser[userId] ?? [])[0] ?? "");
    setBranchIds(branchIdsByUser[userId] ?? []);
    loadOverrides(userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    setRole((rolesByUser[userId] ?? []).find((r) => MANAGED_ROLES.includes(r as AppRole)) ?? (rolesByUser[userId] ?? [])[0] ?? "");
    setBranchIds(branchIdsByUser[userId] ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesByUser, branchIdsByUser]);


  const filteredSections = useMemo(() => {
    const term = q.trim();
    if (!term) return SECTIONS;
    return SECTIONS.map((s) => ({
      ...s,
      nodes: s.nodes
        .map((n) => {
          const hitParent = n.group.label.includes(term);
          const kids = n.children.filter((c) => c.label.includes(term));
          if (hitParent) return n;
          return kids.length ? { ...n, children: kids } : null;
        })
        .filter(Boolean) as Node[],
    })).filter((s) => s.nodes.length);
  }, [q]);

  /** Differences between this user's overrides and the defaults of his role. */
  const diff = useMemo(() => {
    const extra: string[] = [];   // مسموح له استثناءً (الدور مش مديهاله)
    const revoked: string[] = []; // ممنوع منه استثناءً (الدور كان مديهاله)
    const same: string[] = [];    // استثناء بنفس نتيجة الدور
    if (!userId) return { extra, revoked, same };
    const defs = rolePerms[role] ?? DEFAULT_ROLE_PERMISSIONS[role] ?? {};
    Object.entries(state).forEach(([key, v]) => {
      if (v !== "allow" && v !== "deny") return;
      const roleAllows = defs[key] === true;
      if (v === "allow" && !roleAllows) extra.push(key);
      else if (v === "deny" && roleAllows) revoked.push(key);
      else same.push(key);
    });
    return { extra, revoked, same };
  }, [state, role, rolePerms, userId]);


  const set = (key: string, v: Tri) => setState((p) => ({ ...p, [key]: v }));

  const setNode = (node: Node, v: Tri) => {
    setState((p) => {
      const next = { ...p };
      [node.group, ...node.children].forEach((g) => g.actions.forEach((a) => { next[`${g.key}.${a}`] = v; }));
      return next;
    });
  };

  const saveAccess = async () => {
    if (!tenantId || !userId) return;
    setSavingAccess(true);
    try {
      const current = rolesByUser[userId] ?? [];
      const keep: string[] = current.filter((r) => r === "super_admin" || r === "owner" || r === "partner");
      if (role && !keep.includes(role)) {
        const toDelete = current.filter((r) => !keep.includes(r) && r !== role);
        if (toDelete.length) {
          const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).in("role", toDelete as any);
          if (error) throw error;
        }
        if (!current.includes(role)) {
          const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: role as any, tenant_id: tenantId } as any);
          if (error) throw error;
        }
      }

      const prev = branchIdsByUser[userId] ?? [];
      const removed = prev.filter((b) => !branchIds.includes(b));
      const added = branchIds.filter((b) => !prev.includes(b));
      if (removed.length) {
        const { error } = await supabase.from("branch_users").delete().eq("user_id", userId).in("branch_id", removed);
        if (error) throw error;
      }
      if (added.length) {
        const { error } = await supabase
          .from("branch_users")
          .insert(added.map((b) => ({ user_id: userId, branch_id: b, tenant_id: tenantId })) as any);
        if (error) throw error;
      }
      toast.success("تم تحديث الدور والفروع");
      await load();
    } catch (e: any) {
      toast.error("فشل التحديث: " + (e?.message ?? e));
    } finally {
      setSavingAccess(false);
    }
  };

  const save = async () => {
    if (!tenantId || !userId) return;
    setSaving(true);
    const upserts: any[] = [];
    USER_PERMISSION_GROUPS.forEach((g) =>
      g.actions.forEach((a) => {
        const key = `${g.key}.${a}`;
        const v = state[key] ?? "default";
        if (v !== "default") upserts.push({ tenant_id: tenantId, user_id: userId, permission_key: key, allowed: v === "allow" });
      }),
    );
    try {
      // Wipe every stored override for this user first (root fix: nothing can survive
      // a removal because of key lists that don't match what's actually in the DB),
      // then write back only what's currently selected.
      const { error: delErr } = await supabase
        .from("user_permissions" as any)
        .delete()
        .eq("user_id", userId)
        .eq("tenant_id", tenantId);
      if (delErr) throw delErr;

      if (upserts.length) {
        const { data, error } = await supabase
          .from("user_permissions" as any)
          .insert(upserts)
          .select("permission_key");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("لم يتم تسجيل أي استثناء — تأكد من صلاحياتك كمالك");
      }
      // Re-read from DB so the screen always reflects what's actually stored
      await loadOverrides(userId);
      toast.success(upserts.length ? `تم حفظ ${upserts.length} استثناء فعليًا` : "تم مسح كل الاستثناءات فعليًا");
    } catch (e: any) {
      toast.error("فشل الحفظ: " + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  /** Remove every override → the employee falls back to his role defaults. */
  const resetToRoleDefaults = async () => {
    if (!userId || !tenantId) return;
    setSaving(true);
    const { error } = await supabase
      .from("user_permissions" as any)
      .delete()
      .eq("user_id", userId)
      .eq("tenant_id", tenantId);
    if (error) { setSaving(false); toast.error("فشل الإرجاع: " + error.message); return; }
    await loadOverrides(userId);
    setSaving(false);
    toast.success("تم إرجاع الموظف لصلاحيات دوره الافتراضية");
  };

  /** Remove only the EXTRA granted permissions (keeps manual restrictions). */
  const clearExtras = async () => {
    if (!userId || !tenantId || !diff.extra.length) return;
    setSaving(true);
    const { error } = await supabase
      .from("user_permissions" as any)
      .delete()
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .in("permission_key", diff.extra);
    if (error) { setSaving(false); toast.error("فشل الحذف: " + error.message); return; }
    await loadOverrides(userId);
    setSaving(false);
    toast.success(`تم سحب ${diff.extra.length} صلاحية إضافية`);
  };



  const TriToggle = ({ perm }: { perm: string }) => {
    const v = state[perm] ?? "default";
    return (
      <div className="flex rounded-full overflow-hidden border border-border/70 bg-background/80 shadow-sm shrink-0">
        {(["default", "allow", "deny"] as Tri[]).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => set(perm, opt)}
            className={`px-2.5 py-1 text-[11px] font-medium transition-all duration-200 ${
              v === opt
                ? opt === "allow"
                  ? "bg-emerald-500 text-white shadow-inner"
                  : opt === "deny"
                    ? "bg-destructive text-destructive-foreground shadow-inner"
                    : "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {opt === "default" ? "افتراضي" : opt === "allow" ? "مسموح" : "ممنوع"}
          </button>
        ))}
      </div>
    );
  };

  const ActionsRow = ({ group }: { group: Group }) => (
    <div className="flex flex-wrap items-center gap-2">
      {group.actions.map((a) => (
        <div key={a} className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground w-8 text-left">{ACTION_LABELS[a]}</span>
          <TriToggle perm={`${group.key}.${a}`} />
        </div>
      ))}
    </div>
  );


  /** Summary of what is explicitly set on a node (parent + children). */
  const nodeSummary = (node: Node) => {
    let allow = 0, deny = 0;
    [node.group, ...node.children].forEach((g) =>
      g.actions.forEach((a) => {
        const v = state[`${g.key}.${a}`];
        if (v === "allow") allow++;
        if (v === "deny") deny++;
      }),
    );
    return { allow, deny };
  };

  if (loading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <Card dir="rtl" className="text-right">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2"><FolderTree className="w-5 h-5 text-primary" /> صلاحيات موظف بعينه</CardTitle>
        <Button onClick={save} disabled={!userId || saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Save className="w-4 h-4 ml-1" />} حفظ
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs bg-primary/10 border border-primary/30 rounded p-2">
          💡 الشجرة بتوضح كل صفحة والأقسام المتفرعة منها. لو القسم الفرعي على «افتراضي» فهو بيورّث صلاحية الصفحة الأم.
          الاستثناء هنا بيتفوّق على صلاحيات الدور. أما <b>الفروع اللي يشوفها</b> فبتتحدد من الفروع المربوطة بالموظف تحت.
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <div className="text-sm mb-1">الموظف</div>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue placeholder="اختر موظف" /></SelectTrigger>
              <SelectContent>
                {selectableUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name || u.username || u.id}
                    {(rolesByUser[u.id] ?? []).length > 0 && (
                      <span className="text-xs text-muted-foreground"> — {(rolesByUser[u.id] ?? []).map((r) => ROLE_LABELS[r as AppRole] ?? r).join("، ")}</span>
                    )}
                  </SelectItem>
                ))}
                {!selectableUsers.length && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">لا يوجد موظفين قابلين للتحكم في صلاحياتهم</div>
                )}
              </SelectContent>
            </Select>
            <div className="text-[11px] text-muted-foreground mt-1">
              المالك والمدير والشركاء مش بيظهروا هنا — عندهم صلاحيات الشركة كاملة.
            </div>

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
          <div className="rounded-lg border border-primary/25 bg-gradient-to-l from-primary/5 to-transparent p-3 space-y-3 animate-fade-in">
            <div className="flex flex-wrap items-center gap-2">
              <FolderTree className="w-4 h-4 text-primary" />
              <span className="font-bold text-sm">الاستثناءات مقارنة بصلاحيات الدور ({ROLE_LABELS[role as AppRole] ?? (role || "بدون دور")})</span>
              <div className="flex flex-wrap gap-2 ms-auto">
                <Badge className="bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
                  مسموح زيادة: {diff.extra.length}
                </Badge>
                <Badge className="bg-destructive/15 text-destructive border border-destructive/30">
                  ممنوع استثناءً: {diff.revoked.length}
                </Badge>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-[11px]"
                  disabled={!diff.extra.length || saving}
                  onClick={clearExtras}
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin ml-1" /> : <RotateCcw className="w-3.5 h-3.5 ml-1" />}
                  شيل كل الصلاحيات الزيادة ({diff.extra.length})
                </Button>
              </div>
            </div>


            {!diff.extra.length && !diff.revoked.length ? (
              <div className="text-xs text-muted-foreground">
                مفيش أي استثناء — الموظف شغال بصلاحيات دوره الافتراضية بالظبط.
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {!!diff.extra.length && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
                    <div className="text-xs font-bold text-emerald-600 mb-1 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> مسموح له غير الافتراضي ({diff.extra.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {diff.extra.map((k) => (
                        <span key={k} className="text-[11px] rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5">
                          {PERM_LABELS[k] ?? k}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {!!diff.revoked.length && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2">
                    <div className="text-xs font-bold text-destructive mb-1">
                      ممنوع منه رغم إن دوره بيسمح ({diff.revoked.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {diff.revoked.map((k) => (
                        <span key={k} className="text-[11px] rounded-full bg-destructive/15 text-destructive px-2 py-0.5">
                          {PERM_LABELS[k] ?? k}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}


        {userId && (
          <div className="rounded-lg border bg-muted/20 p-3 space-y-3 animate-fade-in">
            <div className="flex flex-wrap items-center gap-2">
              <UserCog className="w-4 h-4 text-primary" />
              <span className="font-bold text-sm">دور الموظف والفروع المسموح بيها</span>
              <Button size="sm" className="ms-auto" onClick={saveAccess} disabled={savingAccess}>
                {savingAccess ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Save className="w-4 h-4 ml-1" />} حفظ الدور والفروع
              </Button>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">الدور</div>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger><SelectValue placeholder="اختر الدور" /></SelectTrigger>
                  <SelectContent>
                    {MANAGED_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5" /> الفروع المربوطة ({branchIds.length || "كل الفروع"})
                </div>
                <div className="flex flex-wrap gap-2">
                  {allBranches.map((b) => {
                    const on = branchIds.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setBranchIds((p) => (on ? p.filter((x) => x !== b.id) : [...p, b.id]))}
                        className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-all hover-scale ${
                          on ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                        }`}
                      >
                        {on && <Check className="w-3 h-3" />} {b.name}
                      </button>
                    );
                  })}
                  {!allBranches.length && <span className="text-xs text-muted-foreground">لا توجد فروع</span>}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              {(rolesByUser[userId] ?? []).map((r) => <Badge key={r} variant="secondary">{ROLE_LABELS[r as AppRole] ?? r}</Badge>)}
              {branchIds.length === 0 && <Badge variant="outline">🏬 غير مربوط بأي فرع</Badge>}
            </div>
          </div>
        )}

        {!userId ? (
          <div className="text-sm text-muted-foreground py-8 text-center">اختر موظف عشان تظهر صلاحياته.</div>
        ) : (
          <div className="space-y-6">
            {filteredSections.map((sec) => (
              <div key={sec.title} className="rounded-xl border border-primary/20 overflow-hidden bg-card">
                <div className="px-4 py-2.5 bg-gradient-to-l from-primary/15 via-primary/5 to-transparent border-b border-primary/20 font-bold text-primary flex items-center gap-2">
                  <FolderTree className="w-4 h-4" /> {sec.title}
                </div>
                <div className="p-3 space-y-2">
                  {sec.nodes.map((node) => {
                    const hasKids = node.children.length > 0;
                    const open = expanded[node.group.key] ?? !!q.trim();
                    const { allow, deny } = nodeSummary(node);
                    return (
                      <div
                        key={node.group.key}
                        className={`rounded-xl border transition-all duration-300 ${
                          open && hasKids
                            ? "border-primary/40 bg-primary/[0.04] shadow-sm"
                            : "border-border bg-background hover:border-primary/30"
                        }`}
                      >
                        {/* Parent node */}
                        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                          <button
                            type="button"
                            disabled={!hasKids}
                            onClick={() => setExpanded((p) => ({ ...p, [node.group.key]: !open }))}
                            className={`flex items-center gap-2 text-sm font-bold ${hasKids ? "hover:text-primary" : "cursor-default"}`}
                          >
                            <span
                              className={`w-6 h-6 rounded-md flex items-center justify-center border transition-all duration-300 ${
                                hasKids
                                  ? "bg-primary/15 border-primary/30 text-primary"
                                  : "bg-muted/40 border-transparent text-muted-foreground"
                              }`}
                            >
                              {hasKids ? (
                                <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${open ? "rotate-0" : "rotate-90"}`} />
                              ) : (
                                <FileText className="w-3.5 h-3.5" />
                              )}
                            </span>
                            <span
                              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-300 ${
                                hasKids ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                              }`}
                            >
                              {hasKids ? (open ? <FolderOpen className="w-4 h-4" /> : <Folder className="w-4 h-4" />) : <FileText className="w-4 h-4" />}
                            </span>
                            {node.group.label}
                            {hasKids && (
                              <Badge variant="secondary" className="text-[10px] rounded-full">{node.children.length}</Badge>
                            )}
                          </button>

                          <div className="flex items-center gap-1">
                            {allow > 0 && (
                              <span className="rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold">
                                مسموح {allow}
                              </span>
                            )}
                            {deny > 0 && (
                              <span className="rounded-full bg-destructive/15 text-destructive border border-destructive/30 px-2 py-0.5 text-[10px] font-bold">
                                ممنوع {deny}
                              </span>
                            )}
                          </div>

                          <div className="ms-auto flex flex-wrap items-center gap-2">
                            <ActionsRow group={node.group} />
                            {hasKids && (
                              <div className="flex gap-1">
                                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10" onClick={() => setNode(node, "allow")}>الكل مسموح</Button>
                                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setNode(node, "default")}>افتراضي</Button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Children — real tree with connector lines + animated expand */}
                        {hasKids && (
                          <div
                            className="grid transition-all duration-300 ease-out"
                            style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
                          >
                            <div className="overflow-hidden">
                              <div className="relative px-3 pb-3 pt-1 mr-6">
                                {/* vertical trunk */}
                                <span className="absolute top-0 bottom-6 right-[6px] w-[2px] rounded bg-gradient-to-b from-primary/50 to-primary/10" />
                                {node.children.map((c, i) => (
                                  <div
                                    key={c.key}
                                    className="relative py-1"
                                    style={{
                                      transition: "transform .3s ease, opacity .3s ease",
                                      transitionDelay: open ? `${i * 40}ms` : "0ms",
                                      transform: open ? "translateX(0)" : "translateX(10px)",
                                      opacity: open ? 1 : 0,
                                    }}
                                  >
                                    {/* horizontal branch */}
                                    <span className="absolute top-1/2 right-[6px] w-4 h-[2px] rounded bg-primary/40" />
                                    <span className="absolute top-1/2 right-[2px] -mt-[3px] w-[7px] h-[7px] rounded-full bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]" />
                                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 mr-6 hover:border-primary/50 hover:bg-primary/[0.03] transition-all duration-200">
                                      <FileText className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                                      <span className="text-sm font-medium">{childLabel(c.label)}</span>
                                      <div className="ms-auto"><ActionsRow group={c} /></div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setState({})}>
                <RotateCcw className="w-4 h-4 ml-1" /> تفريغ الاختيارات (من غير حفظ)
              </Button>
              <Button variant="destructive" size="sm" onClick={resetToRoleDefaults} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <RotateCcw className="w-4 h-4 ml-1" />}
                رجّع الموظف لصلاحيات دوره الافتراضية
              </Button>
            </div>

          </div>
        )}

      </CardContent>
    </Card>
  );
}
