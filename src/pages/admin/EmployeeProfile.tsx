import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAudit } from "@/lib/roles";
import { ROLE_LABELS, AppRole } from "@/lib/roles";
import { formatEGP, formatDate, monthKey } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Wallet, Receipt, Pencil, Trash2, Phone, Calendar, Briefcase, MapPin, Power, KeyRound, UserPlus, Unlink } from "lucide-react";

export default function EmployeeProfile() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { user, profile } = useAuth();

  const [emp, setEmp] = useState<any>(null);
  const [branch, setBranch] = useState<any>(null);
  const [advances, setAdvances] = useState<any[]>([]);
  const [salaries, setSalaries] = useState<any[]>([]);
  const [advancePayments, setAdvancePayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Login account info
  const [accountProfile, setAccountProfile] = useState<any>(null);
  const [accountRoles, setAccountRoles] = useState<AppRole[]>([]);
  const [accountBranchIds, setAccountBranchIds] = useState<string[]>([]);
  const [allBranches, setAllBranches] = useState<{ id: string; name: string }[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", job_title: "", phone: "", base_salary: "", hire_date: "", notes: "" });
  const [delOpen, setDelOpen] = useState(false);

  const [advOpen, setAdvOpen] = useState(false);
  const [salOpen, setSalOpen] = useState(false);
  const [advForm, setAdvForm] = useState({ amount: "", monthly_deduct: "", reason: "" });
  const [salForm, setSalForm] = useState({ month: monthKey(), bonuses: "0", deductions: "0", advance_deduct: "0" });

  // Account dialog
  const [acctOpen, setAcctOpen] = useState(false);
  const [acctForm, setAcctForm] = useState({ email: "", password: "", role: "cashier" as AppRole, branchIds: [] as string[] });
  const [unlinkOpen, setUnlinkOpen] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const { data: e } = await supabase.from("employees").select("*").eq("id", id).maybeSingle();
    if (!e) { setLoading(false); return; }
    setEmp(e);
    const [{ data: b }, { data: a }, { data: s }] = await Promise.all([
      supabase.from("branches").select("id, name, code").eq("id", e.branch_id).maybeSingle(),
      supabase.from("advances").select("*").eq("employee_id", id).order("created_at", { ascending: false }),
      supabase.from("salaries").select("*").eq("employee_id", id).order("paid_at", { ascending: false }),
    ]);
    setBranch(b);
    setAdvances(a ?? []);
    setSalaries(s ?? []);
    const advIds = (a ?? []).map((x) => x.id);
    if (advIds.length) {
      const { data: ap } = await supabase.from("advance_payments").select("*").in("advance_id", advIds).order("paid_at", { ascending: false });
      setAdvancePayments(ap ?? []);
    } else setAdvancePayments([]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [id]);

  const totalAdvancesGiven = advances.reduce((s, a) => s + Number(a.amount), 0);
  const totalAdvancesRemaining = advances.reduce((s, a) => s + Number(a.remaining), 0);
  const totalAdvancesPaidBack = totalAdvancesGiven - totalAdvancesRemaining;
  const totalSalariesPaid = salaries.reduce((s, x) => s + Number(x.net_salary), 0);

  const openEdit = () => {
    if (!emp) return;
    setEditForm({
      name: emp.name, job_title: emp.job_title, phone: emp.phone ?? "",
      base_salary: String(emp.base_salary), hire_date: emp.hire_date,
      notes: emp.notes ?? "",
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!editForm.name || !editForm.job_title) return toast.error("املأ الاسم والوظيفة");
    const { error } = await supabase.from("employees").update({
      name: editForm.name, job_title: editForm.job_title, phone: editForm.phone || null,
      base_salary: Number(editForm.base_salary) || 0, hire_date: editForm.hire_date,
      notes: editForm.notes || null,
    }).eq("id", emp.id);
    if (error) return toast.error(error.message);
    toast.success("تم التحديث");
    setEditOpen(false);
    load();
  };

  const toggleActive = async () => {
    const { error } = await supabase.from("employees").update({ is_active: !emp.is_active }).eq("id", emp.id);
    if (error) return toast.error(error.message);
    toast.success(emp.is_active ? "تم إيقاف الموظف" : "تم تنشيط الموظف");
    load();
  };

  const remove = async () => {
    const { error } = await supabase.from("employees").delete().eq("id", emp.id);
    if (error) return toast.error(error.message);
    toast.success("تم حذف الموظف");
    nav("/admin/employees");
  };

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
      branch_id: emp.branch_id, type: "expense", category: "advance",
      amount: amt, description: `سلفة - ${emp.name}`, reference_id: adv.id, created_by: user!.id,
    });
    await logAudit({ userId: user!.id, userName: profile?.name ?? "", branchId: emp.branch_id, action: "CREATE", entity: "advance", entityId: adv.id, details: { employee: emp.name, amount: amt } });
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
    const { data: existing } = await supabase.from("salaries").select("id").eq("employee_id", emp.id).eq("month", salForm.month).maybeSingle();
    if (existing) return toast.error("راتب هذا الشهر مدفوع بالفعل");
    const { data: sal, error } = await supabase.from("salaries").insert({
      employee_id: emp.id, month: salForm.month, base_salary: base,
      bonuses, deductions: ded, advance_deduct: advDed, net_salary: net, paid_by: user!.id,
    }).select().single();
    if (error) return toast.error(error.message);
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
      branch_id: emp.branch_id, type: "expense", category: "salary",
      amount: net, description: `راتب ${salForm.month} - ${emp.name}`, reference_id: sal.id, created_by: user!.id,
    });
    await logAudit({ userId: user!.id, userName: profile?.name ?? "", branchId: emp.branch_id, action: "CREATE", entity: "salary", entityId: sal.id, details: { employee: emp.name, month: salForm.month, net } });
    toast.success("تم دفع الراتب");
    setSalOpen(false);
    setSalForm({ month: monthKey(), bonuses: "0", deductions: "0", advance_deduct: "0" });
    load();
  };

  if (loading) return <AdminLayout><div className="text-center py-12 text-muted-foreground">جاري التحميل...</div></AdminLayout>;
  if (!emp) return <AdminLayout><div className="text-center py-12 text-muted-foreground">الموظف غير موجود</div></AdminLayout>;

  const initials = (emp.name as string).split(" ").slice(0, 2).map((s) => s[0]).join("");

  return (
    <AdminLayout>
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" onClick={() => nav("/admin/employees")}>← كل الموظفين</Button>
      </div>

      {/* Profile header */}
      <div className="card-elevated p-5 mb-4">
        <div className="flex flex-wrap gap-4 items-start justify-between">
          <div className="flex gap-4 items-center">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-3xl font-bold flex items-center justify-center">
              {initials || "؟"}
            </div>
            <div>
              <h1 className="text-2xl font-extrabold">{emp.name}</h1>
              <div className="text-muted-foreground flex items-center gap-2 mt-1">
                <Briefcase className="w-4 h-4" /> {emp.job_title}
              </div>
              <div className="flex items-center gap-3 mt-2 text-sm">
                <span className={`px-2 py-0.5 rounded text-xs ${emp.is_active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                  {emp.is_active ? "نشط" : "موقوف"}
                </span>
                {branch && (
                  <span className="px-2 py-0.5 rounded text-xs bg-primary/10 text-primary flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {branch.name}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={openEdit}><Pencil className="w-4 h-4 ml-1" /> تعديل</Button>
            <Button variant="outline" size="sm" onClick={toggleActive}><Power className="w-4 h-4 ml-1" /> {emp.is_active ? "إيقاف" : "تنشيط"}</Button>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive border-destructive/30" onClick={() => setDelOpen(true)}><Trash2 className="w-4 h-4 ml-1" /> حذف</Button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 mt-5 text-sm">
          <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" /> <span dir="ltr">{emp.phone ?? "—"}</span></div>
          <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-muted-foreground" /> تعيين: {formatDate(emp.hire_date)}</div>
          <div className="flex items-center gap-2"><Wallet className="w-4 h-4 text-muted-foreground" /> راتب: <b>{formatEGP(emp.base_salary)}</b></div>
        </div>
        {emp.notes && <div className="mt-4 p-3 bg-muted/30 rounded text-sm"><b>ملاحظات: </b>{emp.notes}</div>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">الراتب الأساسي</div>
          <div className="text-xl font-extrabold mt-1">{formatEGP(emp.base_salary)}</div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">رواتب مدفوعة</div>
          <div className="text-xl font-extrabold mt-1 text-success">{formatEGP(totalSalariesPaid)}</div>
          <div className="text-xs text-muted-foreground">{salaries.length} شهر</div>
        </div>
        <div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">إجمالي السلف</div>
          <div className="text-xl font-extrabold mt-1">{formatEGP(totalAdvancesGiven)}</div>
          <div className="text-xs text-muted-foreground">سُدد {formatEGP(totalAdvancesPaidBack)}</div>
        </div>
        <div className="card-elevated p-4 border-warning/30 bg-warning/5">
          <div className="text-xs text-warning">سلف متبقية</div>
          <div className="text-xl font-extrabold mt-1 text-warning">{formatEGP(totalAdvancesRemaining)}</div>
        </div>
      </div>

      <Tabs defaultValue="salaries">
        <TabsList>
          <TabsTrigger value="salaries"><Receipt className="w-4 h-4 ml-1" /> الرواتب</TabsTrigger>
          <TabsTrigger value="advances"><Wallet className="w-4 h-4 ml-1" /> السلف</TabsTrigger>
          <TabsTrigger value="payments">سداد السلف</TabsTrigger>
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

        <TabsContent value="payments" className="mt-4">
          <DataTable
            rows={advancePayments}
            empty="لا توجد دفعات سداد"
            columns={[
              { key: "month", header: "شهر السداد" },
              { key: "amount", header: "المبلغ المخصوم", render: (r: any) => <b className="text-warning">{formatEGP(r.amount)}</b> },
              { key: "paid_at", header: "تاريخ السداد", render: (r: any) => formatDate(r.paid_at) },
            ]}
          />
        </TabsContent>
      </Tabs>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>تعديل بيانات الموظف</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>الاسم *</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="mt-1.5" /></div>
            <div><Label>الوظيفة *</Label><Input value={editForm.job_title} onChange={(e) => setEditForm({ ...editForm, job_title: e.target.value })} className="mt-1.5" /></div>
            <div><Label>التليفون</Label><Input dir="ltr" className="text-right mt-1.5" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></div>
            <div><Label>الراتب الأساسي</Label><Input type="number" value={editForm.base_salary} onChange={(e) => setEditForm({ ...editForm, base_salary: e.target.value })} className="mt-1.5" /></div>
            <div><Label>تاريخ التعيين</Label><Input type="date" value={editForm.hire_date} onChange={(e) => setEditForm({ ...editForm, hire_date: e.target.value })} className="mt-1.5" /></div>
            <div><Label>ملاحظات</Label><Textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} className="mt-1.5" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>إلغاء</Button>
            <Button onClick={submitEdit}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Delete confirm */}
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الموظف</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف <b>{emp.name}</b> نهائياً. (الرواتب والسلف المسجلة لن تُحذف.)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={remove}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
