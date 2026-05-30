import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { DataTable } from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";
import { Plus, LogIn, LogOut } from "lucide-react";
import { computeLate, isWorkDay } from "@/components/ShiftEditor";

const STATUS = {
  present: "حاضر",
  late: "متأخر",
  absent: "غائب",
  leave: "إجازة",
};

export default function Attendance({ embedded = false }: { embedded?: boolean } = {}) {
  const { id: branchId } = useParams<{ id: string }>();
  const { tenant, user, roles, isAdmin } = useAuth();

  // Determine which target employee roles the current user can manage
  const canManageRole = (targetRole: string | null) => {
    if (isAdmin || roles.includes("super_admin") || roles.includes("supervisor")) return true;
    if (!targetRole) return false;
    if (["worker", "driver"].includes(targetRole)) {
      return roles.includes("accountant") || roles.includes("warehouse");
    }
    if (targetRole === "cashier") return roles.includes("branch_manager");
    return false;
  };
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [employees, setEmployees] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: "", status: "present", notes: "" });

  const [presence, setPresence] = useState<Record<string, { last_login_at: string | null; last_seen_at: string }>>({});

  const load = async () => {
    setLoading(true);
    const [{ data: emps }, { data: att }] = await Promise.all([
      supabase.from("employees").select("id,name,job_title,role,user_id,has_system_access,work_start,work_end,work_days,late_grace_minutes").eq("branch_id", branchId).eq("is_active", true).order("name"),
      supabase.from("attendance").select("*").eq("branch_id", branchId).eq("date", date).order("created_at"),
    ]);
    setEmployees(emps ?? []);
    setRows(att ?? []);
    const uids = (emps ?? []).map((e: any) => e.user_id).filter(Boolean);
    if (uids.length) {
      const { data: pres } = await supabase
        .from("user_presence" as any)
        .select("user_id, last_login_at, last_seen_at")
        .in("user_id", uids);
      const m: Record<string, any> = {};
      (pres ?? []).forEach((p: any) => { m[p.user_id] = p; });
      setPresence(m);
    } else setPresence({});
    setLoading(false);
  };
  useEffect(() => { load(); }, [branchId, date]);

  const fmtTime = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) : "—";
  const isToday = (iso?: string | null) => iso ? new Date(iso).toISOString().slice(0, 10) === date : false;

  const byEmployee = useMemo(() => {
    const m = new Map<string, any>();
    rows.forEach((r) => m.set(r.employee_id, r));
    return m;
  }, [rows]);

  const upsert = async (employeeId: string, patch: any) => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;
    const existing = byEmployee.get(employeeId);
    if (existing) {
      const { error } = await supabase.from("attendance").update(patch).eq("id", existing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("attendance").insert({
        branch_id: branchId!,
        tenant_id: tenant?.id ?? null,
        employee_id: employeeId,
        employee_name: emp.name,
        date,
        created_by: user?.id ?? null,
        ...patch,
      });
      if (error) return toast.error(error.message);
    }
    load();
  };

  const checkIn = (employeeId: string) => {
    const emp = employees.find((e) => e.id === employeeId);
    const now = new Date().toISOString();
    const status = computeLate(now, emp) ?? "present";
    return upsert(employeeId, { check_in: now, status });
  };
  const checkOut = (employeeId: string) => upsert(employeeId, { check_out: new Date().toISOString() });

  const submitManual = async () => {
    if (!form.employee_id) return toast.error("اختر الموظف");
    await upsert(form.employee_id, { status: form.status, notes: form.notes || null });
    toast.success("تم تسجيل الحالة");
    setOpen(false);
    setForm({ employee_id: "", status: "present", notes: "" });
  };

  const controls = (
    <div className="flex gap-2 items-center">
      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
      <Button onClick={() => setOpen(true)} className="gap-1"><Plus className="w-4 h-4" /> تسجيل يدوي</Button>
    </div>
  );

  const body = (
    <>
      {embedded && <div className="flex justify-end mb-3">{controls}</div>}


      <DataTable
        loading={loading}
        rows={employees}
        empty="لا يوجد موظفين"
        columns={[
          { key: "name", header: "الموظف", render: (e: any) => <span className="font-semibold">{e.name}</span> },
          { key: "job_title", header: "الوظيفة" },
          {
            key: "shift", header: "الشيفت",
            render: (e: any) => {
              if (!e.work_start) return <span className="text-xs text-muted-foreground">—</span>;
              const off = !isWorkDay(date, e.work_days);
              return (
                <div className="text-xs">
                  <span dir="ltr">{e.work_start?.slice(0,5)} - {e.work_end?.slice(0,5) ?? "?"}</span>
                  {off && <span className="ms-1 text-warning">(إجازة)</span>}
                </div>
              );
            },
          },
          {
            key: "status", header: "الحالة",
            render: (e: any) => {
              const a = byEmployee.get(e.id);
              const status = a?.status ?? "absent";
              const color = status === "present" ? "text-success" : status === "late" ? "text-warning" : status === "leave" ? "text-info" : "text-muted-foreground";
              return <span className={color}>{STATUS[status as keyof typeof STATUS] ?? status}</span>;
            },
          },
          {
            key: "check_in", header: "وقت الحضور",
            render: (e: any) => {
              const a = byEmployee.get(e.id);
              return a?.check_in ? <span dir="ltr" className="text-xs">{new Date(a.check_in).toLocaleTimeString("ar-EG")}</span> : "—";
            },
          },
          {
            key: "check_out", header: "وقت الانصراف",
            render: (e: any) => {
              const a = byEmployee.get(e.id);
              return a?.check_out ? <span dir="ltr" className="text-xs">{new Date(a.check_out).toLocaleTimeString("ar-EG")}</span> : "—";
            },
          },
          {
            key: "presence", header: "تواجد على السيستم (اليوم)",
            render: (e: any) => {
              if (!e.user_id) return <span className="text-xs text-muted-foreground">بدون دخول</span>;
              const p = presence[e.user_id];
              if (!p) return <span className="text-xs text-muted-foreground">—</span>;
              const loginToday = isToday(p.last_login_at);
              const seenToday = isToday(p.last_seen_at);
              return (
                <div className="text-xs leading-tight">
                  <div className={loginToday ? "text-success" : "text-muted-foreground"}>دخول: {loginToday ? fmtTime(p.last_login_at) : "لم يدخل"}</div>
                  <div className={seenToday ? "text-info" : "text-muted-foreground"}>آخر ظهور: {seenToday ? fmtTime(p.last_seen_at) : "—"}</div>
                </div>
              );
            },
          },
          {
            key: "actions", header: "",
            render: (e: any) => {
              const a = byEmployee.get(e.id);
              const allowed = canManageRole(e.role);
              if (!allowed) return <span className="text-xs text-muted-foreground">—</span>;
              const p = e.user_id ? presence[e.user_id] : null;
              const canUsePresence = !!(p && isToday(p.last_login_at) && !a?.check_in);
              return (
                <div className="flex gap-1 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => checkIn(e.id)} disabled={!!a?.check_in}>
                    <LogIn className="w-3.5 h-3.5 ml-1" /> حضور
                  </Button>
                  {canUsePresence && (
                    <Button size="sm" variant="ghost" title="استخدم وقت أول دخول للسيستم"
                      onClick={() => upsert(e.id, { check_in: p!.last_login_at, status: computeLate(p!.last_login_at!, e) ?? "present" })}>
                      من السيستم
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => checkOut(e.id)} disabled={!a?.check_in || !!a?.check_out}>
                    <LogOut className="w-3.5 h-3.5 ml-1" /> انصراف
                  </Button>
                </div>
              );
            },
          },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>تسجيل حالة يدوي</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الموظف</Label>
              <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الحالة</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>ملاحظات</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1.5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submitManual}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (embedded) return body;
  return (
    <BranchLayout>
      <PageHeader title="الحضور والانصراف" subtitle={formatDate(date)} actions={controls} />
      {body}
    </BranchLayout>
  );
}
