import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DataTable } from "@/components/DataTable";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { formatEGP, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { Plus } from "lucide-react";

const TYPES = ["إيجار", "كهرباء", "مياه", "نظافة", "صيانة", "مواصلات", "أخرى"];

export default function Expenses() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    type: TYPES[0],
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    description: "",
  });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("expenses")
      .select("*")
      .eq("branch_id", branchId)
      .order("date", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [branchId]);

  const submit = async () => {
    const amt = Number(form.amount);
    if (!form.type || !amt || amt <= 0) return toast.error("أدخل النوع والمبلغ");
    const { data, error } = await supabase
      .from("expenses")
      .insert({
        branch_id: branchId!,
        type: form.type,
        amount: amt,
        date: form.date,
        description: form.description.trim() || null,
        created_by: user!.id,
      })
      .select()
      .single();
    if (error) return toast.error(error.message);

    // Treasury expense
    await supabase.from("treasury").insert({
      branch_id: branchId!,
      type: "expense",
      category: "expense",
      amount: amt,
      description: `${form.type}${form.description ? ` - ${form.description}` : ""}`,
      reference_id: data.id,
      created_by: user!.id,
    });

    await logAudit({
      userId: user!.id, userName: profile?.name ?? "",
      branchId, action: "CREATE", entity: "expense", entityId: data.id,
      details: { type: form.type, amount: amt },
    });

    toast.success("تمت إضافة المصروف وخصمه من الخزنة");
    setOpen(false);
    setForm({ type: TYPES[0], amount: "", date: new Date().toISOString().slice(0, 10), description: "" });
    load();
  };

  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <BranchLayout>
      <PageHeader
        title="المصروفات"
        subtitle={`الإجمالي: ${formatEGP(total)}`}
        actions={
          <Button onClick={() => setOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" /> مصروف جديد
          </Button>
        }
      />

      <DataTable
        loading={loading}
        rows={rows}
        empty="لا توجد مصروفات"
        columns={[
          { key: "date", header: "التاريخ", render: (r: any) => formatDate(r.date) },
          { key: "type", header: "النوع", render: (r: any) => <b>{r.type}</b> },
          { key: "description", header: "الوصف", render: (r: any) => r.description ?? "—" },
          { key: "amount", header: "المبلغ", render: (r: any) => <b className="text-destructive">{formatEGP(r.amount)}</b> },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>إضافة مصروف</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>نوع المصروف</Label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full mt-1 bg-surface border border-border rounded-md px-3 py-2 text-sm"
              >
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><Label>المبلغ *</Label><Input type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1.5" /></div>
            <div><Label>التاريخ</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1.5" /></div>
            <div><Label>الوصف</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1.5" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
