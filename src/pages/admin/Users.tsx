import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, AppRole } from "@/lib/roles";
import { toast } from "sonner";
import { Plus, Info } from "lucide-react";

export default function Users() {
  const [rows, setRows] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "cashier" as AppRole, branchIds: [] as string[] });

  const load = async () => {
    setLoading(true);
    const [{ data: profs }, { data: rolesData }, { data: bu }, { data: br }] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("branch_users").select("user_id, branches(name)"),
      supabase.from("branches").select("*").eq("is_active", true),
    ]);
    const enriched = (profs ?? []).map((p) => ({
      ...p,
      roles: (rolesData ?? []).filter((r) => r.user_id === p.id).map((r) => r.role),
      branches: (bu ?? []).filter((x: any) => x.user_id === p.id).map((x: any) => x.branches?.name).filter(Boolean),
    }));
    setRows(enriched);
    setBranches(br ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.email || !form.password || !form.name) return toast.error("املأ الحقول المطلوبة");
    try {
      const { data, error } = await supabase.auth.signUp({
        email: form.email, password: form.password,
        options: { data: { name: form.name, username: form.email.split("@")[0] }, emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      const uid = data.user?.id!;
      await new Promise((r) => setTimeout(r, 400));
      await supabase.from("user_roles").insert({ user_id: uid, role: form.role });
      if (form.branchIds.length) {
        await supabase.from("branch_users").insert(form.branchIds.map((bid) => ({ user_id: uid, branch_id: bid })));
      }
      toast.success("تم إنشاء المستخدم");
      setOpen(false);
      setForm({ name: "", email: "", password: "", role: "cashier", branchIds: [] });
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <AdminLayout>
      <PageHeader
        title="المستخدمين"
        subtitle={`${rows.length} مستخدم`}
        actions={<Button className="btn-gradient" onClick={() => setOpen(true)}><Plus className="w-4 h-4 ml-1" /> إضافة مستخدم</Button>}
      />

      <div className="card-elevated p-3 mb-4 bg-primary/10 border-primary/30 flex items-start gap-2 text-sm">
        <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <div>إنشاء المستخدم سيرسل تأكيد بريد إلكتروني افتراضياً. يمكن تعطيل ذلك من إعدادات Lovable Cloud لتفعيل الحساب فوراً.</div>
      </div>

      <DataTable
        loading={loading} rows={rows}
        columns={[
          { key: "name", header: "الاسم", render: (r: any) => <span className="font-semibold">{r.name}</span> },
          { key: "username", header: "اسم المستخدم" },
          { key: "roles", header: "الدور", render: (r: any) => r.roles.map((x: AppRole) => ROLE_LABELS[x]).join("، ") || "—" },
          { key: "branches", header: "الفروع", render: (r: any) => r.branches.join("، ") || "—" },
          { key: "is_active", header: "الحالة", render: (r: any) =>
            <span className={r.is_active ? "text-success" : "text-muted-foreground"}>{r.is_active ? "نشط" : "موقوف"}</span> },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>إضافة مستخدم جديد</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>الاسم الكامل *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" /></div>
            <div><Label>البريد الإلكتروني *</Label><Input type="email" dir="ltr" className="text-right mt-1.5" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>كلمة المرور *</Label><Input type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1.5" /></div>
            <div>
              <Label>الدور</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as AppRole })}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABELS) as AppRole[])
                    .filter((r) => r !== "super_admin")
                    .map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {form.role !== "admin" && (
              <div>
                <Label>الفروع</Label>
                <div className="mt-1.5 grid grid-cols-2 gap-2 max-h-40 overflow-y-auto border border-border rounded-lg p-2">
                  {branches.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 p-2 rounded hover:bg-surface-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.branchIds.includes(b.id)}
                        onChange={(e) => setForm({
                          ...form,
                          branchIds: e.target.checked ? [...form.branchIds, b.id] : form.branchIds.filter((x) => x !== b.id),
                        })}
                      />
                      <span className="text-sm">{b.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={submit}>إنشاء</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
