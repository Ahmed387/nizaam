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
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";

export default function Suppliers({ embedded = false }: { embedded?: boolean } = {}) {
  const { id: branchId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", contact_person: "", phone: "", address: "", notes: "" });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("contacts").select("*")
      .in("type", ["supplier", "both"])
      .order("created_at", { ascending: false });
    setRows(data ?? []); setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefresh(["contacts"], load);

  const submit = async () => {
    if (!form.name) return toast.error("اسم الشركة مطلوب");
    await supabase.from("contacts").insert({ ...form, type: "supplier" });
    toast.success("تمت الإضافة");
    setOpen(false); setForm({ name: "", contact_person: "", phone: "", address: "", notes: "" }); load();
  };

  const body = (
    <>
      <PageHeader title="الموردين" subtitle={`${rows.length} مورد`}
        actions={<Button className="btn-gradient" onClick={() => setOpen(true)}><Plus className="w-4 h-4 ml-1" /> إضافة مورد</Button>} />
      <DataTable loading={loading} rows={rows}
        onRowClick={(r: any) => nav(`/branch/${branchId}/suppliers/${r.id}`)}
        columns={[
          { key: "name", header: "الشركة", render: (r: any) => <span className="font-semibold">{r.name}</span> },
          { key: "contact_person", header: "المسؤول", render: (r: any) => r.contact_person ?? "—" },
          { key: "phone", header: "التليفون", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
          { key: "balance", header: "الرصيد", render: (r: any) => {
            const b = Number(r.balance);
            if (b === 0) return <span className="text-muted-foreground">—</span>;
            // + = لينا (مرتجع متبقي)، − = علينا للمورد
            return b > 0
              ? <span className="text-success font-bold">{formatEGP(b)} (لنا)</span>
              : <span className="text-destructive font-bold">{formatEGP(Math.abs(b))} (علينا)</span>;
          }},
        ]} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>مورد جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>اسم الشركة *</Label><Input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="mt-1.5" /></div>
            <div><Label>المسؤول</Label><Input value={form.contact_person} onChange={(e) => setForm({...form, contact_person: e.target.value})} className="mt-1.5" /></div>
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
