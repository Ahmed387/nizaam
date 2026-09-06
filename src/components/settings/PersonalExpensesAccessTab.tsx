import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldCheck, UserPlus, Trash2, Eye, Pencil, Lock } from "lucide-react";
import { toast } from "sonner";
import { confirmAlert } from "@/components/ConfirmDialog";

interface Delegate {
  granted_user_id: string;
  full_name: string;
  email: string;
  can_view: boolean;
  can_edit: boolean;
  created_at: string;
}

interface UserRow {
  id: string;
  name: string;
  username: string;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });

export function PersonalExpensesAccessTab() {
  const { user, tenantId } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [delegates, setDelegates] = useState<Delegate[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [level, setLevel] = useState<"view" | "edit">("view");

  const load = async () => {
    setLoading(true);
    const { data: info } = await supabase.rpc("personal_owner_info" as any);
    const row: any = Array.isArray(info) ? info[0] : info;
    const isOwnerOfLedger = !!row?.owner_id && row.owner_id === user?.id;
    setAllowed(isOwnerOfLedger);
    if (!isOwnerOfLedger) {
      setLoading(false);
      return;
    }
    const [{ data: dg, error }, { data: pf }] = await Promise.all([
      supabase.rpc("get_owner_expense_delegates" as any),
      supabase.from("profiles" as any).select("id, name, username").eq("tenant_id", tenantId ?? ""),
    ]);
    if (error) toast.error(error.message);
    setDelegates(((dg as any[]) ?? []) as Delegate[]);
    setUsers(((pf as any[]) ?? []) as UserRow[]);
    setLoading(false);
  };

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, tenantId]);

  const eligible = useMemo(() => {
    const taken = new Set(delegates.map((d) => d.granted_user_id));
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => u.id !== user?.id && !taken.has(u.id))
      .filter((u) => !q || (u.name ?? "").toLowerCase().includes(q) || (u.username ?? "").toLowerCase().includes(q));
  }, [users, delegates, search, user?.id]);

  const grant = async () => {
    if (!selected) return toast.error("اختر مستخدماً أولاً");
    setSaving(true);
    const { error } = await supabase.rpc("manage_owner_expense_access" as any, {
      target_user_id: selected,
      allow_view: true,
      allow_edit: level === "edit",
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم منح الصلاحية");
    setSelected(null);
    setSearch("");
    load();
  };

  const revoke = async (d: Delegate) => {
    const ok = await confirmAlert({
      title: "إلغاء الصلاحية؟",
      description: `هيتم سحب صلاحية «${d.full_name || d.email}» على المصاريف والإيداعات الشخصية فوراً.`,
      confirmLabel: "أيوه، اسحب الصلاحية",
      tone: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.rpc("revoke_owner_expense_access" as any, { target_user_id: d.granted_user_id });
    if (error) return toast.error(error.message);
    toast.success("تم إلغاء الصلاحية");
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
          <Lock className="w-8 h-8" />
          هذه الصفحة متاحة لمالك النظام فقط.
        </CardContent>
      </Card>
    );
  }

  return (
    <div dir="rtl" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-right">
            <ShieldCheck className="w-5 h-5 text-primary" />
            منح صلاحية الوصول للمصاريف والإيداعات الشخصية
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[2fr_1.2fr_auto] items-end">
            <div className="space-y-1.5">
              <Label>المستخدم</Label>
              <Input
                placeholder="ابحث بالاسم أو البريد..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelected(null);
                }}
              />
              <div className="max-h-48 overflow-auto rounded-lg border border-border divide-y divide-border">
                {eligible.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground text-center">لا يوجد مستخدمون متاحون</div>
                ) : (
                  eligible.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setSelected(u.id)}
                      className={`w-full text-right px-3 py-2 text-sm hover:bg-muted ${
                        selected === u.id ? "bg-primary/10 font-bold" : ""
                      }`}
                    >
                      <div>{u.name || u.username}</div>
                      <div className="text-xs text-muted-foreground">{u.username}</div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>نوع الصلاحية</Label>
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setLevel("view")}
                  className={`flex-1 px-3 py-2 text-sm font-bold flex items-center justify-center gap-1 ${
                    level === "view" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"
                  }`}
                >
                  <Eye className="w-4 h-4" /> عرض فقط
                </button>
                <button
                  type="button"
                  onClick={() => setLevel("edit")}
                  className={`flex-1 px-3 py-2 text-sm font-bold flex items-center justify-center gap-1 ${
                    level === "edit" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"
                  }`}
                >
                  <Pencil className="w-4 h-4" /> تعديل كامل
                </button>
              </div>
            </div>

            <Button onClick={grant} disabled={saving || !selected}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <UserPlus className="w-4 h-4 ml-1" />}
              منح الصلاحية
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            المالك لديه صلاحية تعديل كاملة تلقائياً ولا يحتاج تسجيل هنا. المصاريف الشخصية منفصلة تماماً عن حسابات الشركة والخزائن.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-right">المصرح لهم حالياً</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-right p-2 font-bold">الاسم</th>
                  <th className="text-right p-2 font-bold">البريد الإلكتروني</th>
                  <th className="text-center p-2 font-bold">نوع الصلاحية</th>
                  <th className="text-center p-2 font-bold">تاريخ المنح</th>
                  <th className="text-center p-2 font-bold">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {delegates.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-muted-foreground">
                      لا يوجد مستخدمون مصرح لهم بعد
                    </td>
                  </tr>
                ) : (
                  delegates.map((d) => (
                    <tr key={d.granted_user_id} className="border-t">
                      <td className="p-2 font-medium text-right">{d.full_name || "—"}</td>
                      <td className="p-2 text-right text-muted-foreground">{d.email || "—"}</td>
                      <td className="p-2 text-center">
                        {d.can_edit ? (
                          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">تعديل كامل</Badge>
                        ) : (
                          <Badge variant="secondary">عرض فقط</Badge>
                        )}
                      </td>
                      <td className="p-2 text-center tabular-nums">{fmtDate(d.created_at)}</td>
                      <td className="p-2 text-center">
                        <Button size="sm" variant="destructive" onClick={() => revoke(d)}>
                          <Trash2 className="w-3.5 h-3.5 ml-1" /> إلغاء الصلاحية
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default PersonalExpensesAccessTab;
