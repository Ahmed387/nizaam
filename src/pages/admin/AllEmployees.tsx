import { useEffect, useMemo, useState } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { AdminLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { searchMatch } from "@/lib/search";
import { edgeErrorMessage } from "@/lib/edgeError";
import { ShiftEditor, ShiftValue, emptyShift } from "@/components/ShiftEditor";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { Plus, FileSpreadsheet, ArrowRight, Users, UserCheck, UserX, Wallet, Pencil, Trash2, ClipboardCheck, Eye, EyeOff, CalendarRange, UserCircle, CalendarDays, Coins } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AllAttendance from "./AllAttendance";
import ShiftsHistory from "./ShiftsHistory";
import Presence from "./Presence";
import MonthlyAttendanceReport from "./MonthlyAttendanceReport";
import { useBranchScope } from "@/lib/branchScope";

const POSITIONS = [
  { value: "كاشير", role: "cashier" },
  { value: "مدير فرع", role: "branch_manager" },
  { value: "أمين مخزن", role: "warehouse" },
  { value: "محاسب", role: "accountant" },
  { value: "ملاحظ (حضور وانصراف)", role: "supervisor" },
  { value: "عامل", role: "worker" },
  { value: "سواق", role: "driver" },
];


export default function AllEmployees() {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "list";
  const { can, isAdmin, isViewer, hasRole } = useAuth();
  const showShifts = isAdmin || can("admin_shifts.view") || hasRole("super_admin") || hasRole("supervisor");
  const showPresence = isAdmin || isViewer || can("admin_presence.view") || hasRole("supervisor") || hasRole("super_admin");
  const [emps, setEmps] = useState<any[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const { filterBranches } = useBranchScope();
  const [advRemaining, setAdvRemaining] = useState<Record<string, number>>({});
  // قسط السلفة المستحق هذا الشهر (عرض فقط — لا يُنشئ أي حركة مالية)
  const [advInstallment, setAdvInstallment] = useState<Record<string, number>>({});
  const [userBranches, setUserBranches] = useState<Record<string, { branch_id: string; access_level: string }[]>>({});
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [accessFilter, setAccessFilter] = useState<"all" | "with" | "without">("all");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    name: "", job_title: "", phone: "", email: "", login_password: "", national_id: "",
    base_salary: "",
    hire_date: new Date().toISOString().slice(0, 10), branch_id: "", role: "", is_active: true,
  });
  const [shift, setShift] = useState<ShiftValue>(emptyShift());
  const [allowedBranchIds, setAllowedBranchIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const isSimpleRole = form.role === "worker" || form.role === "driver";


  const load = async () => {
    setLoading(true);
    const [{ data: e }, { data: b }, { data: a }] = await Promise.all([
      supabase.from("employees").select("*").order("created_at", { ascending: false }),
      supabase.from("branches").select("id, name").eq("is_active", true).neq("code", "PARTNER-CASH").order("name"),
      supabase.from("advances").select("employee_id, remaining, monthly_deduct"),
    ]);
    setEmps(e ?? []);
    setBranches(filterBranches((b ?? []) as any) as any);
    const map: Record<string, number> = {};
    const inst: Record<string, number> = {};
    for (const x of (a ?? []) as any[]) {
      const remaining = Number(x.remaining) || 0;
      map[x.employee_id] = (map[x.employee_id] ?? 0) + remaining;
      // القسط الشهري لا يتعدى المتبقي غير المسدد
      const due = Math.min(Number(x.monthly_deduct) || 0, remaining);
      inst[x.employee_id] = (inst[x.employee_id] ?? 0) + due;
    }
    setAdvRemaining(map);
    setAdvInstallment(inst);
    const uids = (e ?? []).map((x: any) => x.user_id).filter(Boolean);
    if (uids.length) {
      const { data: bu } = await supabase.from("branch_users").select("user_id, branch_id, access_level").in("user_id", uids);
      const ub: Record<string, { branch_id: string; access_level: string }[]> = {};
      for (const r of (bu ?? []) as any[]) {
        (ub[r.user_id] = ub[r.user_id] || []).push({ branch_id: r.branch_id, access_level: r.access_level ?? "manage" });
      }
      setUserBranches(ub);
    } else setUserBranches({});
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefresh(["employees", "branches", "advances", "branch_users"], load);

  const enriched = useMemo(() => emps.map((e) => ({
    ...e,
    branch_name: branches.find((b) => b.id === e.branch_id)?.name ?? "—",
    advance_remaining: advRemaining[e.id] ?? 0,
    advance_installment: advInstallment[e.id] ?? 0,
    allowed_branches: e.user_id ? (userBranches[e.user_id] ?? []) : [],
  })), [emps, branches, advRemaining, advInstallment, userBranches]);

  const filtered = useMemo(() => enriched.filter((e) => {
    if (search && !searchMatch(search, e.name, e.job_title, e.phone)) return false;
    if (branchFilter !== "all" && e.branch_id !== branchFilter) return false;
    if (statusFilter === "active" && !e.is_active) return false;
    if (statusFilter === "inactive" && e.is_active) return false;
    if (accessFilter === "with" && e.has_system_access === false) return false;
    if (accessFilter === "without" && e.has_system_access !== false) return false;
    return true;
  }), [enriched, search, branchFilter, statusFilter, accessFilter]);

  const stats = useMemo(() => ({
    total: enriched.length,
    active: enriched.filter((e) => e.is_active).length,
    inactive: enriched.filter((e) => !e.is_active).length,
    salaryTotal: enriched.filter((e) => e.is_active).reduce((s, e) => s + Number(e.base_salary), 0),
    advanceDue: enriched.filter((e) => e.is_active).reduce((s, e) => s + Number(e.advance_installment || 0), 0),
  }), [enriched]);
  // صافي الرواتب = إجمالي رواتب النشطين - أقساط السلف غير المسددة لنفس الشهر (عرض تحليلي فقط)
  const netSalaryTotal = Math.max(0, stats.salaryTotal - stats.advanceDue);

  const openNew = () => {
    setForm({ name: "", job_title: "", phone: "", email: "", login_password: "", national_id: "", base_salary: "", hire_date: new Date().toISOString().slice(0, 10), branch_id: "", role: "", is_active: true });
    setShift(emptyShift());
    setAllowedBranchIds([]);
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (e: any) => {
    setEditing(e);
    setForm({
      name: e.name ?? "", job_title: e.job_title ?? "", phone: e.phone ?? "", email: e.email ?? "", login_password: "",
      national_id: e.national_id ?? "",
      base_salary: String(e.base_salary ?? ""), hire_date: e.hire_date ?? new Date().toISOString().slice(0, 10),
      branch_id: e.branch_id ?? "", role: e.role ?? "", is_active: e.is_active ?? true,
    });
    setAllowedBranchIds(e.user_id ? (userBranches[e.user_id] ?? []).map((b) => b.branch_id) : (e.branch_id ? [e.branch_id] : []));
    setShift({
      work_start: e.work_start ?? null,
      work_end: e.work_end ?? null,
      work_days: Array.isArray(e.work_days) ? e.work_days : [0,1,2,3,4,5],
      late_grace_minutes: e.late_grace_minutes ?? 15,
    });
    setOpen(true);
  };


  const onPositionChange = (val: string) => {
    const pos = POSITIONS.find((p) => p.value === val);
    setForm({ ...form, job_title: val, role: pos?.role ?? form.role });
  };

  const submit = async () => {
    if (!form.name || !form.job_title || !form.branch_id || !form.role) return toast.error("املأ الاسم والوظيفة والفرع والصلاحية");
    if (!form.phone) return toast.error("التليفون مطلوب");
    if (!isSimpleRole) {
      if (!form.email) return toast.error("الإيميل مطلوب لدخول الموظف");
      if (!editing && (!form.login_password || form.login_password.length < 8 || !/[A-Za-z]/.test(form.login_password) || !/[0-9]/.test(form.login_password))) return toast.error("كلمة المرور لازم تكون 8 أحرف على الأقل وتحتوي على حرف ورقم");
      if (editing && form.login_password && (form.login_password.length < 8 || !/[A-Za-z]/.test(form.login_password) || !/[0-9]/.test(form.login_password))) return toast.error("كلمة المرور لازم تكون 8 أحرف على الأقل وتحتوي على حرف ورقم");
      if (!allowedBranchIds.length && !form.branch_id) return toast.error("اختر الفروع المسموح بها");
    }

    setSaving(true);
    const { data, error } = await supabase.functions.invoke("admin-create-employee", {
      body: {
        employee_id: editing?.id ?? null,
        name: form.name.trim(),
        job_title: form.job_title,
        phone: form.phone.trim(),
        national_id: form.national_id.trim() || null,
        base_salary: Number(form.base_salary) || 0,
        hire_date: form.hire_date,
        branch_id: form.branch_id,
        allowed_branch_ids: isSimpleRole ? [] : allowedBranchIds,
        role: form.role,
        is_active: form.is_active,
        has_system_access: !isSimpleRole,
        email: isSimpleRole ? null : form.email.trim().toLowerCase(),
        password: form.login_password || null,
        work_start: shift.work_start,
        work_end: shift.work_end,
        work_days: shift.work_days,
        late_grace_minutes: shift.late_grace_minutes,
      },
    });
    setSaving(false);
    const errMsg = await edgeErrorMessage(error, data);
    if (errMsg) return toast.error(String(errMsg));

    toast.success(editing ? "تم التعديل" : "تمت إضافة الموظف وربط حسابه بالفروع");
    setOpen(false);
    load();
  };



  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke("admin-delete-employee", {
      body: { employee_id: deleteTarget.id },
    });
    setDeleting(false);
    const errMsg = (data as any)?.error ?? error?.message;
    if (errMsg) return toast.error(errMsg);
    if ((data as any)?.warning) toast.warning((data as any).warning);
    else toast.success("تم حذف الموظف نهائياً");
    setDeleteTarget(null);
    load();
  };


  const exportExcel = () => {
    const data = filtered.map((e) => ({
      "الاسم": e.name,
      "الوظيفة": e.job_title,
      "الفرع": e.branch_name,
      "التليفون": e.phone ?? "—",
      "الراتب": Number(e.base_salary),
      "سلف متبقية": e.advance_remaining,
      "تاريخ التعيين": e.hire_date,
      "الحالة": e.is_active ? "نشط" : "موقوف",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الموظفين");
    XLSX.writeFile(wb, `employees-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`تم تصدير ${data.length} موظف`);
  };

  return (
    <AdminLayout>
      <PageHeader title="الموظفين (كل الفروع)" subtitle="عرض موحّد لكل الموظفين عبر فروع الشركة" />


      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          const next = new URLSearchParams(searchParams);
          if (v === "list") next.delete("tab"); else next.set("tab", v);
          setSearchParams(next, { replace: true });
        }}
        className="w-full"
      >
        {/* التبويبات تتكيف مع الشاشات الصغيرة */}
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="list" className="gap-2"><Users className="w-4 h-4" /> قائمة الموظفين</TabsTrigger>
          <TabsTrigger value="attendance" className="gap-2"><ClipboardCheck className="w-4 h-4" /> الحضور (كل الفروع)</TabsTrigger>
          <TabsTrigger value="monthly" className="gap-2"><CalendarDays className="w-4 h-4" /> التقرير الشهري</TabsTrigger>
          {showShifts && <TabsTrigger value="shifts" className="gap-2"><CalendarRange className="w-4 h-4" /> سجل الورديات</TabsTrigger>}
          {showPresence && <TabsTrigger value="presence" className="gap-2"><UserCircle className="w-4 h-4" /> تتبع المستخدمين</TabsTrigger>}
        </TabsList>

        <TabsContent value="list" className="mt-4 space-y-4">
          <div className="flex gap-2 flex-wrap justify-end">
            <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel</Button>
            <Button className="btn-gradient" onClick={openNew}><Plus className="w-4 h-4 ml-1" /> موظف جديد</Button>
          </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-4">
        <div className="p-4 rounded-lg border bg-card">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> إجمالي الموظفين</div>
          <div className="text-2xl font-bold mt-1">{stats.total}</div>
        </div>
        <div className="p-4 rounded-lg border bg-success/5 border-success/30">
          <div className="text-xs text-success flex items-center gap-1"><UserCheck className="w-3 h-3" /> النشطين</div>
          <div className="text-2xl font-bold mt-1 text-success">{stats.active}</div>
        </div>
        <div className="p-4 rounded-lg border bg-muted">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><UserX className="w-3 h-3" /> موقوفين</div>
          <div className="text-2xl font-bold mt-1">{stats.inactive}</div>
        </div>
        <div className="p-4 rounded-lg border bg-card">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="w-3 h-3" /> إجمالي الرواتب الشهرية</div>
          <div className="text-2xl font-bold mt-1 text-primary">{formatEGP(stats.salaryTotal)}</div>
        </div>
        <div className="p-4 rounded-lg border bg-card">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Coins className="w-3 h-3" /> صافي الرواتب (بعد السلف)</div>
          <div className="text-2xl font-bold mt-1 text-success tabular-nums">{formatEGP(netSalaryTotal)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">أقساط سلف مستحقة: {formatEGP(stats.advanceDue)}</div>
        </div>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <Input placeholder="ابحث بالاسم أو الوظيفة أو التليفون" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="الفرع" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الفروع</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="active">نشط</SelectItem>
            <SelectItem value="inactive">موقوف</SelectItem>
          </SelectContent>
        </Select>
        <Select value={accessFilter} onValueChange={(v: any) => setAccessFilter(v)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">الكل (دخول وبدون دخول)</SelectItem>
            <SelectItem value="with">له دخول على السيستم</SelectItem>
            <SelectItem value="without">بدون دخول (عامل/سواق)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        loading={loading}
        rows={filtered}
        empty="لا يوجد موظفين"
        onRowClick={(r: any) => window.open(`/admin/employees/${r.id}`, "_blank", "noopener,noreferrer")}
        columns={[
          { key: "name", header: "الاسم", align: "right", width: "16rem", render: (r: any) => (
            <div className="text-right leading-tight">
              <div className="font-semibold">{r.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{r.job_title}</div>
            </div>
          )},
          { key: "branch_name", header: "الفرع الأساسي", align: "right", width: "10rem", render: (r: any) => (
            <div className="flex justify-start">
              <span className="inline-flex items-center h-6 px-2 rounded-md text-xs font-medium bg-primary/10 text-primary">{r.branch_name}</span>
            </div>
          )},
          { key: "allowed_branches", header: "الفروع ومستوى الصلاحية", align: "right", width: "16rem", render: (r: any) => {
            if (!r.user_id) return <span className="text-xs text-muted-foreground">بدون حساب</span>;
            if (!r.allowed_branches.length) return <span className="text-xs text-warning">لا فروع — تحتاج إعداد</span>;
            const items = r.allowed_branches
              .map((b: any) => ({ name: branches.find((x) => x.id === b.branch_id)?.name, level: b.access_level }))
              .filter((x: any) => x.name);
            return (
              <div className="flex flex-wrap gap-1 justify-start">
                {items.map((it: any, i: number) => (
                  <span
                    key={i}
                    className={`inline-flex items-center h-6 px-2 rounded-md text-[11px] font-medium ${
                      it.level === "read"
                        ? "bg-info/15 text-info border border-info/30"
                        : "bg-success/15 text-success border border-success/30"
                    }`}
                    title={it.level === "read" ? "عرض فقط" : "إدارة كاملة"}
                  >
                    {it.name}
                    <span className="mx-1 opacity-40">·</span>
                    {it.level === "read" ? "عرض فقط" : "إدارة كاملة"}
                  </span>
                ))}
              </div>
            );
          }},
          { key: "phone", header: "التليفون", align: "right", width: "9rem", render: (r: any) => (
            <span dir="ltr" className="block text-right tabular-nums">{r.phone ?? "—"}</span>
          )},
          { key: "base_salary", header: "الراتب", align: "right", numeric: true, width: "9rem", render: (r: any) => (
            <span className="block text-right font-bold tabular-nums">{formatEGP(r.base_salary)}</span>
          )},
          { key: "advance_remaining", header: "سلف متبقية", align: "right", numeric: true, width: "9rem", render: (r: any) => (
            r.advance_remaining > 0
              ? <span className="block text-right text-warning font-bold tabular-nums">{formatEGP(r.advance_remaining)}</span>
              : <span className="block text-right text-muted-foreground">—</span>
          )},
          { key: "hire_date", header: "التعيين", align: "center", width: "8rem", render: (r: any) => (
            <span className="tabular-nums">{formatDate(r.hire_date)}</span>
          )},
          { key: "is_active", header: "الحالة", align: "center", width: "7rem", render: (r: any) => (
            <span className={`inline-flex items-center justify-center h-6 px-2.5 rounded-md text-xs font-medium ${r.is_active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
              {r.is_active ? "نشط" : "موقوف"}
            </span>
          )},
          { key: "actions", header: "إجراءات", align: "center", width: "8rem", render: (r: any) => (
            <div className="flex items-center gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" title="تعديل" onClick={() => openEdit(r)}><Pencil className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" title="حذف" onClick={() => setDeleteTarget(r)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
            </div>
          )},
        ]}
      />
        </TabsContent>

        <TabsContent value="attendance" className="mt-4">
          <AllAttendance embedded />
        </TabsContent>

        <TabsContent value="monthly" className="mt-4">
          <MonthlyAttendanceReport embedded />
        </TabsContent>

        {showShifts && (
          <TabsContent value="shifts" className="mt-4">
            <ShiftsHistory embedded />
          </TabsContent>
        )}


        {showPresence && (
          <TabsContent value="presence" className="mt-4">
            <Presence embedded />
          </TabsContent>
        )}
      </Tabs>


      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-2 border-b">
            <DialogTitle className="text-lg">{editing ? "تعديل موظف" : "موظف جديد"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            {/* بيانات الموظف */}
            <section className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Users className="w-4 h-4" /> بيانات الموظف
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>الاسم *</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" placeholder="اسم الموظف بالكامل" />
                </div>
                <div>
                  <Label>التليفون *</Label>
                  <Input dir="ltr" className="text-right mt-1.5" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="01xxxxxxxxx" />
                </div>
                <div>
                  <Label>الوظيفة *</Label>
                  <Select value={form.job_title} onValueChange={onPositionChange}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر الوظيفة" /></SelectTrigger>
                    <SelectContent>
                      {POSITIONS.map((p) => <SelectItem key={p.value} value={p.value}>{p.value}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>الدور (الصلاحية) *</Label>
                  <Select value={form.role || "none"} onValueChange={(v) => setForm({ ...form, role: v === "none" ? "" : v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر الصلاحية" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="branch_manager">مدير فرع</SelectItem>
                      <SelectItem value="accountant">محاسب</SelectItem>
                      <SelectItem value="cashier">كاشير</SelectItem>
                      <SelectItem value="warehouse">أمين مخازن</SelectItem>
                      <SelectItem value="supervisor">ملاحظ (متابعة الحضور والانصراف فقط)</SelectItem>
                      <SelectItem value="viewer">Viewer — مراقب (قراءة فقط لكل البيانات)</SelectItem>
                      <SelectItem value="worker">عامل</SelectItem>
                      <SelectItem value="driver">سواق</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>الرقم القومي</Label>
                  <Input dir="ltr" className="text-right mt-1.5" maxLength={14} value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value.replace(/\D/g, "") })} placeholder="14 رقم" />
                </div>
                <div>
                  <Label>الراتب الأساسي</Label>
                  <Input type="number" value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} className="mt-1.5" placeholder="0" />
                </div>
                <div>
                  <Label>تاريخ التعيين</Label>
                  <Input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} className="mt-1.5" />
                </div>
              </div>
            </section>

            {/* الفروع */}
            <section className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <UserCheck className="w-4 h-4" /> الفروع
              </div>
              <div>
                <Label>الفرع الأساسي *</Label>
                <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="— اختر —" /></SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {!isSimpleRole && (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-sm">الفروع المسموح بالدخول عليها *</Label>
                    <Button
                      type="button" variant="ghost" size="sm" className="h-7 text-xs"
                      onClick={() => setAllowedBranchIds(
                        allowedBranchIds.length === branches.length ? [] : branches.map((b) => b.id)
                      )}
                    >
                      {allowedBranchIds.length === branches.length ? "إلغاء الكل" : "اختيار كل الفروع"}
                    </Button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2 mt-3">
                    {branches.map((b) => {
                      const checked = allowedBranchIds.includes(b.id);
                      return (
                        <label
                          key={b.id}
                          className={`flex items-start gap-2 text-sm rounded-lg border px-3 py-2 cursor-pointer transition-colors ${checked ? "border-primary bg-primary/10" : "bg-background hover:bg-muted/60"}`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 shrink-0 accent-[hsl(var(--primary))]"
                            checked={checked}
                            onChange={(e) => setAllowedBranchIds(
                              e.target.checked
                                ? [...allowedBranchIds, b.id]
                                : allowedBranchIds.filter((x) => x !== b.id)
                            )}
                          />
                          <span className="leading-snug">{b.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            {/* الدخول على النظام */}
            {!isSimpleRole ? (
              <section className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <ClipboardCheck className="w-4 h-4" /> بيانات الدخول
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label>البريد الإلكتروني *</Label>
                    <Input type="email" name="employee-email" autoComplete="off" data-lpignore="true" data-form-type="other" dir="ltr" className="text-right mt-1.5" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="employee@company.com" />
                  </div>
                  <div>
                    <Label>{editing ? "كلمة المرور (اتركها فارغة بدون تغيير)" : "كلمة المرور *"}</Label>
                    <div className="relative mt-1.5">
                      <Input type={showPwd ? "text" : "password"} name="employee-new-password" autoComplete="new-password" data-lpignore="true" data-form-type="other" dir="ltr" className="text-right pl-10" value={form.login_password} onChange={(e) => setForm({ ...form, login_password: e.target.value })} placeholder="8 أحرف على الأقل، منها حرف ورقم" />
                      <button type="button" tabIndex={-1} onClick={() => setShowPwd((v) => !v)}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {editing
                        ? "كلمة المرور القديمة متشفّرة ومش ممكن تتعرض — لو الموظف نسيها اكتب كلمة جديدة هنا واضغط على العين علشان تشوفها قبل الحفظ."
                        : "اضغط على العين علشان تشوف الكلمة اللي كتبتها قبل الحفظ."}
                    </p>
                  </div>
                </div>
              </section>
            ) : (
              <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
                {form.role === "worker" ? "العمال" : "السواقين"} لا يدخلون على السيستم — يتابعهم المحاسب أو أمين المخزن.
              </div>
            )}

            {/* الشيفت */}
            <section className="rounded-xl border bg-card p-4">
              <ShiftEditor value={shift} onChange={setShift} />
            </section>

            {editing && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-[hsl(var(--primary))]" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                موظف نشط
              </label>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={saving}>{saving ? "جاري الحفظ..." : editing ? "حفظ" : "إضافة"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الموظف "{deleteTarget?.name}"؟</AlertDialogTitle>
            <AlertDialogDescription>
              لن يُسمح بالحذف إذا كان للموظف طلبات سلف معلّقة. الأفضل إيقاف تنشيطه بدلاً من الحذف للحفاظ على سجل الرواتب.
              <br /><b className="text-destructive">هذا الإجراء لا يمكن التراجع عنه.</b>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={confirmDelete}
            >
              {deleting ? "جاري الحذف..." : "نعم، احذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
