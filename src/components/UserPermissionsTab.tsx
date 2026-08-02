import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, RotateCcw, Search, ChevronDown, ChevronLeft, FolderTree, FileText, CornerDownLeft } from "lucide-react";
import { toast } from "sonner";
import {
  BRANCH_PERMISSION_GROUPS,
  ADMIN_NAV_PERMISSION_GROUPS,
  ADMIN_SUBSECTION_PERMISSION_GROUPS,
  SUBSECTION_PARENT,
  USER_PERMISSION_GROUPS,
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
  const [rolesByUser, setRolesByUser] = useState<Record<string, string[]>>({});
  const [branchesByUser, setBranchesByUser] = useState<Record<string, string[]>>({});
  const [userId, setUserId] = useState<string>("");
  const [state, setState] = useState<Record<string, Tri>>({});
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
          الاستثناء هنا بيتفوّق على صلاحيات الدور. أما <b>الفروع اللي يشوفها</b> فبتتحدد من الفروع المربوطة بالموظف.
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
                <div className="rounded-lg border divide-y">
                  {sec.nodes.map((node) => {
                    const hasKids = node.children.length > 0;
                    const open = expanded[node.group.key] ?? !!q.trim();
                    const { allow, deny } = nodeSummary(node);
                    return (
                      <div key={node.group.key}>
                        <div className="flex flex-wrap items-center gap-2 p-2 bg-muted/30">
                          <button
                            type="button"
                            disabled={!hasKids}
                            onClick={() => setExpanded((p) => ({ ...p, [node.group.key]: !open }))}
                            className={`flex items-center gap-1.5 text-sm font-medium ${hasKids ? "hover:text-primary" : "cursor-default"}`}
                          >
                            {hasKids
                              ? (open ? <ChevronDown className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />)
                              : <FileText className="w-4 h-4 text-muted-foreground" />}
                            {node.group.label}
                            {hasKids && (
                              <Badge variant="secondary" className="text-[10px]">{node.children.length} أقسام</Badge>
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

                        {hasKids && open && (
                          <div className="pr-6 border-r-2 border-primary/20 mr-4 my-1 space-y-1">
                            {node.children.map((c) => (
                              <div key={c.key} className="flex flex-wrap items-center gap-2 rounded border bg-background p-2">
                                <div className="flex items-center gap-1.5 text-sm">
                                  <CornerDownLeft className="w-3.5 h-3.5 text-muted-foreground" />
                                  {childLabel(c.label)}
                                </div>
                                <div className="ms-auto"><ActionsRow group={c} /></div>
                              </div>
                            ))}
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
