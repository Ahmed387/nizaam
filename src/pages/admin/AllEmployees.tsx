import { useEffect, useMemo, useState } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useNavigate } from "react-router-dom";
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
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { Plus, FileSpreadsheet, ArrowRight, Users, UserCheck, UserX, Wallet, Pencil, Trash2, ClipboardCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AllAttendance from "./AllAttendance";

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
  const { tenantId } = useAuth();
  const [emps, setEmps] = useState<any[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [advRemaining, setAdvRemaining] = useState<Record<string, number>>({});
  const [userBranches, setUserBranches] = useState<Record<string, string[]>>({});
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
  const isSimpleRole = form.role === "worker" || form.role === "driver";

  const load = async () => {
    setLoading(true);
    const [{ data: e }, { data: b }, { data: a }] = await Promise.all([
      supabase.from("employees").select("*").order("created_at", { ascending: false }),
      supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
      supabase.from("advances").select("employee_id, remaining"),
    ]);
    setEmps(e ?? []);
    setBranches(b ?? []);
    const map: Record<string, number> = {};
    for (const x of (a ?? []) as any[]) {
      map[x.employee_id] = (map[x.employee_id] ?? 0) + Number(x.remaining);
    }
    setAdvRemaining(map);
    const uids = (e ?? []).map((x: any) => x.user_id).filter(Boolean);
    if (uids.length) {
      const { data: bu } = await supabase.from("branch_users").select("user_id, branch_id").in("user_id", uids);
      const ub: Record<string, string[]> = {};
      for (const r of (bu ?? []) as any[]) {
        (ub[r.user_id] = ub[r.user_id] || []).push(r.branch_id);
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
    allowed_branches: e.user_id ? (userBranches[e.user_id] ?? []) : [],
  })), [emps, branches, advRemaining, userBranches]);

  const filtered = useMemo(() => enriched.filter((e) => {
    if (search && !e.name.includes(search) && !(e.job_title ?? "").includes(search) && !(e.phone ?? "").includes(search)) return false;
    if (branchFilter !== "all" && e.branch_id !== branchFilter) return false;
    if (statusFilter === "active" && !e.is_active) return false;
    if (statusFilter === "inactive" && e.is_active) return false;
    return true;
  }), [enriched, search, branchFilter, statusFilter]);

  const stats = useMemo(() => ({
    total: enriched.length,
    active: enriched.filter((e) => e.is_active).length,
    inactive: enriched.filter((e) => !e.is_active).length,
    salaryTotal: enriched.filter((e) => e.is_active).reduce((s, e) => s + Number(e.base_salary), 0),
  }), [enriched]);

  const openNew = () => {
    setForm({ name: "", job_title: "", phone: "", email: "", login_password: "", national_id: "", base_salary: "", hire_date: new Date().toISOString().slice(0, 10), branch_id: "", role: "", is_active: true });
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
    setOpen(true);
  };

  const onPositionChange = (val: string) => {
    const pos = POSITIONS.find((p) => p.value === val);
    setForm({ ...form, job_title: val, role: pos?.role ?? form.role });
  };

  const submit = async () => {
    if (!form.name || !form.job_title || !form.branch_id || !form.role) return toast.error("املأ الاسم والوظيفة والفرع والصلاحية");
    if (!form.phone) return toast.error("التليفون مطلوب");

    const payload: any = {
      branch_id: form.branch_id,
      name: form.name.trim(),
      job_title: form.job_title,
      phone: form.phone.trim(),
      national_id: form.national_id.trim() || null,
      base_salary: Number(form.base_salary) || 0,
      hire_date: form.hire_date,
      role: form.role || null,
      is_active: form.is_active,
      has_system_access: !isSimpleRole,
    };

    if (isSimpleRole) {
      // Workers/Drivers: no email/password — they don't log in
      payload.email = null;
      if (!editing) payload.login_password = null;
    } else {
      if (!form.email) return toast.error("الإيميل مطلوب لدخول الموظف");
      if (!editing && (!form.login_password || form.login_password.length < 6)) return toast.error("كلمة المرور 6 أحرف على الأقل");
      if (editing && form.login_password && form.login_password.length < 6) return toast.error("كلمة المرور 6 أحرف على الأقل");
      const emailLower = form.email.trim().toLowerCase();
      const { data: dup } = await supabase.from("employees").select("id").ilike("email", emailLower).maybeSingle();
      if (dup && dup.id !== editing?.id) return toast.error("يوجد موظف بنفس الإيميل بالفعل");
      payload.email = emailLower;
      if (!editing || form.login_password) {
        payload.login_password = form.login_password || null;
      }
    }

    if (editing) {
      const { error } = await supabase.from("employees").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("تم التعديل");
    } else {
      const { error } = await supabase.from("employees").insert({ ...payload, tenant_id: tenantId });
      if (error) return toast.error(error.message);
      toast.success("تمت الإضافة");
    }
    setOpen(false);
    load();
  };


  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("employees").delete().eq("id", deleteTarget.id);
    setDeleting(false);
    if (error) return toast.error(error.message);
    toast.success("تم حذف الموظف");
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


      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list" className="gap-2"><Users className="w-4 h-4" /> قائمة الموظفين</TabsTrigger>
          <TabsTrigger value="attendance" className="gap-2"><ClipboardCheck className="w-4 h-4" /> الحضور (كل الفروع)</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4 space-y-4">
          <div className="flex gap-2 flex-wrap justify-end">
            <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel</Button>
            <Button className="btn-gradient" onClick={openNew}><Plus className="w-4 h-4 ml-1" /> موظف جديد</Button>
          </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
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
      </div>

      <DataTable
        loading={loading}
        rows={filtered}
        empty="لا يوجد موظفين"
        onRowClick={(r: any) => nav(`/admin/employees/${r.id}`)}
        columns={[
          { key: "name", header: "الاسم", render: (r: any) => (
            <div>
              <div className="font-semibold">{r.name}</div>
              <div className="text-xs text-muted-foreground">{r.job_title}</div>
            </div>
          )},
          { key: "branch_name", header: "الفرع الأساسي", render: (r: any) => (
            <span className="px-2 py-0.5 rounded text-xs bg-primary/10 text-primary">{r.branch_name}</span>
          )},
          { key: "allowed_branches", header: "الفروع المسموح بها (للدخول)", render: (r: any) => {
            if (!r.user_id) return <span className="text-xs text-muted-foreground">بدون حساب</span>;
            if (!r.allowed_branches.length) return <span className="text-xs text-warning">لا فروع — تحتاج إعداد</span>;
            const names = r.allowed_branches.map((bid: string) => branches.find((b) => b.id === bid)?.name).filter(Boolean);
            if (names.length === branches.length) return <span className="text-xs px-2 py-0.5 rounded bg-success/15 text-success">كل الفروع</span>;
            return (
              <div className="flex flex-wrap gap-1 max-w-[220px]">
                {names.map((n: string, i: number) => (
                  <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-muted">{n}</span>
                ))}
              </div>
            );
          }},
          { key: "phone", header: "التليفون", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
          { key: "base_salary", header: "الراتب", render: (r: any) => <b>{formatEGP(r.base_salary)}</b> },
          { key: "advance_remaining", header: "سلف متبقية", render: (r: any) => (
            r.advance_remaining > 0
              ? <span className="text-warning font-bold">{formatEGP(r.advance_remaining)}</span>
              : <span className="text-muted-foreground">—</span>
          )},
          { key: "hire_date", header: "التعيين", render: (r: any) => formatDate(r.hire_date) },
          { key: "user_id", header: "حساب دخول", render: (r: any) => (
            r.user_id
              ? <span className="px-2 py-0.5 rounded text-xs bg-success/15 text-success">مرتبط</span>
              : <span className="text-xs text-muted-foreground">—</span>
          )},
          { key: "is_active", header: "الحالة", render: (r: any) => (
            <span className={`px-2 py-0.5 rounded text-xs ${r.is_active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
              {r.is_active ? "نشط" : "موقوف"}
            </span>
          )},
          { key: "actions", header: "", render: (r: any) => (
            <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(r)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
              <ArrowRight className="w-4 h-4 text-muted-foreground self-center" />
            </div>
          )},
        ]}
      />
        </TabsContent>

        <TabsContent value="attendance" className="mt-4">
          <AllAttendance embedded />
        </TabsContent>
      </Tabs>


      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "تعديل موظف" : "موظف جديد"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الفرع الأساسي *</Label>
              <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="— اختر —" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="text-[11px] text-muted-foreground mt-1">
                ده الفرع الرئيسي للموظف. لو محتاج تربطه بأكتر من فرع (مثلاً محاسب على كل الفروع) — افتح صفحته بعد الإنشاء واستخدم زر "إدارة الفروع".
              </div>
            </div>
            <div><Label>الاسم *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" /></div>
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
            <div><Label>التليفون *</Label><Input dir="ltr" className="text-right mt-1.5" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label>الرقم القومي</Label><Input dir="ltr" className="text-right mt-1.5" maxLength={14} value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value.replace(/\D/g, "") })} placeholder="14 رقم" /></div>
            {!isSimpleRole && (
              <>
                <div><Label>البريد الإلكتروني *</Label><Input type="email" dir="ltr" className="text-right mt-1.5" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="employee@company.com" /></div>
                <div><Label>{editing ? "كلمة المرور (اتركها فارغة بدون تغيير)" : "كلمة المرور (للدخول كموظف) *"}</Label><Input type="password" dir="ltr" className="text-right mt-1.5" value={form.login_password} onChange={(e) => setForm({ ...form, login_password: e.target.value })} placeholder="6 أحرف على الأقل" /></div>
              </>
            )}
            {isSimpleRole && (
              <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2">
                {form.role === "worker" ? "العمال" : "السواقين"} لا يدخلون على السيستم — يتابعهم المحاسب أو أمين المخزن.
              </div>
            )}
            <div><Label>الراتب الأساسي</Label><Input type="number" value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} className="mt-1.5" /></div>
            {editing && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                موظف نشط
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit}>{editing ? "حفظ" : "إضافة"}</Button>
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
