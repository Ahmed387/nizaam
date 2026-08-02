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
  AppRole,
} from "@/lib/roles";

type Tri = "default" | "allow" | "deny";
type Group = { key: string; label: string; actions: ("view" | "create" | "update" | "delete")[] };
type Node = { group: Group; children: Group[] };

const ACTION_LABELS: Record<string, string> = { view: "عرض", create: "إنشاء", update: "تعديل", delete: "حذف" };

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

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const [{ data: profs }, { data: roles }, { data: bu }, { data: brs }] = await Promise.all([
      supabase.from("profiles").select("id, name, username").eq("tenant_id", tenantId).order("name"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("branch_users").select("user_id, branch_id"),
      supabase.from("branches").select("id, name").eq("tenant_id", tenantId).order("name"),
    ]);
    setUsers(profs ?? []);
    setAllBranches((brs ?? []) as any);
    const rmap: Record<string, string[]> = {};
    (roles ?? []).forEach((r: any) => { (rmap[r.user_id] = rmap[r.user_id] || []).push(r.role); });
    setRolesByUser(rmap);
    const bmap: Record<string, string[]> = {};
    (bu ?? []).forEach((r: any) => { (bmap[r.user_id] = bmap[r.user_id] || []).push(r.branch_id); });
    setBranchIdsByUser(bmap);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);

  useEffect(() => {
    if (!userId) { setState({}); setRole(""); setBranchIds([]); return; }
    setRole((rolesByUser[userId] ?? []).find((r) => MANAGED_ROLES.includes(r as AppRole)) ?? (rolesByUser[userId] ?? [])[0] ?? "");
    setBranchIds(branchIdsByUser[userId] ?? []);
    supabase
      .from("user_permissions" as any)
      .select("permission_key, allowed")
      .eq("user_id", userId)
      .then(({ data }) => {
        const s: Record<string, Tri> = {};
        (data ?? []).forEach((r: any) => { s[r.permission_key] = r.allowed ? "allow" : "deny"; });
        setState(s);
      });
  }, [userId, rolesByUser, branchIdsByUser]);

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

  const TriToggle = ({ perm }: { perm: string }) => {
    const v = state[perm] ?? "default";
    return (
      <div className="flex rounded-md overflow-hidden border shrink-0">
        {(["default", "allow", "deny"] as Tri[]).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => set(perm, opt)}
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
    );
  };

  const ActionsRow = ({ group }: { group: Group }) => (
    <div className="flex flex-wrap items-center gap-3">
      {group.actions.map((a) => (
        <div key={a} className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground w-9">{ACTION_LABELS[a]}</span>
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
              <div key={sec.title}>
                <div className="font-bold mb-2">{sec.title}</div>
                <div className="rounded-lg border p-2 bg-background/50">
                  {sec.nodes.map((node) => {
                    const hasKids = node.children.length > 0;
                    const open = expanded[node.group.key] ?? !!q.trim();
                    const { allow, deny } = nodeSummary(node);
                    return (
                      <div key={node.group.key} className="relative">
                        {/* Parent node */}
                        <div className="flex flex-wrap items-center gap-2 rounded-md px-2 py-2 hover:bg-muted/40 transition-colors">
                          <button
                            type="button"
                            disabled={!hasKids}
                            onClick={() => setExpanded((p) => ({ ...p, [node.group.key]: !open }))}
                            className={`flex items-center gap-1.5 text-sm font-medium ${hasKids ? "hover:text-primary" : "cursor-default"}`}
                          >
                            {hasKids ? (
                              <ChevronDown className={`w-4 h-4 text-primary transition-transform duration-300 ${open ? "rotate-0" : "rotate-90"}`} />
                            ) : (
                              <span className="w-4" />
                            )}
                            {hasKids
                              ? (open ? <FolderOpen className="w-4 h-4 text-primary" /> : <Folder className="w-4 h-4 text-primary" />)
                              : <FileText className="w-4 h-4 text-muted-foreground" />}
                            {node.group.label}
                            {hasKids && (
                              <Badge variant="secondary" className="text-[10px]">{node.children.length}</Badge>
                            )}
                          </button>
                          <div className="flex items-center gap-1 text-[10px]">
                            {allow > 0 && <Badge className="text-[10px]">مسموح {allow}</Badge>}
                            {deny > 0 && <Badge variant="destructive" className="text-[10px]">ممنوع {deny}</Badge>}
                          </div>
                          <div className="ms-auto flex items-center gap-2">
                            <ActionsRow group={node.group} />
                            {hasKids && (
                              <div className="flex gap-1">
                                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setNode(node, "allow")}>الكل مسموح</Button>
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
                              <div className="relative mr-[18px] pr-5">
                                {/* vertical trunk */}
                                <span className="absolute top-0 bottom-3 right-0 w-px bg-primary/30" />
                                {node.children.map((c) => (
                                  <div key={c.key} className="relative py-1">
                                    {/* horizontal branch */}
                                    <span className="absolute top-1/2 right-0 w-4 h-px bg-primary/30" />
                                    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-2 py-1.5 hover:border-primary/40 transition-colors">
                                      <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                                      <span className="text-sm">{childLabel(c.label)}</span>
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
            <Button variant="outline" size="sm" onClick={() => setState({})}>
              <RotateCcw className="w-4 h-4 ml-1" /> رجّع الكل للافتراضي
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
