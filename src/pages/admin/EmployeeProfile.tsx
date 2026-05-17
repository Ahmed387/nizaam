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
import { Plus, Wallet, Receipt, Pencil, Trash2, Phone, Calendar, Briefcase, MapPin, Power, KeyRound, UserPlus, Unlink, IdCard, Upload, Eye } from "lucide-react";

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
  const [editForm, setEditForm] = useState({ name: "", job_title: "", phone: "", email: "", login_password: "", base_salary: "", hire_date: "", notes: "", national_id: "" });
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
    const [{ data: b }, { data: a }, { data: s }, { data: br }] = await Promise.all([
      supabase.from("branches").select("id, name, code").eq("id", e.branch_id).maybeSingle(),
      supabase.from("advances").select("*").eq("employee_id", id).order("created_at", { ascending: false }),
      supabase.from("salaries").select("*").eq("employee_id", id).order("paid_at", { ascending: false }),
      supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    ]);
    setBranch(b);
    setAdvances(a ?? []);
    setSalaries(s ?? []);
    setAllBranches(br ?? []);
    const advIds = (a ?? []).map((x) => x.id);
    if (advIds.length) {
      const { data: ap } = await supabase.from("advance_payments").select("*").in("advance_id", advIds).order("paid_at", { ascending: false });
      setAdvancePayments(ap ?? []);
    } else setAdvancePayments([]);

    // Load login account if linked
    if ((e as any).user_id) {
      const [{ data: prof }, { data: rs }, { data: bus }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", (e as any).user_id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", (e as any).user_id),
        supabase.from("branch_users").select("branch_id").eq("user_id", (e as any).user_id),
      ]);
      setAccountProfile(prof);
      setAccountRoles((rs ?? []).map((r: any) => r.role));
      setAccountBranchIds((bus ?? []).map((x: any) => x.branch_id));
    } else {
      setAccountProfile(null);
      setAccountRoles([]);
      setAccountBranchIds([]);
    }
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
      name: emp.name, job_title: emp.job_title, phone: emp.phone ?? "", email: emp.email ?? "", login_password: "",
      base_salary: String(emp.base_salary), hire_date: emp.hire_date,
      notes: emp.notes ?? "",
      national_id: emp.national_id ?? "",
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!editForm.name || !editForm.job_title) return toast.error("املأ الاسم والوظيفة");
    const updatePayload: any = {
      name: editForm.name, job_title: editForm.job_title, phone: editForm.phone || null,
      email: editForm.email?.trim() || null,
      base_salary: Number(editForm.base_salary) || 0, hire_date: editForm.hire_date,
      notes: editForm.notes || null,
      national_id: editForm.national_id?.trim() || null,
    };
    if (editForm.login_password) {
      updatePayload.login_password = editForm.login_password;
    }
    const { error } = await supabase.from("employees").update(updatePayload).eq("id", emp.id);
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

    // Notify employee that their salary has been paid
    if (emp.user_id) {
      const parts = [
        `صافي: ${formatEGP(net)}`,
        `أساسي: ${formatEGP(base)}`,
      ];
      if (bonuses > 0) parts.push(`حوافز: ${formatEGP(bonuses)}`);
      if (ded > 0) parts.push(`خصومات: ${formatEGP(ded)}`);
      if (advDed > 0) parts.push(`خصم سلف: ${formatEGP(advDed)}`);
      const { notify } = await import("@/lib/notifications");
      await notify({
        userId: emp.user_id,
        title: `💰 تم صرف مرتبك لشهر ${salForm.month}`,
        body: parts.join(" — "),
        type: "salary_paid",
        link: "/profile",
        relatedEntity: "salary",
        relatedEntityId: sal.id,
      });
    }

    toast.success("تم دفع الراتب");
    setSalOpen(false);
    setSalForm({ month: monthKey(), bonuses: "0", deductions: "0", advance_deduct: "0" });
    load();
  };

  const openCreateAccount = () => {
    setAcctForm({ email: "", password: "", role: "cashier", branchIds: emp.branch_id ? [emp.branch_id] : [] });
    setAcctOpen(true);
  };

  const submitCreateAccount = async () => {
    if (!acctForm.email || !acctForm.password) return toast.error("أدخل البريد وكلمة المرور");
    if (acctForm.password.length < 8) return toast.error("كلمة المرور 8 أحرف على الأقل");
    try {
      const { data, error } = await supabase.auth.signUp({
        email: acctForm.email,
        password: acctForm.password,
        options: {
          data: { name: emp.name, username: acctForm.email.split("@")[0] },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      const uid = data.user?.id;
      if (!uid) throw new Error("فشل إنشاء الحساب");
      await new Promise((r) => setTimeout(r, 400));
      await supabase.from("user_roles").insert({ user_id: uid, role: acctForm.role });
      if (acctForm.role !== "admin" && acctForm.branchIds.length) {
        await supabase.from("branch_users").insert(acctForm.branchIds.map((bid) => ({ user_id: uid, branch_id: bid })));
      }
      await supabase.from("employees").update({ user_id: uid }).eq("id", emp.id);
      toast.success("تم إنشاء حساب الدخول وربطه بالموظف");
      setAcctOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const unlinkAccount = async () => {
    if (!emp.user_id) return;
    try {
      await supabase.from("branch_users").delete().eq("user_id", emp.user_id);
      await supabase.from("user_roles").delete().eq("user_id", emp.user_id);
      await supabase.from("profiles").delete().eq("id", emp.user_id);
      await supabase.from("employees").update({ user_id: null }).eq("id", emp.id);
      toast.success("تم فك ربط الحساب");
      setUnlinkOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
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
          <TabsTrigger value="account"><KeyRound className="w-4 h-4 ml-1" /> حساب الدخول</TabsTrigger>
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

        <TabsContent value="account" className="mt-4">
          {emp.user_id && accountProfile ? (
            <div className="card-elevated p-5 space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">حساب الدخول مرتبط</div>
                  <div className="font-bold text-lg">{accountProfile.username}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    حالة الحساب:{" "}
                    <span className={accountProfile.is_active ? "text-success" : "text-muted-foreground"}>
                      {accountProfile.is_active ? "نشط" : "موقوف"}
                    </span>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:text-destructive" onClick={() => setUnlinkOpen(true)}>
                  <Unlink className="w-4 h-4 ml-1" /> فك الربط
                </Button>
              </div>
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">الدور</div>
                  <div className="font-semibold">{accountRoles.map((r) => ROLE_LABELS[r]).join("، ") || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">الفروع المسموح بها</div>
                  <div className="font-semibold">
                    {accountBranchIds.length
                      ? accountBranchIds.map((bid) => allBranches.find((b) => b.id === bid)?.name).filter(Boolean).join("، ")
                      : "كل الفروع (مدير)"}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="card-elevated p-8 text-center">
              <KeyRound className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <div className="font-semibold mb-1">لا يوجد حساب دخول مرتبط بهذا الموظف</div>
              <div className="text-sm text-muted-foreground mb-4">
                أنشئ حساب دخول لتمكين الموظف من تسجيل الدخول واستخدام النظام بصلاحيات محددة.
              </div>
              <Button onClick={openCreateAccount} className="btn-gradient">
                <UserPlus className="w-4 h-4 ml-1" /> إنشاء حساب دخول
              </Button>
            </div>
          )}
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
            <div><Label>البريد الإلكتروني</Label><Input type="email" dir="ltr" className="text-right mt-1.5" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} placeholder="employee@company.com" /></div>
            <div><Label>كلمة المرور (للدخول كموظف)</Label><Input type="password" dir="ltr" className="text-right mt-1.5" value={editForm.login_password} onChange={(e) => setEditForm({ ...editForm, login_password: e.target.value })} placeholder="اتركه فارغاً إذا لا تريد تغييره" /></div>
            <div><Label>الراتب الأساسي</Label><Input type="number" value={editForm.base_salary} onChange={(e) => setEditForm({ ...editForm, base_salary: e.target.value })} className="mt-1.5" /></div>
            <div><Label>تاريخ التعيين</Label><Input type="date" value={editForm.hire_date} onChange={(e) => setEditForm({ ...editForm, hire_date: e.target.value })} className="mt-1.5" /></div>
            <div><Label>الرقم القومي</Label><Input dir="ltr" className="text-right mt-1.5" maxLength={14} value={editForm.national_id} onChange={(e) => setEditForm({ ...editForm, national_id: e.target.value.replace(/\D/g, "") })} placeholder="14 رقم" /></div>
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

      {/* Create login account dialog */}
      <Dialog open={acctOpen} onOpenChange={setAcctOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>إنشاء حساب دخول للموظف</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground bg-primary/10 border border-primary/30 rounded p-2">
              سيتم إنشاء حساب باسم <b>{emp.name}</b> وربطه بهذا الموظف.
            </div>
            <div><Label>البريد الإلكتروني *</Label><Input type="email" dir="ltr" className="text-right mt-1.5" value={acctForm.email} onChange={(e) => setAcctForm({ ...acctForm, email: e.target.value })} /></div>
            <div><Label>كلمة المرور * (8 أحرف على الأقل)</Label><Input type="password" minLength={8} value={acctForm.password} onChange={(e) => setAcctForm({ ...acctForm, password: e.target.value })} className="mt-1.5" /></div>
            <div>
              <Label>الدور</Label>
              <Select value={acctForm.role} onValueChange={(v) => setAcctForm({ ...acctForm, role: v as AppRole })}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABELS) as AppRole[])
                    .filter((r) => r !== "super_admin")
                    .map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {acctForm.role !== "admin" && (
              <div>
                <Label>الفروع المسموح بها</Label>
                <div className="mt-1.5 grid grid-cols-2 gap-2 max-h-40 overflow-y-auto border border-border rounded-lg p-2">
                  {allBranches.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 p-2 rounded hover:bg-surface-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={acctForm.branchIds.includes(b.id)}
                        onChange={(e) => setAcctForm({
                          ...acctForm,
                          branchIds: e.target.checked ? [...acctForm.branchIds, b.id] : acctForm.branchIds.filter((x) => x !== b.id),
                        })}
                      />
                      <span className="text-sm">{b.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcctOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={submitCreateAccount}>إنشاء وربط</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlink account confirm */}
      <AlertDialog open={unlinkOpen} onOpenChange={setUnlinkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>فك ربط حساب الدخول</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف حساب الدخول وأدواره وفروعه المرتبطة بالموظف <b>{emp.name}</b>. بيانات الموظف (الرواتب/السلف) لن تتأثر.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={unlinkAccount}>تأكيد فك الربط</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
