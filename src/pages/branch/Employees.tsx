import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { formatEGP, formatDate, monthKey } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Wallet, Receipt, ArrowRight } from "lucide-react";

export default function Employees() {
  const { id: branchId } = useParams<{ id: string }>();
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState({ name: "", job_title: "", phone: "", base_salary: "", hire_date: new Date().toISOString().slice(0, 10) });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("employees").select("*").eq("branch_id", branchId).order("created_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [branchId]);

  const submit = async () => {
    if (!form.name || !form.job_title) return toast.error("املأ البيانات");
    const { error } = await supabase.from("employees").insert({
      branch_id: branchId!, name: form.name, job_title: form.job_title, phone: form.phone || null,
      base_salary: Number(form.base_salary) || 0, hire_date: form.hire_date,
    });
    if (error) return toast.error(error.message);
    toast.success("تمت الإضافة");
    setOpen(false);
    setForm({ name: "", job_title: "", phone: "", base_salary: "", hire_date: new Date().toISOString().slice(0, 10) });
    load();
  };

  if (selected) return <EmployeeDetail emp={selected} branchId={branchId!} onBack={() => { setSelected(null); load(); }} />;

  return (
    <BranchLayout>
      <PageHeader
        title="الموظفين"
        subtitle={`${rows.length} موظف`}
        actions={<Button onClick={() => setOpen(true)} className="gap-2"><Plus className="w-4 h-4" /> إضافة موظف</Button>}
      />

      <DataTable
        loading={loading}
        rows={rows}
        onRowClick={setSelected}
        empty="لا يوجد موظفين"
        columns={[
          { key: "name", header: "الاسم", render: (r: any) => <span className="font-semibold">{r.name}</span> },
          { key: "job_title", header: "الوظيفة" },
          { key: "phone", header: "التليفون", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
          { key: "base_salary", header: "الراتب", render: (r: any) => formatEGP(r.base_salary) },
          { key: "hire_date", header: "تاريخ التعيين", render: (r: any) => formatDate(r.hire_date) },
          { key: "is_active", header: "الحالة", render: (r: any) => <span className={r.is_active ? "text-success" : "text-muted-foreground"}>{r.is_active ? "نشط" : "موقوف"}</span> },
          { key: "go", header: "", render: () => <ArrowRight className="w-4 h-4 text-muted-foreground" /> },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>موظف جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>الاسم *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" /></div>
            <div><Label>الوظيفة *</Label><Input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} className="mt-1.5" /></div>
            <div><Label>التليفون</Label><Input dir="ltr" className="text-right mt-1.5" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>الراتب الأساسي</Label><Input type="number" value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} className="mt-1.5" /></div>
            <div><Label>تاريخ التعيين</Label><Input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} className="mt-1.5" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit}>إضافة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}

function EmployeeDetail({ emp, branchId, onBack }: { emp: any; branchId: string; onBack: () => void }) {
  const { user, profile } = useAuth();
  const [advances, setAdvances] = useState<any[]>([]);
  const [salaries, setSalaries] = useState<any[]>([]);
  const [advOpen, setAdvOpen] = useState(false);
  const [salOpen, setSalOpen] = useState(false);
  const [advForm, setAdvForm] = useState({ amount: "", monthly_deduct: "", reason: "" });
  const [salForm, setSalForm] = useState({ month: monthKey(), bonuses: "0", deductions: "0", advance_deduct: "0" });

  const load = async () => {
    const [{ data: a }, { data: s }] = await Promise.all([
      supabase.from("advances").select("*").eq("employee_id", emp.id).order("created_at", { ascending: false }),
      supabase.from("salaries").select("*").eq("employee_id", emp.id).order("paid_at", { ascending: false }),
    ]);
    setAdvances(a ?? []);
    setSalaries(s ?? []);
  };
  useEffect(() => { load(); }, [emp.id]);

  const totalAdvancesRemaining = advances.reduce((s, a) => s + Number(a.remaining), 0);

  const submitAdvance = async () => {
    const amt = Number(advForm.amount);
    const md = Number(advForm.monthly_deduct);
    if (!amt || amt <= 0) return toast.error("أدخل المبلغ");
    if (!md || md <= 0) return toast.error("أدخل قيمة الخصم الشهري");

    const { data: adv, error } = await supabase.from("advances").insert({
      employee_id: emp.id, amount: amt, monthly_deduct: md, remaining: amt, reason: advForm.reason || null,
    }).select().single();
    if (error) return toast.error(error.message);

    await supabase.from("treasury").insert({
      branch_id: branchId, type: "expense", category: "advance",
      amount: amt, description: `سلفة - ${emp.name}`, reference_id: adv.id, created_by: user!.id,
    });

    await logAudit({ userId: user!.id, userName: profile?.name ?? "", branchId, action: "CREATE", entity: "advance", entityId: adv.id, details: { employee: emp.name, amount: amt } });

    toast.success("تم صرف السلفة");
    setAdvOpen(false);
    setAdvForm({ amount: "", monthly_deduct: "", reason: "" });
    load();
  };

  const submitSalary = async () => {
    const base = Number(emp.base_salary);
    const bonuses = Number(salForm.bonuses) || 0;
    const ded = Number(salForm.deductions) || 0;
    const advDed = Number(salForm.advance_deduct) || 0;
    const net = base + bonuses - ded - advDed;
    if (net <= 0) return toast.error("صافي الراتب يجب أن يكون موجباً");
    if (advDed > totalAdvancesRemaining) return toast.error("خصم السلف أكبر من الرصيد المتبقي");

    // Check if month already paid
    const { data: existing } = await supabase.from("salaries").select("id").eq("employee_id", emp.id).eq("month", salForm.month).maybeSingle();
    if (existing) return toast.error("راتب هذا الشهر مدفوع بالفعل");

    const { data: sal, error } = await supabase.from("salaries").insert({
      employee_id: emp.id, month: salForm.month, base_salary: base,
      bonuses, deductions: ded, advance_deduct: advDed, net_salary: net, paid_by: user!.id,
    }).select().single();
    if (error) return toast.error(error.message);

    // Apply advance deductions FIFO
    let toDeduct = advDed;
    for (const a of advances) {
      if (toDeduct <= 0) break;
      const take = Math.min(toDeduct, Number(a.remaining));
      if (take > 0) {
        await supabase.from("advances").update({ remaining: Number(a.remaining) - take }).eq("id", a.id);
        await supabase.from("advance_payments").insert({ advance_id: a.id, amount: take, month: salForm.month });
        toDeduct -= take;
      }
    }

    await supabase.from("treasury").insert({
      branch_id: branchId, type: "expense", category: "salary",
      amount: net, description: `راتب ${salForm.month} - ${emp.name}`, reference_id: sal.id, created_by: user!.id,
    });

    await logAudit({ userId: user!.id, userName: profile?.name ?? "", branchId, action: "CREATE", entity: "salary", entityId: sal.id, details: { employee: emp.name, month: salForm.month, net } });

    toast.success("تم دفع الراتب");
    setSalOpen(false);
    setSalForm({ month: monthKey(), bonuses: "0", deductions: "0", advance_deduct: "0" });
    load();
  };

  return (
    <BranchLayout>
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" onClick={onBack}>← العودة</Button>
      </div>
      <PageHeader title={emp.name} subtitle={`${emp.job_title} • راتب ${formatEGP(emp.base_salary)}`} />

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="card-elevated p-4">
          <div className="text-sm text-muted-foreground">الراتب الأساسي</div>
          <div className="text-2xl font-extrabold mt-1">{formatEGP(emp.base_salary)}</div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-sm text-muted-foreground">سلف متبقية</div>
          <div className="text-2xl font-extrabold mt-1 text-warning">{formatEGP(totalAdvancesRemaining)}</div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-sm text-muted-foreground">رواتب مدفوعة</div>
          <div className="text-2xl font-extrabold mt-1 text-success">{salaries.length} شهر</div>
        </div>
      </div>

      <Tabs defaultValue="salaries">
        <TabsList>
          <TabsTrigger value="salaries"><Receipt className="w-4 h-4 ml-1" /> الرواتب</TabsTrigger>
          <TabsTrigger value="advances"><Wallet className="w-4 h-4 ml-1" /> السلف</TabsTrigger>
        </TabsList>

        <TabsContent value="salaries" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button onClick={() => setSalOpen(true)} className="gap-2"><Plus className="w-4 h-4" /> دفع راتب</Button>
          </div>
          <DataTable
            rows={salaries}
            empty="لا توجد رواتب مدفوعة"
            columns={[
              { key: "month", header: "الشهر" },
              { key: "base_salary", header: "أساسي", render: (r: any) => formatEGP(r.base_salary) },
              { key: "bonuses", header: "حوافز", render: (r: any) => <span className="text-success">{formatEGP(r.bonuses)}</span> },
              { key: "deductions", header: "خصومات", render: (r: any) => <span className="text-destructive">{formatEGP(r.deductions)}</span> },
              { key: "advance_deduct", header: "خصم سلف", render: (r: any) => <span className="text-warning">{formatEGP(r.advance_deduct)}</span> },
              { key: "net_salary", header: "الصافي", render: (r: any) => <b className="text-primary">{formatEGP(r.net_salary)}</b> },
              { key: "paid_at", header: "تاريخ الصرف", render: (r: any) => formatDate(r.paid_at) },
            ]}
          />
        </TabsContent>

        <TabsContent value="advances" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button onClick={() => setAdvOpen(true)} className="gap-2"><Plus className="w-4 h-4" /> سلفة جديدة</Button>
          </div>
          <DataTable
            rows={advances}
            empty="لا توجد سلف"
            columns={[
              { key: "created_at", header: "التاريخ", render: (r: any) => formatDate(r.created_at) },
              { key: "amount", header: "المبلغ", render: (r: any) => formatEGP(r.amount) },
              { key: "monthly_deduct", header: "خصم شهري", render: (r: any) => formatEGP(r.monthly_deduct) },
              { key: "remaining", header: "المتبقي", render: (r: any) => <b className={Number(r.remaining) > 0 ? "text-warning" : "text-success"}>{formatEGP(r.remaining)}</b> },
              { key: "reason", header: "السبب", render: (r: any) => r.reason ?? "—" },
            ]}
          />
        </TabsContent>
      </Tabs>

      {/* Advance dialog */}
      <Dialog open={advOpen} onOpenChange={setAdvOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>صرف سلفة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>المبلغ *</Label><Input type="number" value={advForm.amount} onChange={(e) => setAdvForm({ ...advForm, amount: e.target.value })} className="mt-1.5" /></div>
            <div><Label>الخصم الشهري *</Label><Input type="number" value={advForm.monthly_deduct} onChange={(e) => setAdvForm({ ...advForm, monthly_deduct: e.target.value })} className="mt-1.5" /></div>
            <div><Label>السبب</Label><Textarea rows={2} value={advForm.reason} onChange={(e) => setAdvForm({ ...advForm, reason: e.target.value })} className="mt-1.5" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdvOpen(false)}>إلغاء</Button>
            <Button onClick={submitAdvance}>صرف وخصم من الخزنة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Salary dialog */}
      <Dialog open={salOpen} onOpenChange={setSalOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>دفع راتب شهر</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>الشهر (YYYY-MM) *</Label><Input value={salForm.month} onChange={(e) => setSalForm({ ...salForm, month: e.target.value })} className="mt-1.5" placeholder="2026-04" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>الأساسي</Label><Input disabled value={emp.base_salary} className="mt-1.5" /></div>
              <div><Label>الحوافز</Label><Input type="number" value={salForm.bonuses} onChange={(e) => setSalForm({ ...salForm, bonuses: e.target.value })} className="mt-1.5" /></div>
              <div><Label>خصومات</Label><Input type="number" value={salForm.deductions} onChange={(e) => setSalForm({ ...salForm, deductions: e.target.value })} className="mt-1.5" /></div>
              <div><Label>خصم سلف (متاح: {formatEGP(totalAdvancesRemaining)})</Label><Input type="number" value={salForm.advance_deduct} onChange={(e) => setSalForm({ ...salForm, advance_deduct: e.target.value })} className="mt-1.5" /></div>
            </div>
            <div className="bg-surface-2 rounded-lg p-3 flex justify-between text-lg">
              <span>الصافي</span>
              <b className="text-primary">{formatEGP(Number(emp.base_salary) + Number(salForm.bonuses || 0) - Number(salForm.deductions || 0) - Number(salForm.advance_deduct || 0))}</b>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSalOpen(false)}>إلغاء</Button>
            <Button onClick={submitSalary}>دفع الراتب</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BranchLayout>
  );
}
