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

export default function Suppliers({ embedded = false }: { embedded?: boolean } = {}) {
  const { id: branchId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ company_name: "", contact_name: "", phone: "", address: "", notes: "" });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("suppliers").select("*").order("created_at", { ascending: false });
    setRows(data ?? []); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.company_name) return toast.error("اسم الشركة مطلوب");
    await supabase.from("suppliers").insert(form);
    toast.success("تمت الإضافة");
    setOpen(false); setForm({ company_name: "", contact_name: "", phone: "", address: "", notes: "" }); load();
  };

  const body = (
    <>
      <PageHeader title="الموردين" subtitle={`${rows.length} مورد`}
        actions={<Button className="btn-gradient" onClick={() => setOpen(true)}><Plus className="w-4 h-4 ml-1" /> إضافة مورد</Button>} />
      <DataTable loading={loading} rows={rows}
        onRowClick={(r: any) => nav(`/branch/${branchId}/suppliers/${r.id}`)}
        columns={[
          { key: "company_name", header: "الشركة", render: (r: any) => <span className="font-semibold">{r.company_name}</span> },
          { key: "contact_name", header: "المسؤول", render: (r: any) => r.contact_name ?? "—" },
          { key: "phone", header: "التليفون", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
          { key: "balance", header: "الرصيد", render: (r: any) => (
            <span className={Number(r.balance) > 0 ? "text-destructive font-bold" : "text-success font-bold"}>
              {formatEGP(r.balance)} {Number(r.balance) > 0 ? "(مدين)" : "(دائن)"}
            </span>
          )},
        ]} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>مورد جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>اسم الشركة *</Label><Input value={form.company_name} onChange={(e) => setForm({...form, company_name: e.target.value})} className="mt-1.5" /></div>
            <div><Label>المسؤول</Label><Input value={form.contact_name} onChange={(e) => setForm({...form, contact_name: e.target.value})} className="mt-1.5" /></div>
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
}
