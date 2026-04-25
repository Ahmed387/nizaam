import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatEGP, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export default function Employees() {
  const { id: branchId } = useParams<{ id: string }>();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", job_title: "", phone: "", base_salary: "", hire_date: new Date().toISOString().slice(0, 10) });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("employees").select("*").eq("branch_id", branchId).order("created_at", { ascending: false });
    setRows(data ?? []); setLoading(false);
  };
  useEffect(() => { load(); }, [branchId]);

  const submit = async () => {
    if (!form.name || !form.job_title) return toast.error("املأ البيانات");
    await supabase.from("employees").insert({
      branch_id: branchId!, name: form.name, job_title: form.job_title, phone: form.phone,
      base_salary: Number(form.base_salary) || 0, hire_date: form.hire_date,
    });
    toast.success("تمت الإضافة");
    setOpen(false); setForm({ name: "", job_title: "", phone: "", base_salary: "", hire_date: new Date().toISOString().slice(0, 10) }); load();
  };

  return (
    <BranchLayout>
      <PageHeader title="الموظفين" subtitle={`${rows.length} موظف`}
        actions={<Button className="btn-gradient" onClick={() => setOpen(true)}><Plus className="w-4 h-4 ml-1" /> إضافة موظف</Button>} />
      <DataTable loading={loading} rows={rows}
        columns={[
          { key: "name", header: "الاسم", render: (r: any) => <span className="font-semibold">{r.name}</span> },
          { key: "job_title", header: "الوظيفة" },
          { key: "phone", header: "التليفون", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
          { key: "base_salary", header: "الراتب الأساسي", render: (r: any) => formatEGP(r.base_salary) },
          { key: "hire_date", header: "تاريخ التعيين", render: (r: any) => formatDate(r.hire_date) },
          { key: "is_active", header: "الحالة", render: (r: any) => <span className={r.is_active ? "text-success" : "text-muted-foreground"}>{r.is_active ? "نشط" : "موقوف"}</span> },
        ]} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>موظف جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>الاسم *</Label><Input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="mt-1.5" /></div>
            <div><Label>الوظيفة *</Label><Input value={form.job_title} onChange={(e) => setForm({...form, job_title: e.target.value})} className="mt-1.5" /></div>
            <div><Label>التليفون</Label><Input dir="ltr" className="text-right mt-1.5" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} /></div>
            <div><Label>الراتب الأساسي</Label><Input type="number" value={form.base_salary} onChange={(e) => setForm({...form, base_salary: e.target.value})} className="mt-1.5" /></div>
            <div><Label>تاريخ التعيين</Label><Input type="date" value={form.hire_date} onChange={(e) => setForm({...form, hire_date: e.target.value})} className="mt-1.5" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button className="btn-gradient" onClick={submit}>إضافة</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
