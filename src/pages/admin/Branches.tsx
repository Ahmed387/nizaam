import { useEffect, useState } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

export default function Branches() {
  const { profile } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", phone: "" });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("branches").select("*").order("created_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm({ name: "", address: "", phone: "" }); setOpen(true); };
  const openEdit = (b: any) => { setEditing(b); setForm({ name: b.name, address: b.address ?? "", phone: b.phone ?? "" }); setOpen(true); };

  const submit = async () => {
    if (!form.name.trim()) return toast.error("اسم الفرع مطلوب");
    if (editing) {
      const { error } = await supabase.from("branches").update(form).eq("id", editing.id);
      if (error) return toast.error(error.message);
      await logAudit({ userId: profile!.id, userName: profile!.name, action: "UPDATE", entity: "Branch", entityId: editing.id, details: form });
      toast.success("تم التعديل");
    } else {
      const { data: codeRes } = await supabase.rpc("next_branch_code");
      const { data, error } = await supabase.from("branches").insert({ ...form, code: codeRes as string }).select().single();
      if (error) return toast.error(error.message);
      await logAudit({ userId: profile!.id, userName: profile!.name, action: "CREATE", entity: "Branch", entityId: data.id, details: form });
      toast.success("تم إنشاء الفرع");
    }
    setOpen(false);
    load();
  };

  const toggle = async (b: any) => {
    await supabase.from("branches").update({ is_active: !b.is_active }).eq("id", b.id);
    await logAudit({ userId: profile!.id, userName: profile!.name, action: "UPDATE", entity: "Branch", entityId: b.id, details: { is_active: !b.is_active } });
    load();
  };

  return (
    <AdminLayout>
      <PageHeader
        title="إدارة الفروع"
        subtitle={`${rows.length} فرع`}
        actions={<Button className="btn-gradient" onClick={openNew}><Plus className="w-4 h-4 ml-1" /> إضافة فرع</Button>}
      />
      <DataTable
        loading={loading} rows={rows}
        onRowClick={(r: any) => nav(`/admin/branches/${r.id}`)}
        columns={[
          { key: "code", header: "الكود", render: (r: any) => <span className="font-mono text-primary">{r.code}</span> },
          { key: "name", header: "الاسم", render: (r: any) => <span className="font-semibold">{r.name}</span> },
          { key: "address", header: "العنوان" },
          { key: "phone", header: "التليفون" },
          { key: "is_active", header: "الحالة", render: (r: any) => (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Switch checked={r.is_active} onCheckedChange={() => toggle(r)} />
              <span className={r.is_active ? "text-success text-xs" : "text-muted-foreground text-xs"}>{r.is_active ? "نشط" : "موقوف"}</span>
            </div>
          )},
          { key: "created_at", header: "تاريخ الإنشاء", render: (r: any) => formatDate(r.created_at) },
          { key: "actions", header: "", render: (r: any) => (
            <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Pencil className="w-4 h-4" /></Button>
              <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(r)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
            </div>
          )},
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "تعديل الفرع" : "إضافة فرع جديد"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>اسم الفرع *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" /></div>
            <div><Label>العنوان</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1.5" /></div>
            <div><Label>التليفون</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1.5" dir="ltr" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={submit}>{editing ? "حفظ" : "إنشاء"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الفرع "{deleteTarget?.name}"؟</AlertDialogTitle>
            <AlertDialogDescription>
              لن يُسمح بالحذف لو كان للفرع موظفين أو مخزون أو فواتير. الأفضل إيقاف تنشيطه.
              <br /><b className="text-destructive">هذا الإجراء لا يمكن التراجع عنه.</b>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={async () => {
                if (!deleteTarget) return;
                setDeleting(true);
                const { error } = await supabase.from("branches").delete().eq("id", deleteTarget.id);
                setDeleting(false);
                if (error) return toast.error(error.message);
                await logAudit({ userId: profile!.id, userName: profile!.name, action: "DELETE", entity: "Branch", entityId: deleteTarget.id, details: { name: deleteTarget.name } });
                toast.success("تم حذف الفرع");
                setDeleteTarget(null);
                load();
              }}
            >
              {deleting ? "جاري الحذف..." : "نعم، احذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
