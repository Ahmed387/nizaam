import { useEffect, useState } from "react";
import { PermCard } from "@/contexts/PermCustomize";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PaymentMethodPicker, emptyPaymentValue, PaymentMethodValue } from "@/components/PaymentMethodPicker";
import { ShiftEditor, ShiftValue, emptyShift } from "@/components/ShiftEditor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useAuth } from "@/contexts/AuthContext";
import { edgeErrorMessage } from "@/lib/edgeError";
import { logAudit } from "@/lib/roles";
import { ROLE_LABELS, AppRole } from "@/lib/roles";
import { formatEGP, formatDate, monthKey } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Wallet, Receipt, Pencil, Trash2, Phone, Calendar, Briefcase, MapPin, Power, KeyRound, UserPlus, Unlink, IdCard, Upload, Eye, EyeOff, Calculator, User, Mail, Lock, Banknote, Clock, FileText } from "lucide-react";
import { PaySalaryDialog, CancelSalaryDialog, AdjustmentDialog, cancelAdjustment, fetchSalaryPreview, type SalaryPreview } from "@/components/payroll/SalaryDialogs";
import { EmployeeAttendanceTab } from "@/components/attendance/EmployeeAttendanceTab";
import { fetchAllRows } from "@/lib/fetchAll";
import { confirmAlert } from "@/components/ConfirmDialog";
import { ImageField } from "@/components/ImageField";
import { attachPaymentProofs, proofClock } from "@/lib/paymentProofs";

export default function EmployeeProfile() {
  const { id } = useParams<{ id: string }>();
  // «حساب الدخول» from the permissions screen opens /admin/employees/:id?tab=account
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const nav = useNavigate();
  const { user, profile, isAdmin, roleLabel, roleSettings } = useAuth();

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
  const [accountBranchLevels, setAccountBranchLevels] = useState<Record<string, "manage" | "read">>({});
  const [allBranches, setAllBranches] = useState<{ id: string; name: string }[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [showEditPwd, setShowEditPwd] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", job_title: "", phone: "", email: "", login_password: "", base_salary: "", hire_date: "", notes: "", national_id: "" });
  const [editShift, setEditShift] = useState<ShiftValue>(emptyShift());
  const [delOpen, setDelOpen] = useState(false);

  const [advOpen, setAdvOpen] = useState(false);
  const [salOpen, setSalOpen] = useState(false);
  const [advForm, setAdvForm] = useState({ amount: "", monthly_deduct: "", reason: "" });
  const [cancelSal, setCancelSal] = useState<any | null>(null);
  const [preview, setPreview] = useState<SalaryPreview | null>(null);
  const loadPreview = () => { if (id) fetchSalaryPreview(id, monthKey()).then(setPreview).catch(() => setPreview(null)); };
  useEffect(() => { loadPreview(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  const [advPm, setAdvPm] = useState<PaymentMethodValue>(emptyPaymentValue());
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [adjOpen, setAdjOpen] = useState<null | "bonus" | "penalty">(null);
  const loadAdjustments = async () => {
    if (!id) return;
    try {
      const rows = await fetchAllRows<any>(() => (supabase.from("employee_adjustments" as any) as any)
        .select("id, month, entry_date, kind, amount, reason, status, salary_id, cancel_reason, created_at").eq("employee_id", id).order("id"));
      rows.sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)) || String(b.created_at).localeCompare(String(a.created_at)));
      setAdjustments(rows);
    } catch { setAdjustments([]); }
  };
  useEffect(() => { loadAdjustments(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  const doCancelAdj = async (a: any) => {
    if (!(await confirmAlert({ title: `إلغاء ${a.kind === "bonus" ? "البونص" : "الجزاء"}؟`, description: `${formatEGP(a.amount)} — ${a.reason}. هيفضل في السجل «ملغي» ومش هيتحسب في المرتب.`, confirmLabel: "أيوه، ألغِ", cancelLabel: "رجوع", tone: "danger" }))) return;
    try { await cancelAdjustment(a.id, "إلغاء من صفحة الموظف"); toast.success("اتلغى"); loadAdjustments(); loadPreview(); }
    catch (e: any) { toast.error(e.message); }
  };

  // Account dialog
  const [acctOpen, setAcctOpen] = useState(false);
  const [acctForm, setAcctForm] = useState({ email: "", password: "", role: "cashier" as AppRole, branchIds: [] as string[] });
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [branchMgrOpen, setBranchMgrOpen] = useState(false);
  const [branchMgrIds, setBranchMgrIds] = useState<string[]>([]);
  const [branchMgrLevels, setBranchMgrLevels] = useState<Record<string, "manage" | "read">>({});
  const [savingBranches, setSavingBranches] = useState(false);

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
      supabase.from("branches").select("id, name").eq("is_active", true).eq("is_system", false).order("name"),
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
        supabase.from("branch_users").select("branch_id, access_level").eq("user_id", (e as any).user_id),
      ]);
      setAccountProfile(prof);
      setAccountRoles((rs ?? []).map((r: any) => r.role));
      setAccountBranchIds((bus ?? []).map((x: any) => x.branch_id));
      setAccountBranchLevels(
        Object.fromEntries(((bus ?? []) as any[]).map((x) => [x.branch_id, x.access_level === "read" ? "read" : "manage"])),
      );
    } else {
      setAccountProfile(null);
      setAccountRoles([]);
      setAccountBranchIds([]);
      setAccountBranchLevels({});
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, [id]);
  useRealtimeRefresh(
    ["employees", "advances", "salaries", "advance_payments", "user_roles", "branch_users", "employee_adjustments"],
    () => { load(); loadAdjustments(); loadPreview(); }
  );

  const totalAdvancesGiven = advances.reduce((s, a) => s + Number(a.amount), 0);
  const totalAdvancesRemaining = advances.reduce((s, a) => s + Number(a.remaining), 0);

  const totalAdvancesPaidBack = totalAdvancesGiven - totalAdvancesRemaining;
  const totalSalariesPaid = salaries.filter((x) => (x.status ?? "active") === "active").reduce((s, x) => s + Number(x.net_salary), 0);

  const openEdit = () => {
    if (!emp) return;
    setEditForm({
      name: emp.name, job_title: emp.job_title, phone: emp.phone ?? "", email: emp.email ?? "", login_password: "",
      base_salary: String(emp.base_salary), hire_date: emp.hire_date,
      notes: emp.notes ?? "",
      national_id: emp.national_id ?? "",
    });
    setEditShift({
      work_start: emp.work_start ?? null,
      work_end: emp.work_end ?? null,
      work_days: Array.isArray(emp.work_days) ? emp.work_days : [0,1,2,3,4,5],
      late_grace_minutes: emp.late_grace_minutes ?? 15,
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!editForm.name || !editForm.job_title) return toast.error("املأ الاسم والوظيفة");
    if (editForm.login_password && (editForm.login_password.length < 8 || !/[A-Za-z]/.test(editForm.login_password) || !/[0-9]/.test(editForm.login_password))) {
      return toast.error("كلمة المرور لازم تكون 8 أحرف على الأقل وتحتوي على حرف ورقم");
    }
    const updatePayload: any = {
      name: editForm.name, job_title: editForm.job_title, phone: editForm.phone || null,
      email: editForm.email?.trim() || null,
      base_salary: Number(editForm.base_salary) || 0, hire_date: editForm.hire_date,
      notes: editForm.notes || null,
      national_id: editForm.national_id?.trim() || null,
      work_start: editShift.work_start,
      work_end: editShift.work_end,
      work_days: editShift.work_days,
      late_grace_minutes: editShift.late_grace_minutes,
    };
    const { error } = await supabase.from("employees").update(updatePayload).eq("id", emp.id);
    if (error) return toast.error(error.message);
    const accountIdentityChanged = Boolean(emp.user_id) && editForm.email.trim().toLowerCase() !== String(emp.email ?? "").trim().toLowerCase();
    if (editForm.login_password || accountIdentityChanged) {
      const { data, error: accountError } = await supabase.functions.invoke("admin-create-employee", {
        body: {
          employee_id: emp.id,
          name: editForm.name,
          job_title: editForm.job_title,
          phone: editForm.phone || null,
          national_id: editForm.national_id || null,
          base_salary: Number(editForm.base_salary) || 0,
          hire_date: editForm.hire_date,
          branch_id: emp.branch_id,
          allowed_branch_ids: emp.user_id ? undefined : [emp.branch_id],
          role: emp.role,
          is_active: emp.is_active ?? true,
          has_system_access: true,
          email: editForm.email.trim().toLowerCase(),
          password: editForm.login_password,
          work_start: editShift.work_start,
          work_end: editShift.work_end,
          work_days: editShift.work_days,
          late_grace_minutes: editShift.late_grace_minutes,
        },
      });
      const message = await edgeErrorMessage(accountError, data);
      if (accountError || (data as any)?.error) return toast.error(message ?? "فشل تحديث حساب الدخول");
    }
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
    const { data, error } = await supabase.functions.invoke("admin-delete-employee", {
      body: { employee_id: emp.id },
    });
    const errMsg = (data as any)?.error ?? error?.message;
    if (errMsg) return toast.error(errMsg);
    if ((data as any)?.warning) toast.warning((data as any).warning);
    else toast.success("تم حذف الموظف نهائياً (مع حساب الدخول)");
    nav("/admin/employees");
  };


  const submitAdvance = async () => {
    const amt = Number(advForm.amount);
    const md = Number(advForm.monthly_deduct);
    if (!amt || amt <= 0) return toast.error("أدخل المبلغ");
    if (!md || md <= 0) return toast.error("أدخل قيمة الخصم الشهري");
    const { validateTransferPayment } = await import("@/lib/paymentMethods");
    const aErr = validateTransferPayment(advPm);
    if (aErr) return toast.error(aErr);
    const since = proofClock();
    const { data: res, error } = await supabase.rpc("disburse_employee_advance", {
      p_employee_id: emp.id, p_amount: amt, p_monthly_deduct: md, p_reason: advForm.reason || null,
      p_payment_method: advPm.method, p_reference_number: advPm.reference_number ?? null,
      p_transfer_to_account: advPm.transfer_to_account ?? null, p_transfer_from_account: advPm.transfer_from_account ?? null,
      p_fee_amount: advPm.fee_amount || 0,
    } as any);
    if (error) return toast.error(error.message);
    await attachPaymentProofs([{ files: advPm.proof_files, method: advPm.method, amount: amt }], since);
    const adv = { id: (res as any)?.advance_id as string };
    await logAudit({ userId: user!.id, userName: profile?.name ?? "", branchId: emp.branch_id, action: "CREATE", entity: "advance", entityId: adv.id, details: { employee: emp.name, amount: amt, method: advPm.method } });
    toast.success("تم صرف السلفة");
    setAdvOpen(false);
    setAdvForm({ amount: "", monthly_deduct: "", reason: "" });
    load();
  };

  const openCreateAccount = () => {
    setAcctForm({ email: "", password: "", role: "cashier", branchIds: emp.branch_id ? [emp.branch_id] : [] });
    setAcctOpen(true);
  };

  const submitCreateAccount = async () => {
    if (!acctForm.email || !acctForm.password) return toast.error("أدخل البريد وكلمة المرور");
    if (acctForm.password.length < 8 || !/[A-Za-z]/.test(acctForm.password) || !/[0-9]/.test(acctForm.password)) {
      return toast.error("كلمة المرور لازم تكون 8 أحرف على الأقل وتحتوي على حرف ورقم");
    }
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-employee", {
        body: {
          employee_id: emp.id,
          name: emp.name,
          job_title: emp.job_title,
          phone: emp.phone,
          national_id: emp.national_id,
          base_salary: emp.base_salary,
          hire_date: emp.hire_date,
          branch_id: emp.branch_id,
          allowed_branch_ids: acctForm.branchIds,
          role: acctForm.role,
          is_active: emp.is_active ?? true,
          has_system_access: true,
          email: acctForm.email.trim().toLowerCase(),
          password: acctForm.password,
          work_start: emp.work_start ?? null,
          work_end: emp.work_end ?? null,
          work_days: emp.work_days ?? [0, 1, 2, 3, 4, 5],
          late_grace_minutes: emp.late_grace_minutes ?? 15,
        },
      });
      if (error || (data as any)?.error) {
        throw new Error((await edgeErrorMessage(error, data)) ?? "فشل إنشاء الحساب");
      }
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

  const openManageBranches = () => {
    setBranchMgrIds([...accountBranchIds]);
    setBranchMgrLevels({ ...accountBranchLevels });
    setBranchMgrOpen(true);
  };

  const saveManageBranches = async () => {
    if (!emp?.user_id) return;
    setSavingBranches(true);
    try {
      const current = new Set(accountBranchIds);
      const next = new Set(branchMgrIds);
      const toAdd = [...next].filter((x) => !current.has(x));
      const toRemove = [...current].filter((x) => !next.has(x));
      const lvl = (bid: string) => (branchMgrLevels[bid] === "read" ? "read" : "manage");
      if (toRemove.length) {
        await supabase.from("branch_users").delete().eq("user_id", emp.user_id).in("branch_id", toRemove);
      }
      if (toAdd.length) {
        await supabase.from("branch_users").insert(
          toAdd.map((bid) => ({ user_id: emp.user_id, branch_id: bid, access_level: lvl(bid) })) as any,
        );
      }
      // Update the access level of branches that stay linked but changed level
      const kept = [...next].filter((x) => current.has(x));
      for (const bid of kept) {
        if (lvl(bid) !== (accountBranchLevels[bid] ?? "manage")) {
          await supabase
            .from("branch_users")
            .update({ access_level: lvl(bid) } as any)
            .eq("user_id", emp.user_id)
            .eq("branch_id", bid);
        }
      }
      toast.success("تم تحديث الفروع ومستويات الصلاحية");
      setBranchMgrOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingBranches(false);
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
        <PermCard label="الراتب الأساسي"><div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">الراتب الأساسي</div>
          <div className="text-xl font-extrabold mt-1">{formatEGP(emp.base_salary)}</div>
        </div></PermCard>
        <PermCard label="رواتب مدفوعة"><div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">رواتب مدفوعة</div>
          <div className="text-xl font-extrabold mt-1 text-success">{formatEGP(totalSalariesPaid)}</div>
          <div className="text-xs text-muted-foreground">{salaries.length} شهر</div>
        </div></PermCard>
        <PermCard label="إجمالي السلف"><div className="card-elevated p-4">
          <div className="text-xs text-muted-foreground">إجمالي السلف</div>
          <div className="text-xl font-extrabold mt-1">{formatEGP(totalAdvancesGiven)}</div>
          <div className="text-xs text-muted-foreground">سُدد {formatEGP(totalAdvancesPaidBack)}</div>
        </div></PermCard>
        <div className="card-elevated p-4 border-warning/30 bg-warning/5">
          <div className="text-xs text-warning">سلف متبقية</div>
          <div className="text-xl font-extrabold mt-1 text-warning">{formatEGP(totalAdvancesRemaining)}</div>
        </div>
      </div>

      <Tabs defaultValue={tabParam === "account" ? "account" : "salaries"}>
        <TabsList>
          <TabsTrigger value="salaries"><Receipt className="w-4 h-4 ml-1" /> الرواتب</TabsTrigger>
          <TabsTrigger value="attendance"><Calendar className="w-4 h-4 ml-1" /> الحضور</TabsTrigger>
          <TabsTrigger value="adjustments"><Calculator className="w-4 h-4 ml-1" /> بونص وجزاءات</TabsTrigger>
          <TabsTrigger value="advances"><Wallet className="w-4 h-4 ml-1" /> السلف</TabsTrigger>
          <TabsTrigger value="payments">سداد السلف</TabsTrigger>
          <TabsTrigger value="id"><IdCard className="w-4 h-4 ml-1" /> البطاقة</TabsTrigger>
          {emp.has_system_access !== false && (
            <TabsTrigger value="account"><KeyRound className="w-4 h-4 ml-1" /> حساب الدخول</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="salaries" className="mt-4">
          {preview && (
            <div className="card-elevated p-4 mb-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="font-extrabold">مرتب الشهر ده ({preview.month}) — من الحضور والسلف</div>
                {preview.paid
                  ? <span className="text-xs font-bold text-success">اتصرف {formatEGP(Number(preview.paid.net_salary))}</span>
                  : <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => setAdjOpen("bonus")} className="gap-1 text-success">+ بونص</Button>
                      <Button variant="outline" onClick={() => setAdjOpen("penalty")} className="gap-1 text-destructive">− جزاء</Button>
                      <Button onClick={() => setSalOpen(true)} className="gap-2"><Plus className="w-4 h-4" /> صرف المرتب</Button>
                    </div>}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
                <div className="rounded-lg bg-surface-2 p-2.5"><div className="text-[11px] text-muted-foreground">الأساسي</div><b className="tabular-nums">{formatEGP(preview.base)}</b></div>
                <div className="rounded-lg bg-destructive/10 p-2.5"><div className="text-[11px] text-muted-foreground">خصم الغياب ({preview.counts.absent} يوم{preview.counts.half_day + preview.counts.hourly ? ` + ${preview.counts.half_day + preview.counts.hourly} جزئي` : ""})</div><b className="tabular-nums text-destructive">− {formatEGP(preview.attendance_deduction)}</b></div>
                <div className="rounded-lg bg-info/10 p-2.5"><div className="text-[11px] text-muted-foreground">إجازات (مدفوعة)</div><b className="tabular-nums">{preview.counts.leave} يوم</b></div>
                <div className="rounded-lg bg-success/10 p-2.5"><div className="text-[11px] text-muted-foreground">بونص − جزاءات متسجلة</div><b className="tabular-nums"><span className="text-success">+{formatEGP(preview.adjustments?.bonus ?? 0)}</span> / <span className="text-destructive">−{formatEGP(preview.adjustments?.penalty ?? 0)}</span></b></div>
                <div className="rounded-lg bg-warning/10 p-2.5"><div className="text-[11px] text-muted-foreground">قسط السلف المستحق (رصيد {formatEGP(preview.advance_remaining)})</div><b className="tabular-nums text-warning">− {formatEGP(Math.min(preview.advance_due, preview.attendance_amount))}</b></div>
                <div className="rounded-lg bg-primary/10 p-2.5"><div className="text-[11px] text-muted-foreground">الصافي المتوقع</div><b className="tabular-nums text-primary">{(() => { const g = preview.attendance_amount + Number(preview.adjustments?.bonus ?? 0) - Number(preview.adjustments?.penalty ?? 0); return formatEGP(g - Math.min(preview.advance_due, Math.max(0, g))); })()}</b></div>
              </div>
            </div>
          )}
          {!preview && (
            <div className="flex justify-end mb-3">
              <Button onClick={() => setSalOpen(true)} className="gap-2"><Plus className="w-4 h-4" /> صرف راتب</Button>
            </div>
          )}
          <DataTable
            rows={salaries}
            empty="لا توجد رواتب مدفوعة"
            columns={[
              { key: "month", header: "الشهر" },
              { key: "base_salary", header: "أساسي", render: (r: any) => formatEGP(r.base_salary) },
              { key: "attendance_deduction", header: "خصم غياب", render: (r: any) => <span className="text-destructive">{formatEGP(r.attendance_deduction ?? 0)}</span> },
              { key: "bonuses", header: "بونص", render: (r: any) => <span className="text-success">{formatEGP(r.bonuses)}</span> },
              { key: "deductions", header: "خصم", render: (r: any) => <span className="text-destructive">{formatEGP(r.deductions)}</span> },
              { key: "advance_deduct", header: "قسط سلف", render: (r: any) => <span className="text-warning">{formatEGP(r.advance_deduct)}</span> },
              { key: "net_salary", header: "الصافي", render: (r: any) => <b className={r.status === "cancelled" ? "line-through text-muted-foreground" : "text-primary"}>{formatEGP(r.net_salary)}</b> },
              { key: "paid_at", header: "تاريخ الصرف", render: (r: any) => formatDate(r.paid_at) },
              { key: "status", header: "الحالة", render: (r: any) => r.status === "cancelled"
                  ? <span className="text-xs text-destructive" title={r.cancel_reason ?? ""}>ملغي{r.cancel_reason ? ` — ${r.cancel_reason}` : ""}</span>
                  : <span className="text-xs text-success">مصروف</span> },
              { key: "actions", header: "", render: (r: any) => r.status !== "cancelled" && isAdmin
                  ? <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelSal(r)}>إلغاء الصرف</Button> : null },
            ]}
          />
        </TabsContent>

        <TabsContent value="attendance" className="mt-4">
          <EmployeeAttendanceTab employee={emp} />
        </TabsContent>

        <TabsContent value="adjustments" className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="text-sm text-muted-foreground">البونص بيتضاف والجزاء بيتخصم من مرتب الشهر بتاعه لما يتصرف — وبيظهر في سند الصرف والخزنة والتقارير من خلال المرتب.</div>
            <div className="flex gap-2">
              <Button variant="outline" className="text-success" onClick={() => setAdjOpen("bonus")}>+ بونص</Button>
              <Button variant="outline" className="text-destructive" onClick={() => setAdjOpen("penalty")}>− جزاء</Button>
            </div>
          </div>
          <DataTable
            rows={adjustments}
            empty="مفيش بونص أو جزاءات"
            columns={[
              { key: "entry_date", header: "التاريخ", render: (r: any) => formatDate(r.entry_date) },
              { key: "month", header: "شهر المرتب" },
              { key: "kind", header: "النوع", render: (r: any) => r.kind === "bonus" ? <span className="text-success font-bold">بونص</span> : <span className="text-destructive font-bold">جزاء</span> },
              { key: "amount", header: "المبلغ", render: (r: any) => <b className={r.status === "cancelled" ? "line-through text-muted-foreground" : r.kind === "bonus" ? "text-success" : "text-destructive"}>{r.kind === "bonus" ? "+ " : "− "}{formatEGP(r.amount)}</b> },
              { key: "reason", header: "السبب" },
              { key: "status", header: "الحالة", render: (r: any) => r.status === "cancelled"
                  ? <span className="text-xs text-destructive">ملغي{r.cancel_reason ? ` — ${r.cancel_reason}` : ""}</span>
                  : r.salary_id ? <span className="text-xs text-success">اتحسب في المرتب</span> : <span className="text-xs text-warning">مستني صرف المرتب</span> },
              { key: "actions", header: "", render: (r: any) => r.status === "active" && !r.salary_id
                  ? <Button size="sm" variant="ghost" className="text-destructive" onClick={() => doCancelAdj(r)}>إلغاء</Button> : null },
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

        <TabsContent value="id" className="mt-4">
          <IdCardSection emp={emp} onUpdated={load} />
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
                <div className="flex gap-2 flex-wrap">
                  {!accountRoles.includes("admin") && (
                    <Button variant="outline" size="sm" onClick={openManageBranches}>
                      <MapPin className="w-4 h-4 ml-1" /> إدارة الفروع
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:text-destructive" onClick={() => setUnlinkOpen(true)}>
                    <Unlink className="w-4 h-4 ml-1" /> فك الربط
                  </Button>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">الدور</div>
                  <div className="font-semibold">{accountRoles.map((r) => roleLabel(r)).join("، ") || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">الفروع المسموح بها</div>
                  <div className="font-semibold">
                    {accountRoles.includes("admin")
                      ? "كل الفروع (مدير عام)"
                      : accountBranchIds.length
                        ? accountBranchIds
                            .map((bid) => {
                              const nm = allBranches.find((b) => b.id === bid)?.name;
                              if (!nm) return null;
                              return `${nm} (${accountBranchLevels[bid] === "read" ? "عرض فقط" : "إدارة كاملة"})`;
                            })
                            .filter(Boolean)
                            .join("، ")
                        : <span className="text-warning">لم يتم تحديد أي فرع — لن يرى أي بيانات</span>}
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
        <DialogContent className="max-w-2xl max-h-[90vh] p-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Pencil className="w-5 h-5 text-primary" />
              تعديل بيانات الموظف
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5 space-y-5">
            {/* Basic info */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
              <h4 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
                <User className="w-4 h-4 text-primary" /> بيانات أساسية
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Label className="text-sm font-semibold flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-muted-foreground" /> الاسم *
                  </Label>
                  <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="mt-2" />
                </div>
                <div>
                  <Label className="text-sm font-semibold flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-muted-foreground" /> التليفون
                  </Label>
                  <Input dir="ltr" className="text-right mt-2" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                </div>
                <div>
                  <Label className="text-sm font-semibold flex items-center gap-1.5">
                    <IdCard className="w-3.5 h-3.5 text-muted-foreground" /> الرقم القومي
                  </Label>
                  <Input dir="ltr" className="text-right mt-2" maxLength={14} value={editForm.national_id} onChange={(e) => setEditForm({ ...editForm, national_id: e.target.value.replace(/\D/g, "") })} placeholder="14 رقم" />
                </div>
              </div>
            </div>

            {/* System access */}
            {emp.has_system_access !== false && (
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
                <h4 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
                  <KeyRound className="w-4 h-4 text-primary" /> بيانات الدخول للنظام
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-semibold flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-muted-foreground" /> البريد الإلكتروني
                    </Label>
                    <Input type="email" dir="ltr" className="text-right mt-2" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} placeholder="employee@company.com" />
                  </div>
                  <div>
                    <Label className="text-sm font-semibold flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-muted-foreground" /> كلمة المرور (للدخول كموظف)
                    </Label>
                    <div className="relative mt-2">
                      <Input type={showEditPwd ? "text" : "password"} dir="ltr" autoComplete="new-password" data-lpignore="true" data-form-type="other" className="text-right pl-10" value={editForm.login_password} onChange={(e) => setEditForm({ ...editForm, login_password: e.target.value })} placeholder="اتركه فارغاً إذا لا تريد تغييره" />
                      <button type="button" onClick={() => setShowEditPwd((v) => !v)} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" title={showEditPwd ? "إخفاء" : "إظهار"}>
                        {showEditPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">كلمة المرور الحالية متشفّرة ومش ممكن تتعرض — اكتب كلمة جديدة واضغط على العين للتأكد منها قبل الحفظ.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Employment info */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
              <h4 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
                <Banknote className="w-4 h-4 text-primary" /> بيانات التوظيف
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-semibold flex items-center gap-1.5">
                    <Banknote className="w-3.5 h-3.5 text-muted-foreground" /> الراتب الأساسي
                  </Label>
                  <Input type="number" value={editForm.base_salary} onChange={(e) => setEditForm({ ...editForm, base_salary: e.target.value })} className="mt-2" />
                </div>
                <div>
                  <Label className="text-sm font-semibold flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-muted-foreground" /> تاريخ التعيين
                  </Label>
                  <Input type="date" value={editForm.hire_date} onChange={(e) => setEditForm({ ...editForm, hire_date: e.target.value })} className="mt-2" />
                </div>
              </div>
            </div>

            {/* Shift schedule */}
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <h4 className="text-sm font-bold text-foreground flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-primary" /> مواعيد العمل (الشيفت)
              </h4>
              <ShiftEditor value={editShift} onChange={setEditShift} showTitle={false} />
            </div>

            {/* Notes */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <h4 className="text-sm font-bold text-foreground flex items-center gap-2 mb-1">
                <FileText className="w-4 h-4 text-primary" /> ملاحظات
              </h4>
              <Textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={3} />
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t shrink-0 bg-background/95 backdrop-blur gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>إلغاء</Button>
            <Button onClick={submitEdit} className="gap-2">
              <Pencil className="w-4 h-4" /> حفظ التعديلات
            </Button>
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
            <PaymentMethodPicker amount={Number(advForm.amount) || 0} value={advPm} onChange={setAdvPm} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdvOpen(false)}>إلغاء</Button>
            <Button onClick={submitAdvance}>صرف وخصم من الخزنة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {salOpen && emp && (
        <PaySalaryDialog employee={emp} month={monthKey()} monthEditable onClose={() => setSalOpen(false)}
          onDone={() => { setSalOpen(false); load(); loadPreview(); loadAdjustments(); }} />
      )}
      {adjOpen && emp && (
        <AdjustmentDialog employee={emp} kind={adjOpen} onClose={() => setAdjOpen(null)}
          onDone={() => { setAdjOpen(null); loadAdjustments(); loadPreview(); }} />
      )}
      {cancelSal && (
        <CancelSalaryDialog salary={cancelSal} onClose={() => setCancelSal(null)} onDone={() => { setCancelSal(null); load(); loadPreview(); loadAdjustments(); }} />
      )}

      {/* Delete confirm */}
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الموظف</AlertDialogTitle>
            <AlertDialogDescription>
              هيتم حذف <b>{emp.name}</b> نهائياً من النظام ومن قاعدة البيانات، ومعاه حساب الدخول
              وأدواره وفروعه — يعني تقدر تضيف نفس الاسم أو نفس الإيميل تاني عادي.
              (الرواتب والسلف المسجلة قبل كده مش هتتحذف.)
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
                    .filter((r) => r !== "super_admin" && (r === acctForm.role || !roleSettings.some((x) => x.role === r && x.hidden)))
                    .map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
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
      {/* Manage branches for linked account */}
      <Dialog open={branchMgrOpen} onOpenChange={setBranchMgrOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>إدارة الفروع المسموح بها</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground bg-primary/10 border border-primary/30 rounded p-2">
              اختر الفروع التي يستطيع هذا الحساب الوصول لها، وحدد لكل فرع مستوى الصلاحية:
              «إدارة كاملة» تسمح بالبيع والتعديل والسندات، و«عرض فقط» تسمح بالاستعراض والتقارير بدون أي إضافة أو تعديل أو إلغاء.
            </div>
            <div className="grid grid-cols-1 gap-2 max-h-72 overflow-y-auto border border-border rounded-lg p-2">
              {allBranches.map((b) => {
                const on = branchMgrIds.includes(b.id);
                const level = branchMgrLevels[b.id] === "read" ? "read" : "manage";
                return (
                  <div key={b.id} className="flex items-center justify-between gap-2 p-2 rounded hover:bg-surface-2">
                    <label className="flex items-center gap-2 cursor-pointer min-w-0">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => setBranchMgrIds(
                          e.target.checked ? [...branchMgrIds, b.id] : branchMgrIds.filter((x) => x !== b.id),
                        )}
                      />
                      <span className="text-sm truncate">{b.name}</span>
                    </label>
                    {on && (
                      <div className="flex gap-1 shrink-0">
                        {(["manage", "read"] as const).map((lv) => (
                          <button
                            key={lv}
                            type="button"
                            onClick={() => setBranchMgrLevels((p) => ({ ...p, [b.id]: lv }))}
                            className={`rounded-full border px-2.5 py-1 text-[11px] transition-all ${
                              level === lv
                                ? lv === "manage"
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-warning text-warning-foreground border-warning"
                                : "bg-background hover:bg-muted"
                            }`}
                          >
                            {lv === "manage" ? "إدارة كاملة" : "عرض فقط"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 text-xs">
              <Button variant="outline" size="sm" onClick={() => setBranchMgrIds(allBranches.map((b) => b.id))}>كل الفروع</Button>
              <Button variant="outline" size="sm" onClick={() => setBranchMgrIds([])}>مسح الكل</Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBranchMgrOpen(false)}>إلغاء</Button>
            <Button className="btn-gradient" onClick={saveManageBranches} disabled={savingBranches}>
              {savingBranches ? "جاري الحفظ..." : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

function IdCardSection({ emp, onUpdated }: { emp: any; onUpdated: () => void }) {
  const { tenantId } = useAuth();
  const [frontUrl, setFrontUrl] = useState<string | null>(null);
  const [backUrl, setBackUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"front" | "back" | null>(null);

  const sign = async (path: string | null | undefined, side: "front" | "back") => {
    if (!path) return;
    const { data } = await supabase.storage.from("employee-ids").createSignedUrl(path, 600);
    if (data?.signedUrl) side === "front" ? setFrontUrl(data.signedUrl) : setBackUrl(data.signedUrl);
  };

  useEffect(() => {
    setFrontUrl(null); setBackUrl(null);
    sign(emp.national_id_front_url, "front");
    sign(emp.national_id_back_url, "back");
  }, [emp.national_id_front_url, emp.national_id_back_url]);

  const upload = async (file: File, side: "front" | "back") => {
    if (!file.type.startsWith("image/")) return toast.error("اختر صورة فقط");
    if (file.size > 5 * 1024 * 1024) return toast.error("الحد الأقصى 5 ميجا");
    setBusy(side);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      if (!tenantId) throw new Error("Tenant context missing");
      const path = `${tenantId}/${emp.id}/${side}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("employee-ids").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const col = side === "front" ? "national_id_front_url" : "national_id_back_url";
      const { error } = await supabase.from("employees").update({ [col]: path } as any).eq("id", emp.id);
      if (error) throw error;
      toast.success("تم رفع الصورة");
      onUpdated();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(null); }
  };

  const remove = async (side: "front" | "back") => {
    if (!(await confirmAlert({ title: "حذف الصورة؟", description: "الخطوة دي مش هتترجع تاني — متأكد؟", confirmLabel: "أيوه، امسح", cancelLabel: "لأ، سيبها", tone: "danger" }))) return;
    const col = side === "front" ? "national_id_front_url" : "national_id_back_url";
    const oldPath = side === "front" ? emp.national_id_front_url : emp.national_id_back_url;
    if (oldPath) await supabase.storage.from("employee-ids").remove([oldPath]);
    await supabase.from("employees").update({ [col]: null } as any).eq("id", emp.id);
    toast.success("تم الحذف");
    onUpdated();
  };

  const uploadSide = async (file: File, side: "front" | "back") => {
    if (file.size > 5 * 1024 * 1024) throw new Error("الحد الأقصى 5 ميجا");
    if (!tenantId) throw new Error("Tenant context missing");
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${tenantId}/${emp.id}/${side}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("employee-ids").upload(path, file, { upsert: true });
    if (upErr) throw upErr;
    const col = side === "front" ? "national_id_front_url" : "national_id_back_url";
    const { error } = await supabase.from("employees").update({ [col]: path } as any).eq("id", emp.id);
    if (error) throw error;
    onUpdated();
    return path;
  };

  /** حذف الملف من التخزين فقط — بدون تصفير أي حقل في قاعدة البيانات (يُستخدم عند الاستبدال). */
  const removeFileOnly = async (filePath: string) => {
    if (!filePath) return;
    await supabase.storage.from("employee-ids").remove([filePath]);
  };

  /** حذف كامل: ملف + تصفير الحقل — لا يُستدعى إلا بالضغط الصريح على أيقونة الحذف. */
  const clearSide = async (value: string, side: "front" | "back") => {
    const col = side === "front" ? "national_id_front_url" : "national_id_back_url";
    await removeFileOnly(value);
    const { error } = await supabase.from("employees").update({ [col]: null } as any).eq("id", emp.id);
    if (error) throw error;
    onUpdated();
  };

  const SideCard = ({ side, label, path }: { side: "front" | "back"; label: string; path: string | null }) => (
    <div className="card-elevated p-4">
      <div className="font-bold flex items-center gap-2 mb-3"><IdCard className="w-4 h-4 text-primary" /> {label}</div>
      <ImageField
        value={path}
        onChange={() => onUpdated()}
        bucket="employee-ids"
        uploader={(f) => uploadSide(f, side)}
        remover={(v) => clearSide(v, side)}
        fileRemover={(v) => removeFileOnly(v)}
        label=""
        size="lg"
        hint="الصور محفوظة في تخزين آمن — للمدير والمسؤول فقط"
      />
    </div>
  );

  return (
    <div>
      <div className="mb-4 p-3 rounded-lg bg-muted/30 text-sm">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div><b>الرقم القومي: </b>{emp.national_id ? <span dir="ltr">{emp.national_id}</span> : <span className="text-muted-foreground">غير مسجل</span>}</div>
          <div className="text-xs text-muted-foreground">الصور محفوظة في تخزين آمن — يمكن للمدير والمسؤول فقط الاطلاع عليها</div>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <SideCard side="front" label="وش البطاقة" path={emp.national_id_front_url} />
        <SideCard side="back" label="ظهر البطاقة" path={emp.national_id_back_url} />
      </div>
    </div>
  );
}
