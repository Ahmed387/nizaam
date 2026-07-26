import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Trash2, UserPlus, ShieldCheck, Eye } from "lucide-react";

interface Grant {
  id: string;
  granted_user_id: string;
  can_view: boolean;
  can_edit: boolean;
  email?: string;
  full_name?: string;
}

interface UserRow { id: string; email: string; full_name?: string }

const OWNER_EMAIL = "an.ayoub98@gmail.com";

export function PersonalExpensesAccessTab() {
  const { user } = useAuth();
  const isOwner = (user?.email || "").toLowerCase() === OWNER_EMAIL;
  const [users, setUsers] = useState<UserRow[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [pickUser, setPickUser] = useState<string>("");
  const [pickEdit, setPickEdit] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: prof }, { data: gr }] = await Promise.all([
      supabase.from("profiles").select("id, name, username").eq("is_active", true),
      supabase.from("owner_expenses_access" as any).select("*").eq("owner_user_id", user.id),
    ]);
    setUsers(((prof as any) || []).map((p: any) => ({ id: p.id, email: p.username || "", full_name: p.name })));
    setGrants(((gr as any) || []).map((g: any) => {
      const p = (prof as any || []).find((x: any) => x.id === g.granted_user_id);
      return { ...g, full_name: p?.name, email: p?.username };
    }));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  const addGrant = async () => {
    if (!pickUser) return toast.error("اختر مستخدم");
    if (!user) return;
    const { error } = await supabase.from("owner_expenses_access" as any).insert({
      owner_user_id: user.id,
      granted_user_id: pickUser,
      can_view: true,
      can_edit: pickEdit,
    });
    if (error) return toast.error(error.message);
    toast.success("تمت الإضافة");
    setPickUser(""); setPickEdit(false);
    load();
  };

  const toggleEdit = async (g: Grant) => {
    const { error } = await supabase.from("owner_expenses_access" as any).update({ can_edit: !g.can_edit }).eq("id", g.id);
    if (error) return toast.error(error.message);
    load();
  };

  const removeGrant = async (id: string) => {
    const { error } = await supabase.from("owner_expenses_access" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف");
    load();
  };

  if (!isOwner) {
    return <div className="p-6 text-muted-foreground text-center">هذا القسم لصاحب الشركة فقط.</div>;
  }

  const availableUsers = users.filter(u => u.id !== user?.id && !grants.some(g => g.granted_user_id === u.id));

  return (
    <div className="card-elevated p-6 space-y-5 max-w-3xl mx-auto">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold">صلاحيات المصاريف الشخصية</div>
          <div className="text-sm text-muted-foreground">اختر مين يقدر يشوف أو يعدل دفتر مصاريفك الشخصية. مالوش أي علاقة بحسابات النظام.</div>
        </div>
      </div>

      <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
        <Label className="text-sm font-semibold flex items-center gap-2"><UserPlus className="w-4 h-4" /> إضافة صلاحية جديدة</Label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <Select value={pickUser} onValueChange={setPickUser}>
              <SelectTrigger><SelectValue placeholder="اختر مستخدم" /></SelectTrigger>
              <SelectContent>
                {availableUsers.length === 0 && <div className="p-2 text-xs text-muted-foreground">لا يوجد مستخدمين متاحين</div>}
                {availableUsers.map(u => (
                  <SelectItem key={u.id} value={u.id}>{u.full_name || u.id.slice(0, 8)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 justify-between border rounded-md px-3">
            <Label className="text-sm">يقدر يعدل</Label>
            <Switch checked={pickEdit} onCheckedChange={setPickEdit} />
          </div>
        </div>
        <Button onClick={addGrant} disabled={!pickUser}><UserPlus className="w-4 h-4 ml-1" /> إضافة</Button>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-semibold">المستخدمين المصرح لهم</Label>
        {loading ? (
          <div className="p-4 text-center text-muted-foreground text-sm">جاري التحميل...</div>
        ) : grants.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm border rounded">لم يتم منح صلاحيات لأي مستخدم</div>
        ) : (
          <div className="border rounded-lg divide-y">
            {grants.map(g => (
              <div key={g.id} className="flex items-center gap-3 p-3">
                <div className="flex-1">
                  <div className="font-medium">{g.full_name || g.granted_user_id.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                    <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> اطلاع</span>
                    {g.can_edit && <span className="text-primary font-semibold">+ تعديل</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">تعديل</Label>
                  <Switch checked={g.can_edit} onCheckedChange={() => toggleEdit(g)} />
                </div>
                <Button size="icon" variant="ghost" onClick={() => removeGrant(g.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
