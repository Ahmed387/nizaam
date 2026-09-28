import { useEffect, useMemo, useState } from "react";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
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
import { Plus, LogIn, LogOut, ArrowRight, Zap, CalendarOff } from "lucide-react";
import { fetchSchedules, fetchClosures, offDayReason, countWorkingDays } from "@/lib/branchSchedule";

import { computeLate, isWorkDay } from "@/components/ShiftEditor";
import { workedMinutes, formatHours, sumWorkedMinutes } from "@/lib/attendanceHours";
import { cairoTodayDay } from "@/lib/cairoDate";

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
  const [date, setDate] = useState(cairoTodayDay());
  const [employees, setEmployees] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: "", status: "present", notes: "" });

  const [presence, setPresence] = useState<Record<string, { last_login_at: string | null; last_seen_at: string }>>({});
  const [branchOff, setBranchOff] = useState<string | null>(null);
  const [monthWorkingDays, setMonthWorkingDays] = useState(0);
  const [monthAtt, setMonthAtt] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!branchId) return;
      const [schedules, closures] = await Promise.all([fetchSchedules(), fetchClosures(branchId)]);
      if (cancelled) return;
      setBranchOff(offDayReason(schedules[branchId], closures, date));
      // Compliance is measured over actual working days of the selected month only
      const monthStart = date.slice(0, 8) + "01";
      const monthEnd = date;
      setMonthWorkingDays(countWorkingDays(schedules[branchId], closures, monthStart, monthEnd));
      const { data: mAtt } = await supabase
        .from("attendance").select("employee_id,status,date,check_in,check_out")
        .eq("branch_id", branchId).gte("date", monthStart).lte("date", monthEnd);
      if (!cancelled) setMonthAtt(mAtt ?? []);
    })();
    return () => { cancelled = true; };
  }, [branchId, date]);



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
  useRealtimeRefresh(["attendance", "employees", "user_presence"], load);

  const fmtTime = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) : "—";
  const isToday = (iso?: string | null) => iso ? new Date(iso).toISOString().slice(0, 10) === date : false;

  const byEmployee = useMemo(() => {
    const m = new Map<string, any>();
    rows.forEach((r) => m.set(r.employee_id, r));
    return m;
  }, [rows]);

  // Attendance days counted only on branch working days (off-days never count as absence)
  const complianceByEmployee = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of monthAtt) {
      if (a.status === "present" || a.status === "late") m[a.employee_id] = (m[a.employee_id] ?? 0) + 1;
    }
    return m;
  }, [monthAtt]);

  // إجمالي ساعات العمل خلال الشهر لكل موظف (بيحسب الشيفت اللي بيعدي منتصف الليل صح)
  const monthMinutesByEmployee = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of monthAtt) {
      const grouped = m[a.employee_id] ?? 0;
      m[a.employee_id] = grouped + (workedMinutes(a.check_in, a.check_out) ?? 0);
    }
    return m;
  }, [monthAtt]);


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

      {branchOff && (
        <div className="mb-3 rounded-lg border border-warning/40 bg-warning/10 p-3 flex items-start gap-2">
          <CalendarOff className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-bold">الفرع مقفول في اليوم ده</div>
            <div className="text-muted-foreground">{branchOff} — الغياب في اليوم ده مش محسوب على الموظفين، واليوم ده مستبعد من أيام العمل.</div>
          </div>
        </div>
      )}




      <div className="mb-3 text-xs text-muted-foreground">
        أيام العمل الفعلية من بداية الشهر حتى {formatDate(date)}: <b className="text-foreground">{monthWorkingDays}</b> يوم
        (بعد استبعاد الإجازات الأسبوعية والإغلاق الاستثنائي) — نسبة الالتزام محسوبة على الأيام دي بس.
      </div>

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
              if (!a && branchOff) return <span className="text-info">عطلة الفرع</span>;
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
            key: "hours", header: "ساعات اليوم / الشهر",
            render: (e: any) => {
              const a = byEmployee.get(e.id);
              const day = workedMinutes(a?.check_in, a?.check_out);
              const month = monthMinutesByEmployee[e.id] ?? 0;
              return (
                <div className="text-xs leading-tight" dir="ltr">
                  <div className="font-bold">{formatHours(day)}</div>
                  <div className="text-muted-foreground">{formatHours(month)}</div>
                </div>
              );
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
            key: "compliance", header: "الالتزام (أيام العمل)",
            render: (e: any) => {
              if (!monthWorkingDays) return <span className="text-xs text-muted-foreground">—</span>;
              const done = complianceByEmployee[e.id] ?? 0;
              const pct = Math.min(100, Math.round((done / monthWorkingDays) * 100));
              const color = pct >= 90 ? "text-success" : pct >= 70 ? "text-warning" : "text-destructive";
              return (
                <div className="text-xs leading-tight">
                  <span className={`font-bold ${color}`}>{pct}%</span>
                  <span className="text-muted-foreground"> ({done}/{monthWorkingDays})</span>
                </div>
              );
            },
          },
          {
            key: "actions", header: "إجراءات", align: "center", width: "11rem",
            render: (e: any) => {
              const a = byEmployee.get(e.id);
              const allowed = canManageRole(e.role);
              if (!allowed) return <span className="text-xs text-muted-foreground">—</span>;
              const p = e.user_id ? presence[e.user_id] : null;
              const canUsePresence = !!(p && isToday(p.last_login_at) && !a?.check_in);
              const completed = !!a?.check_in && !!a?.check_out;
              if (completed) {
                return (
                  <div className="flex justify-center">
                    <ArrowRight className="w-6 h-6 text-muted-foreground" aria-label="مكتمل" />
                  </div>
                );
              }
              return (
                <div className="flex gap-2 items-center justify-center flex-nowrap">
                  <Button
                    size="icon" variant="ghost"
                    className="h-10 w-10 text-success hover:bg-success/10 disabled:opacity-40"
                    title="تسجيل حضور"
                    onClick={() => checkIn(e.id)}
                    disabled={!!a?.check_in}
                  >
                    <LogIn className="w-6 h-6" />
                  </Button>
                  {canUsePresence && (
                    <Button
                      size="icon" variant="ghost"
                      className="h-10 w-10 text-info hover:bg-info/10"
                      title="استخدم وقت أول دخول للسيستم"
                      onClick={() => upsert(e.id, { check_in: p!.last_login_at, status: computeLate(p!.last_login_at!, e) ?? "present" })}
                    >
                      <Zap className="w-6 h-6" />
                    </Button>
                  )}
                  <Button
                    size="icon" variant="ghost"
                    className="h-10 w-10 text-destructive hover:bg-destructive/10 disabled:opacity-40"
                    title="تسجيل انصراف"
                    onClick={() => checkOut(e.id)}
                    disabled={!a?.check_in || !!a?.check_out}
                  >
                    <LogOut className="w-6 h-6" />
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
