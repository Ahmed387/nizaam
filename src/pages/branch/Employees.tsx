import { useEffect, useState } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useNavigate, useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEGP, formatDate } from "@/lib/format";
import { toast } from "sonner";
import { edgeErrorMessage } from "@/lib/edgeError";
import { Plus, ArrowRight, Eye, EyeOff, FileSpreadsheet, Users, Clock, HandCoins, KeyRound } from "lucide-react";
import { BulkLoginsDialog } from "@/components/BulkLoginsDialog";
import { ExcelImportDialog } from "@/components/ExcelImportDialog";
import { ShiftEditor, ShiftValue, emptyShift } from "@/components/ShiftEditor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Attendance from "./Attendance";
import AdvanceRequests from "./AdvanceRequests";
import { cairoTodayDay } from "@/lib/cairoDate";
import { EmployeeLink } from "@/components/employees/EmployeeLink";


const POSITIONS = [
  { value: "كاشير", role: "cashier" as const },
  { value: "مدير فرع", role: "branch_manager" as const },
  { value: "أمين مخزن", role: "warehouse" as const },
  { value: "محاسب", role: "accountant" as const },
  { value: "ملاحظ (حضور وانصراف)", role: "supervisor" as const },
  { value: "عامل", role: "worker" as const },
  { value: "سواق", role: "driver" as const },
];

export default function Employees() {
  const { id: branchId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { tenant } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [form, setForm] = useState({
    name: "",
    job_title: "",
    email: "",
    phone: "",
    national_id: "",
    address: "",
    base_salary: "",
    login_password: "",
    role: "cashier",
    hire_date: cairoTodayDay(),
  });
  const [shift, setShift] = useState<ShiftValue>(emptyShift());

  // Workers & Drivers don't need system access — minimal form
  const isSimpleRole = form.role === "worker" || form.role === "driver";

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("employees")
      .select("*")
      .eq("branch_id", branchId)
      .order("created_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [branchId]);
  useRealtimeRefresh(["employees", "advances", "advance_requests", "salaries"], load);

  const submit = async () => {
    if (!form.name || !form.job_title || !form.phone) {
      return toast.error("الاسم والتليفون والوظيفة مطلوبة");
    }
    if (!isSimpleRole) {
      if (!form.email) return toast.error("الإيميل مطلوب");
      if (!form.login_password || form.login_password.length < 8 || !/[A-Za-z]/.test(form.login_password) || !/[0-9]/.test(form.login_password)) {
        return toast.error("كلمة المرور لازم تكون 8 أحرف على الأقل وتحتوي على حرف ورقم");
      }
    }

    const { data, error } = await supabase.functions.invoke("admin-create-employee", {
      body: {
        name: form.name.trim(),
        job_title: form.job_title,
        phone: form.phone.trim(),
        national_id: form.national_id.trim() || null,
        base_salary: Number(form.base_salary) || 0,
        hire_date: form.hire_date,
        branch_id: branchId,
        allowed_branch_ids: branchId ? [branchId] : [],
        role: form.role,
        is_active: true,
        has_system_access: !isSimpleRole,
        email: isSimpleRole ? null : form.email.trim().toLowerCase(),
        password: isSimpleRole ? null : form.login_password,
        work_start: shift.work_start,
        work_end: shift.work_end,
        work_days: shift.work_days,
        late_grace_minutes: shift.late_grace_minutes,
      },
    });
    if (error || (data as any)?.error) {
      return toast.error((await edgeErrorMessage(error, data)) ?? "فشل إضافة الموظف");
    }
    toast.success(isSimpleRole ? "تمت الإضافة" : "تمت إضافة الموظف — يستطيع الآن تسجيل الدخول");


    setOpen(false);
    setForm({
      name: "", job_title: "", email: "", phone: "", national_id: "", address: "",
      base_salary: "", login_password: "", role: "cashier",
      hire_date: cairoTodayDay(),
    });
    setShift(emptyShift());
    load();
  };

  const onPositionChange = (val: string) => {
    const pos = POSITIONS.find((p) => p.value === val);
    setForm({ ...form, job_title: val, role: pos?.role ?? form.role });
  };

  return (
    <BranchLayout>
      <PageHeader title="الموظفين" subtitle={`${rows.length} موظف`} />

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list" className="gap-2"><Users className="w-4 h-4 shrink-0" /> قائمة الموظفين</TabsTrigger>
          <TabsTrigger value="attendance" className="gap-2 whitespace-nowrap" title="الحضور والانصراف"><Clock className="w-4 h-4 shrink-0" /> الحضور والانصراف</TabsTrigger>
          <TabsTrigger value="advances" className="gap-2"><HandCoins className="w-4 h-4 shrink-0" /> طلبات السلف</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <div className="flex gap-2 flex-wrap justify-end mb-3">
            <Button variant="outline" onClick={() => setImportOpen(true)}><FileSpreadsheet className="w-4 h-4 ml-1" /> استيراد Excel</Button>
            <Button variant="outline" onClick={() => setBulkOpen(true)}><KeyRound className="w-4 h-4 ml-1" /> إنشاء حسابات دخول جماعية</Button>
            <Button onClick={() => setOpen(true)} className="gap-2"><Plus className="w-4 h-4" /> إضافة موظف</Button>
          </div>
          <DataTable
            loading={loading}
            rows={rows}
            onRowClick={(r: any) => nav(`/admin/employees/${r.id}`)}
            empty="لا يوجد موظفين"
            columns={[
              { key: "name", header: "الاسم", align: "center", render: (r: any) => <EmployeeLink id={r.id} name={r.name} /> },
              { key: "job_title", header: "الوظيفة", align: "center" },
              { key: "email", header: "الإيميل", align: "center", render: (r: any) => <span dir="ltr" className="text-xs">{r.email ?? "—"}</span> },
              { key: "phone", header: "التليفون", align: "center", render: (r: any) => <span dir="ltr">{r.phone ?? "—"}</span> },
              { key: "base_salary", header: "الراتب", align: "center", numeric: true, render: (r: any) => formatEGP(r.base_salary) },
              { key: "hire_date", header: "تاريخ التعيين", align: "center", render: (r: any) => formatDate(r.hire_date) },
              {
                key: "is_active", header: "الحالة", align: "center",
                render: (r: any) => <span className={r.is_active ? "text-success font-semibold" : "text-muted-foreground"}>{r.is_active ? "نشط" : "موقوف"}</span>,
              },
              {
                key: "actions", header: "إجراءات", align: "center", width: "6rem",
                render: (r: any) => (
                  <Button
                    size="icon" variant="ghost" className="h-8 w-8 mx-auto"
                    title="فتح ملف الموظف"
                    onClick={(e) => { e.stopPropagation(); nav(`/admin/employees/${r.id}`); }}
                  >
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                ),
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="attendance" className="mt-4">
          <Attendance embedded />
        </TabsContent>

        <TabsContent value="advances" className="mt-4">
          <AdvanceRequests embedded />
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>موظف جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الاسم *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>الوظيفة *</Label>
              <Select value={form.job_title} onValueChange={onPositionChange}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر الوظيفة" /></SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!isSimpleRole && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>البريد الإلكتروني *</Label>
                  <Input dir="ltr" type="email" name="employee-email" autoComplete="off" data-lpignore="true" data-form-type="other" className="text-right mt-1.5" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div>
                  <Label>التليفون *</Label>
                  <Input dir="ltr" className="text-right mt-1.5" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
            )}
            {isSimpleRole && (
              <div>
                <Label>التليفون *</Label>
                <Input dir="ltr" className="text-right mt-1.5" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            )}
            <div>
              <Label>رقم البطاقة</Label>
              <Input dir="ltr" className="text-right mt-1.5" value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value })} />
            </div>
            {!isSimpleRole && (
              <div>
                <Label>العنوان</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1.5" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>الراتب الأساسي</Label>
                <Input type="number" value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} className="mt-1.5" />
              </div>
              <div>
                <Label>تاريخ التعيين</Label>
                <Input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} className="mt-1.5" />
              </div>
            </div>
            <ShiftEditor value={shift} onChange={setShift} />
            {!isSimpleRole && (
              <>
                <div>
                  <Label>الصلاحية *</Label>
                  <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cashier">كاشير</SelectItem>
                      <SelectItem value="branch_manager">مدير فرع</SelectItem>
                      <SelectItem value="warehouse">أمين مخزن</SelectItem>
                      <SelectItem value="accountant">محاسب</SelectItem>
                      <SelectItem value="supervisor">ملاحظ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>كلمة مرور الدخول *</Label>
                  <div className="relative mt-1.5">
                    <Input
                      type={showPwd ? "text" : "password"}
                      name="employee-new-password"
                      autoComplete="new-password"
                      data-lpignore="true"
                      data-form-type="other"
                      value={form.login_password}
                      onChange={(e) => setForm({ ...form, login_password: e.target.value })}
                      className="pl-10"
                      placeholder="8 أحرف على الأقل، منها حرف ورقم"
                    />
                    <button type="button" onClick={() => setShowPwd((v) => !v)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">سيستخدمها الموظف عند أول دخول مع بياناته</p>
                </div>
              </>
            )}
            {isSimpleRole && (
              <p className="text-xs text-info bg-info/10 p-2 rounded">
                {form.role === "worker" ? "العمال" : "السواقين"} لا يدخلون على السيستم — يتابعهم المحاسب أو أمين المخزن.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit}>إضافة الموظف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkLoginsDialog open={bulkOpen} onOpenChange={setBulkOpen} branchId={branchId} onDone={load} />

      <ExcelImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="استيراد موظفين من Excel"
        templateName="employees-template"
        columns={[
          { key: "name", header: "الاسم", required: true },
          { key: "job_title", header: "الوظيفة", required: true },
          { key: "role", header: "الدور (cashier/branch_manager/warehouse/accountant)" },
          { key: "phone", header: "التليفون" },
          { key: "base_salary", header: "الراتب الأساسي", type: "number" },
          { key: "hire_date", header: "تاريخ التعيين", type: "date" },
        ]}
        sampleRow={{ name: "أحمد محمد", job_title: "كاشير", role: "cashier", phone: "01000000000", base_salary: 5000, hire_date: cairoTodayDay() }}
        onImport={async (importRows) => {
          let inserted = 0;
          for (const r of importRows) {
            const { error } = await supabase.from("employees").insert({
              branch_id: branchId!, tenant_id: tenant?.id ?? null,
              name: r.name, job_title: r.job_title,
              role: r.role || null, phone: r.phone || null,
              base_salary: r.base_salary ?? 0,
              hire_date: r.hire_date ?? cairoTodayDay(),
            });
            if (!error) inserted++;
          }
          load();
          return { inserted };
        }}
      />
    </BranchLayout>
  );
}
