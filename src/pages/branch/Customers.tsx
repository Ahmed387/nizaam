import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export default function Customers({ embedded = false }: { embedded?: boolean } = {}) {
  const { id: branchId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "", notes: "" });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("customers").select("*").eq("branch_id", branchId).order("created_at", { ascending: false });
    setRows(data ?? []); setLoading(false);
  };
  useEffect(() => { load(); }, [branchId]);

  const submit = async () => {
    if (!form.name) return toast.error("الاسم مطلوب");
    await supabase.from("customers").insert({ ...form, branch_id: branchId! });
    toast.success("تمت الإضافة");
    setOpen(false); setForm({ name: "", phone: "", address: "", notes: "" }); load();
  };

  const body = (
    <>
      <PageHeader title="العملاء" subtitle={`${rows.length} عميل`}
        actions={<Button className="btn-gradient" onClick={() => setOpen(true)}><Plus className="w-4 h-4 ml-1" /> إضافة عميل</Button>} />
      <DataTable loading={loading} rows={rows}
        onRowClick={(r: any) => nav(`/branch/${branchId}/customers/${r.id}`)}
        columns={[
          { key: "name", header: "الاسم", render: (r: any) => <span className="font-semibold">{r.name}</span> },
          { key: "phone", header: "التليفون", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
          { key: "address", header: "العنوان", render: (r: any) => r.address ?? "—" },
          { key: "notes", header: "ملاحظات", render: (r: any) => r.notes ?? "—" },
        ]} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>عميل جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>الاسم *</Label><Input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="mt-1.5" /></div>
            <div><Label>التليفون</Label><Input dir="ltr" className="text-right mt-1.5" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} /></div>
            <div><Label>العنوان</Label><Input value={form.address} onChange={(e) => setForm({...form, address: e.target.value})} className="mt-1.5" /></div>
            <div><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} className="mt-1.5" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button className="btn-gradient" onClick={submit}>إضافة</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
  return embedded ? body : <BranchLayout>{body}</BranchLayout>;
}
