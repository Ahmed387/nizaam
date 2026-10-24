import { useEffect, useState } from "react";
import { PermTable } from "@/components/PermTable";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, UserPlus, Trash2, Eye, KeyRound } from "lucide-react";
import { confirmAlert } from "@/components/ConfirmDialog";
import { edgeErrorMessage } from "@/lib/edgeError";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";

interface ViewerRow {
  id: string;
  name: string;
  username: string;
  created_at: string;
}

export function ViewersTab() {
  const { tenantId } = useAuth();
  const [rows, setRows] = useState<ViewerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [saving, setSaving] = useState(false);
  const [pwdDialog, setPwdDialog] = useState<{ open: boolean; userId: string; name: string; password: string }>({
    open: false, userId: "", name: "", password: "",
  });

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    // ملاحظة: مفيش علاقة مباشرة بين profiles و user_roles في الداتابيز،
    // فبنجيب المراقبين على خطوتين بدل الـ embed اللي كان بيرجع فاضي.
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("role", "viewer");
    const ids = Array.from(new Set((roleRows ?? []).map((r: any) => r.user_id).filter(Boolean)));
    if (ids.length === 0) { setRows([]); setLoading(false); return; }
    const { data } = await supabase
      .from("profiles")
      .select("id, name, username, created_at")
      .in("id", ids)
      .order("created_at", { ascending: false });
    setRows((data ?? []) as any);
    setLoading(false);
  };


  useEffect(() => { load(); }, [tenantId]);

  const create = async () => {
    const email = form.email.trim().toLowerCase();
    if (!email || !form.password) return toast.error("ادخل الإيميل وكلمة المرور");
    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password))
      return toast.error("كلمة المرور لازم تكون 8 أحرف على الأقل وفيها حرف ورقم");
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return toast.error("اكتب إيميل صحيح زي name@company.com");
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("manage-viewer", {
      body: { action: "create", email, password: form.password, name: form.name.trim() || email.split("@")[0] },
    });
    setSaving(false);
    if (error || (data as any)?.error) {
      return toast.error((await edgeErrorMessage(error, data)) ?? "فشل الإنشاء");
    }
    toast.success((data as any)?.kept_existing_password
      ? "تمت إضافة صلاحية المراقب للحساب الحالي — كلمة مروره الأصلية لم تتغير"
      : "تم إنشاء حساب المراقب");
    setForm({ name: "", email: "", password: "" });
    load();
  };

  const remove = async (userId: string, name: string) => {
    if (!(await confirmAlert({ title: `حذف حساب المراقب "${name}"؟`, description: "الخطوة دي مش هتترجع تاني — متأكد؟", confirmLabel: "أيوه، امسح", cancelLabel: "لأ، سيبها", tone: "danger" }))) return;
    const { data, error } = await supabase.functions.invoke("manage-viewer", {
      body: { action: "delete", user_id: userId },
    });
    if (error || (data as any)?.error) {
      return toast.error((await edgeErrorMessage(error, data)) ?? "فشل الحذف");
    }
    toast.success("تم الحذف");
    load();
  };

  const changePwd = async () => {
    if (pwdDialog.password.length < 8 || !/[A-Za-z]/.test(pwdDialog.password) || !/[0-9]/.test(pwdDialog.password))
      return toast.error("كلمة المرور لازم تكون 8 أحرف على الأقل وفيها حرف ورقم");
    const { data, error } = await supabase.functions.invoke("manage-viewer", {
      body: { action: "update_password", user_id: pwdDialog.userId, password: pwdDialog.password },
    });
    if (error || (data as any)?.error) {
      return toast.error((await edgeErrorMessage(error, data)) ?? "فشل التحديث");
    }
    toast.success("تم تغيير كلمة المرور");
    setPwdDialog({ open: false, userId: "", name: "", password: "" });
  };

  return (
    <div className="card-elevated p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex items-start gap-3">
        <Eye className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div>
          <h3 className="font-bold">حسابات المراقبة (Viewers)</h3>
          <p className="text-sm text-muted-foreground">
            المراقب يقدر يشوف كل بيانات الشركة (الفواتير، المخزون، الخزينة، التقارير...) لكن مش هيقدر يعدل أو يحذف أي حاجة.
            ممكن تضيف أكتر من حساب بإيميل وباسورد مختلف، ومجرد ما تحفظ يقدر يدخل علطول.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3 p-4 rounded-lg bg-surface-2">
        <div>
          <Label>الاسم (اختياري)</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" placeholder="مثال: المحاسب القانوني" />
        </div>
        <div>
          <Label>الإيميل *</Label>
          <Input dir="ltr" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1.5 text-right" placeholder="viewer@company.com" />
        </div>
        <div>
          <Label>كلمة المرور *</Label>
          <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1.5" placeholder="8 أحرف على الأقل + حرف ورقم" />
        </div>
        <div className="md:col-span-3">
          <Button onClick={create} disabled={saving} className="gap-2 w-full md:w-auto">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            إضافة مراقب
          </Button>
        </div>
      </div>

      <div>
        <h4 className="font-semibold mb-2">المراقبون الحاليون ({rows.length})</h4>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground p-4 text-center border rounded">لا يوجد حسابات مراقبة بعد.</p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <PermTable className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-right p-3">الاسم</th>
                  <th className="text-right p-3">الإيميل</th>
                  <th className="text-right p-3">تاريخ الإنشاء</th>
                  <th className="text-right p-3 w-32">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/20">
                    <td className="p-3 font-medium">{r.name}</td>
                    <td className="p-3" dir="ltr">{r.username}</td>
                    <td className="p-3 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("ar-EG")}</td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setPwdDialog({ open: true, userId: r.id, name: r.name, password: "" })}>
                          <KeyRound className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => remove(r.id, r.name)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </PermTable>
          </div>
        )}
      </div>

      <Dialog open={pwdDialog.open} onOpenChange={(o) => setPwdDialog((s) => ({ ...s, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تغيير كلمة مرور: {pwdDialog.name}</DialogTitle>
            <DialogDescription>اكتب كلمة المرور الجديدة (8 أحرف على الأقل وفيها حرف ورقم)</DialogDescription>
          </DialogHeader>
          <Input
            type="text"
            value={pwdDialog.password}
            onChange={(e) => setPwdDialog((s) => ({ ...s, password: e.target.value }))}
            placeholder="كلمة المرور الجديدة"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdDialog({ open: false, userId: "", name: "", password: "" })}>إلغاء</Button>
            <Button onClick={changePwd}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
