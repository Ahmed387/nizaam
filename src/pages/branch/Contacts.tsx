import { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Users, UserCheck, Truck, UserPlus, TruckIcon, Pencil, Trash2 } from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useAuth } from "@/contexts/AuthContext";
import { createApprovalRequest } from "@/lib/approvalRequests";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

type ContactType = "customer" | "supplier" | "both";

const TYPE_LABELS: Record<ContactType, string> = {
  customer: "عميل",
  supplier: "مورد",
  both: "عميل ومورد",
};

export default function Contacts() {
  const { id: branchId } = useParams<{ id: string }>();
  const { tenantId, user, profile, isAdmin, hasRole } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const filter = (sp.get("tab") ?? "all") as "all" | ContactType;

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [reqReason, setReqReason] = useState("");
  const [form, setForm] = useState({
    name: "",
    type: "customer" as ContactType,
    contact_person: "",
    phone: "",
    address: "",
    notes: "",
  });
  const [search, setSearch] = useState("");
  const isManager = hasRole("branch_manager");

  const load = async () => {
    setLoading(true);
    let q = supabase.from("contacts").select("*").order("created_at", { ascending: false });
    // الموردين بدون فرع، العملاء عادة بفرع — هنعرض كل الجهات للفرع + الجهات اللي ملهاش فرع
    q = q.or(`branch_id.eq.${branchId},branch_id.is.null`);
    const { data } = await q;
    setRows(data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [branchId]);
  useRealtimeRefresh(["contacts"], load);

  const filtered = useMemo(() => {
    let r = rows;
    if (filter !== "all") {
      r = r.filter((x) => x.type === filter || x.type === "both");
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((x) =>
        (x.name ?? "").toLowerCase().includes(s) ||
        (x.phone ?? "").includes(s) ||
        (x.contact_person ?? "").toLowerCase().includes(s)
      );
    }
    return r;
  }, [rows, filter, search]);

  const counts = useMemo(() => ({
    all: rows.length,
    customer: rows.filter((r) => r.type === "customer" || r.type === "both").length,
    supplier: rows.filter((r) => r.type === "supplier" || r.type === "both").length,
    both: rows.filter((r) => r.type === "both").length,
  }), [rows]);

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", type: "customer", contact_person: "", phone: "", address: "", notes: "" });
    setOpen(true);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      name: r.name ?? "",
      type: (r.type ?? "customer") as ContactType,
      contact_person: r.contact_person ?? "",
      phone: r.phone ?? "",
      address: r.address ?? "",
      notes: r.notes ?? "",
    });
    setReqReason("");
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name) return toast.error("الاسم مطلوب");

    // EDIT
    if (editing) {
      const payload: any = {
        name: form.name,
        contact_person: form.contact_person || null,
        phone: form.phone || null,
        address: form.address || null,
        notes: form.notes || null,
      };
      if (isAdmin) {
        const { error } = await supabase.from("contacts").update(payload).eq("id", editing.id);
        if (error) return toast.error(error.message);
        toast.success("تم التحديث");
      } else if (isManager) {
        if (!reqReason.trim()) return toast.error("اكتب سبب التعديل");
        const ok = await createApprovalRequest({
          tenantId: tenantId!, branchId: branchId ?? null,
          entityType: "contact", entityId: editing.id, entityLabel: editing.name,
          action: "update", payload, reason: reqReason,
          requestedBy: user!.id, requestedByName: profile?.name ?? "—",
        });
        if (!ok) return;
      } else {
        return toast.error("غير مصرح");
      }
      setOpen(false);
      setEditing(null);
      load();
      return;
    }

    // NEW
    const payload: any = {
      name: form.name,
      type: form.type,
      contact_person: form.contact_person || null,
      phone: form.phone || null,
      address: form.address || null,
      notes: form.notes || null,
      branch_id: form.type === "supplier" ? null : branchId,
    };
    const { error } = await supabase.from("contacts").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("تمت الإضافة");
    setOpen(false);
    setForm({ name: "", type: "customer", contact_person: "", phone: "", address: "", notes: "" });
    load();
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    if (isAdmin) {
      const { error } = await supabase.from("contacts").delete().eq("id", deleteTarget.id);
      if (error) return toast.error(error.message);
      toast.success("تم الحذف");
    } else if (isManager) {
      if (!reqReason.trim()) return toast.error("اكتب سبب الحذف");
      const ok = await createApprovalRequest({
        tenantId: tenantId!, branchId: branchId ?? null,
        entityType: "contact", entityId: deleteTarget.id, entityLabel: deleteTarget.name,
        action: "delete", reason: reqReason,
        requestedBy: user!.id, requestedByName: profile?.name ?? "—",
      });
      if (!ok) return;
    } else {
      return toast.error("غير مصرح");
    }
    setDeleteTarget(null);
    setReqReason("");
    load();
  };

  const goToProfile = (r: any) => {
    nav(`/branch/${branchId}/contacts/${r.id}`);
  };

  const promoteToBoth = async (r: any, asWhat: "customer" | "supplier") => {
    if (r.type === "both") return;
    // لو حاليًا عميل وعايز نضيفه كمورد، أو العكس → النوع يصبح both
    const { error } = await supabase.from("contacts").update({ type: "both" } as any).eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success(asWhat === "supplier" ? "تمت إضافته كمورد أيضاً" : "تمت إضافته كعميل أيضاً");
    load();
  };

  return (
    <BranchLayout>
      <PageHeader
        title="جهات التواصل"
        subtitle={
          counts.both > 0
            ? `${counts.all} جهة • ${counts.customer - counts.both} عميل • ${counts.supplier - counts.both} مورد • ${counts.both} عميل ومورد`
            : `${counts.all} جهة • ${counts.customer} عميل • ${counts.supplier} مورد`
        }
        actions={
          <Button className="btn-gradient" onClick={openNew}>
            <Plus className="w-4 h-4 ml-1" /> إضافة جهة
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3 mb-4 items-center justify-between">
        <Tabs value={filter} onValueChange={(v) => setSp({ tab: v })}>
          <TabsList>
            <TabsTrigger value="all" className="gap-1.5">
              <Users className="w-3.5 h-3.5" /> الكل <Badge variant="secondary" className="ml-1">{counts.all}</Badge>
            </TabsTrigger>
            <TabsTrigger value="customer" className="gap-1.5">
              <UserCheck className="w-3.5 h-3.5" /> عملاء <Badge variant="secondary" className="ml-1">{counts.customer}</Badge>
            </TabsTrigger>
            <TabsTrigger value="supplier" className="gap-1.5">
              <Truck className="w-3.5 h-3.5" /> موردين <Badge variant="secondary" className="ml-1">{counts.supplier}</Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          placeholder="بحث بالاسم أو التليفون..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <DataTable
        loading={loading}
        rows={filtered}
        onRowClick={goToProfile}
        columns={[
          {
            key: "name",
            header: "الاسم",
            render: (r: any) => (
              <div>
                <div className="font-semibold">{r.name}</div>
                {r.contact_person && <div className="text-xs text-muted-foreground">{r.contact_person}</div>}
              </div>
            ),
          },
          {
            key: "type",
            header: "النوع",
            render: (r: any) => {
              const t = r.type as ContactType;
              const variant = t === "customer" ? "default" : t === "supplier" ? "secondary" : "outline";
              return <Badge variant={variant as any}>{TYPE_LABELS[t]}</Badge>;
            },
          },
          { key: "phone", header: "التليفون", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
          { key: "address", header: "العنوان", render: (r: any) => r.address ?? "—" },
          {
            key: "balance",
            header: "الرصيد",
            render: (r: any) => {
              const b = Number(r.balance ?? 0);
              if (Math.abs(b) < 0.01) return <span className="text-muted-foreground">—</span>;
              return b > 0
                ? <span className="text-success font-bold">{formatEGP(b)} <span className="text-xs">(لنا)</span></span>
                : <span className="text-destructive font-bold">{formatEGP(Math.abs(b))} <span className="text-xs">(علينا)</span></span>;
            },
          },
          {
            key: "actions",
            header: "إجراءات",
            render: (r: any) => (
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                {r.type === "customer" && (
                  <Button size="sm" variant="outline" title="إضافة كمورد أيضاً" onClick={() => promoteToBoth(r, "supplier")}>
                    <TruckIcon className="w-3.5 h-3.5" />
                  </Button>
                )}
                {r.type === "supplier" && (
                  <Button size="sm" variant="outline" title="إضافة كعميل أيضاً" onClick={() => promoteToBoth(r, "customer")}>
                    <UserPlus className="w-3.5 h-3.5" />
                  </Button>
                )}
                {(isAdmin || isManager) && (
                  <Button size="sm" variant="outline" title={isAdmin ? "تعديل" : "طلب تعديل"} onClick={() => openEdit(r)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                )}
                {(isAdmin || isManager) && (
                  <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" title={isAdmin ? "حذف" : "طلب حذف"} onClick={() => { setDeleteTarget(r); setReqReason(""); }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? (isAdmin ? "تعديل جهة" : "طلب تعديل جهة") : "إضافة جهة جديدة"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {!editing && (
              <div>
                <Label>النوع *</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as ContactType })}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">عميل</SelectItem>
                    <SelectItem value="supplier">مورد</SelectItem>
                    <SelectItem value="both">عميل ومورد</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>الاسم *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>المسؤول</Label>
              <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>التليفون</Label>
              <Input dir="ltr" className="text-right mt-1.5" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <Label>العنوان</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>ملاحظات</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1.5" />
            </div>
            {editing && isManager && !isAdmin && (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                <Label>سبب التعديل (للموافقة) *</Label>
                <Textarea value={reqReason} onChange={(e) => setReqReason(e.target.value)} className="mt-1.5" placeholder="سيُرسل لمدير الشركة للموافقة" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={submit}>{editing ? (isAdmin ? "حفظ" : "إرسال طلب التعديل") : "إضافة"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setReqReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isManager && !isAdmin ? "طلب حذف للموافقة" : "حذف الجهة"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isManager && !isAdmin ? (
                <>سيتم إرسال طلب حذف <b>{deleteTarget?.name}</b> لمدير الشركة للموافقة.</>
              ) : (
                <>هل أنت متأكد من حذف <b>{deleteTarget?.name}</b>؟ لن يمكن التراجع.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {isManager && !isAdmin && (
            <div className="px-1">
              <Label>سبب الحذف *</Label>
              <Textarea className="mt-1.5" value={reqReason} onChange={(e) => setReqReason(e.target.value)} placeholder="اكتب سبب طلب الحذف..." />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={onDelete}>
              {isManager && !isAdmin ? "إرسال طلب الحذف" : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BranchLayout>
  );
}
