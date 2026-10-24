import { useEffect, useState } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useNavigate } from "react-router-dom";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
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
import { Plus, Pencil, Trash2, AlertTriangle, Clock, X } from "lucide-react";
import { rpcErrorText } from "@/lib/rpcError";

export default function Branches({ embedded }: { embedded?: boolean } = {}) {
  const { profile } = useAuth();
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", phone: "" });
  // Branch limit set by the platform owner (migration 0109): {limit, used, at_limit, pending}
  const [limit, setLimit] = useState<{ limit: number; used: number; at_limit: boolean; pending: { branch_name: string } | null } | null>(null);
  const [req, setReq] = useState({ branch_name: "", note: "" });
  const [sending, setSending] = useState(false);
  // The limit box stays hidden until «إضافة فرع» is pressed at the limit; it has its own close button.
  const [showLimit, setShowLimit] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("branches").select("*").order("created_at", { ascending: false });
    setRows((data ?? []).filter((b: any) => !b.is_system && b.code !== "PARTNER-CASH"));
    const { data: st } = await supabase.rpc("branch_limit_status" as any);
    setLimit((st as any) ?? null);
    setLoading(false);
  };

  const sendRequest = async () => {
    if (!req.branch_name.trim()) return toast.error("اكتب اسم الفرع اللي عاوز تضيفه");
    setSending(true);
    const { error } = await supabase.rpc("request_branch_increase" as any, { p_branch_name: req.branch_name, p_note: req.note || null } as any);
    setSending(false);
    if (error) return toast.error(rpcErrorText(error, "طلب فرع زيادة"));
    toast.success("الطلب اتبعت لصاحب المنصة — هيوصلك تنبيه لما يرد");
    setReq({ branch_name: "", note: "" });
    load();
  };

  // At the limit «إضافة فرع» opens the request box instead of the new-branch form.
  const onAdd = () => (limit?.at_limit ? setShowLimit(true) : openNew());
  useEffect(() => { load(); }, []);
  useRealtimeRefresh(["branches"], load);

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
    <ConditionalLayout variant="admin" embedded={embedded}>
      <PageHeader
        title="إدارة الفروع"
        subtitle={limit ? `${limit.used} من ${limit.limit} فروع مسموح` : `${rows.length} فرع`}
        actions={<Button className="btn-gradient" onClick={onAdd}><Plus className="w-4 h-4 ml-1" /> إضافة فرع</Button>}
      />
      {limit?.at_limit && showLimit && (
        <section aria-labelledby="limit-title" className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-5 grid gap-3">
          <div className="flex items-start justify-between gap-3">
            <h2 id="limit-title" className="flex items-center gap-2 text-lg font-extrabold">
              <AlertTriangle className="w-5 h-5 text-warning" /> وصلت للحد المسموح من الفروع ({limit.used} من {limit.limit})
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setShowLimit(false)} aria-label="إخفاء رسالة الحد">
              <X className="w-4 h-4 ml-1" /> إخفاء
            </Button>
          </div>
          {limit.pending ? (
            <p className="flex items-center gap-2 text-sm"><Clock className="w-4 h-4" /> طلبك لفرع «{limit.pending.branch_name}» وصل لصاحب المنصة ومستني ردّه.</p>
          ) : (
            <>
              <p className="text-sm">تواصل مع صاحب المنصة لمناقشة طلبك. ابعت الطلب من هنا، وهيوصله على طول.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1"><Label htmlFor="rq-name">اسم الفرع اللي عاوز تضيفه</Label><Input id="rq-name" value={req.branch_name} onChange={(e) => setReq({ ...req, branch_name: e.target.value })} placeholder="مثلاً: فرع المنصورة" /></div>
                <div className="grid gap-1"><Label htmlFor="rq-note">رسالة لصاحب المنصة (اختياري)</Label><Input id="rq-note" value={req.note} onChange={(e) => setReq({ ...req, note: e.target.value })} /></div>
              </div>
              <div><Button className="btn-gradient" disabled={sending} onClick={sendRequest}>ابعت الطلب</Button></div>
            </>
          )}
        </section>
      )}
      <DataTable

        loading={loading} rows={rows}
        onRowClick={(r: any) => window.open(`/admin/branches/${r.id}`, "_blank", "noopener,noreferrer")}
        columns={[
          { key: "code", header: "الكود", width: "110px", render: (r: any) => <span className="font-mono text-primary font-semibold">{r.code}</span> },
          { key: "name", header: "الاسم", render: (r: any) => <span className="font-semibold">{r.name}</span> },
          { key: "address", header: "العنوان", render: (r: any) => <span className="text-muted-foreground">{r.address || "—"}</span> },
          { key: "phone", header: "التليفون", width: "140px", render: (r: any) => <span className="font-mono tabular-nums" dir="ltr">{r.phone || "—"}</span> },
          { key: "is_active", header: "الحالة", align: "center", width: "120px", render: (r: any) => (
            r.platform_paused ? (
              <span className="text-destructive text-xs font-bold" title={r.platform_paused_reason ?? undefined}>موقوف من إدارة المنصة</span>
            ) : (
            <div className="flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Switch checked={r.is_active} onCheckedChange={() => toggle(r)} />
              <span className={r.is_active ? "text-success text-xs font-medium" : "text-muted-foreground text-xs"}>{r.is_active ? "نشط" : "موقوف"}</span>
            </div>
            )
          )},
          { key: "created_at", header: "تاريخ الإنشاء", width: "140px", render: (r: any) => <span className="text-muted-foreground text-xs">{formatDate(r.created_at)}</span> },
          { key: "actions", header: "", align: "left", width: "100px", render: (r: any) => (
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
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
    </ConditionalLayout>
  );
}
