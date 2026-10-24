import { useCallback, useEffect, useMemo, useState } from "react";
import { PermTable } from "@/components/PermTable";
import { ChevronRight, ChevronLeft, Wallet, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaySalaryDialog, AdjustmentDialog } from "@/components/payroll/SalaryDialogs";
import { EmployeeLink } from "@/components/employees/EmployeeLink";
import { Checkbox } from "@/components/ui/checkbox";
import { isWorkDay } from "@/components/ShiftEditor";
import { cairoTodayDay } from "@/lib/cairoDate";
import { formatEGP } from "@/lib/format";
import { toast } from "sonner";

/** Day kinds the owner can record for an employee. */
export type DayKind = "present" | "absent" | "leave" | "half_day" | "hourly";
export const KINDS: { key: DayKind; label: string; short: string; cls: string }[] = [
  { key: "present", label: "حضر", short: "ح", cls: "bg-success text-success-foreground" },
  { key: "absent", label: "غاب", short: "غ", cls: "bg-destructive text-destructive-foreground" },
  { key: "leave", label: "إجازة", short: "إ", cls: "bg-info text-info-foreground" },
  { key: "half_day", label: "نص يوم", short: "½", cls: "bg-warning text-warning-foreground" },
  { key: "hourly", label: "بالساعة", short: "س", cls: "bg-primary text-primary-foreground" },
];
export const kindOf = (status?: string | null): DayKind | null =>
  status === "late" ? "present" : (KINDS.some((k) => k.key === status) ? (status as DayKind) : null);

export const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const pad = (n: number) => String(n).padStart(2, "0");
export const daysIn = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const shiftHours = (e: any) => {
  if (!e?.work_start || !e?.work_end) return 8;
  const [h1, m1] = String(e.work_start).split(":").map(Number);
  const [h2, m2] = String(e.work_end).split(":").map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins <= 0) mins += 24 * 60;
  return Math.max(1, Math.round((mins / 60) * 100) / 100);
};

export interface PayrollLine {
  employee: any;
  workDays: number;
  paidUnits: number;
  counts: Record<DayKind | "unrecorded", number>;
  dailyRate: number;
  attendanceDeduction: number;
  attendanceAmount: number;
}

/** Monthly salary from attendance (display only — the server's `employee_salary_preview` decides when paying).
 *  Leave is a status and is paid; only recorded absence, and the unworked part of a half / hourly day, is deducted.
 *  A working day with nothing recorded is a normal paid day. */
export function computePayroll(emp: any, ym: string, att: any[], today: string): PayrollLine {
  const dim = daysIn(ym);
  const counts: PayrollLine["counts"] = { present: 0, absent: 0, leave: 0, half_day: 0, hourly: 0, unrecorded: 0 };
  const byDate = new Map(att.filter((a) => a.employee_id === emp.id).map((a) => [a.date, a]));
  const hrs = shiftHours(emp);
  let workDays = 0, paid = 0;
  for (let d = 1; d <= dim; d++) {
    const date = `${ym}-${pad(d)}`;
    const a = byDate.get(date);
    const k = kindOf(a?.status);
    const working = isWorkDay(date, emp.work_days);
    if (!working && !k) continue;
    if (working) workDays++;
    if (!k) {                                    // no record = a normal paid day (same rule as employee_salary_preview)
      if (date <= today) counts.unrecorded++;
      paid += 1; continue;
    }
    counts[k]++;
    if (k === "present" || k === "leave") paid += 1;
    else if (k === "half_day") paid += 0.5;
    else if (k === "hourly") paid += Math.min(1, Number(a?.hours || 0) / hrs);
  }
  const base = Number(emp.base_salary) || 0;
  const dailyRate = workDays > 0 ? base / workDays : 0;
  const attendanceAmount = Math.max(0, Math.min(base, Math.round(dailyRate * Math.min(paid, workDays))));
  return { employee: emp, workDays, paidUnits: Math.round(paid * 100) / 100, counts, dailyRate, attendanceDeduction: base - attendanceAmount, attendanceAmount };
}

export function AttendanceBoard({ branchId, canEdit }: { branchId: string; canEdit: (emp: any) => boolean }) {
  const { tenant, user, isAdmin } = useAuth();
  const today = cairoTodayDay();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [day, setDay] = useState(today);
  const [employees, setEmployees] = useState<any[]>([]);
  const [att, setAtt] = useState<any[]>([]);
  const [paid, setPaid] = useState<Record<string, any>>({});
  const [advDue, setAdvDue] = useState<Record<string, { due: number; remaining: number }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [adj, setAdj] = useState<Record<string, { bonus: number; penalty: number }>>({});
  const [adjFor, setAdjFor] = useState<any | null>(null);
  // bulk marking: several days × several employees at once
  const [multi, setMulti] = useState(false);
  const [selDays, setSelDays] = useState<Set<string>>(new Set());
  const [selEmps, setSelEmps] = useState<Set<string>>(new Set());
  const [bulkHours, setBulkHours] = useState("4");
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    const start = `${ym}-01`, end = `${ym}-${pad(daysIn(ym))}`;
    const [{ data: emps }, { data: a }] = await Promise.all([
      supabase.from("employees").select("id,name,job_title,role,base_salary,work_start,work_end,work_days,branch_id,user_id").eq("branch_id", branchId).eq("is_active", true).order("name"),
      supabase.from("attendance").select("id,employee_id,date,status,hours,check_in,check_out").eq("branch_id", branchId).gte("date", start).lte("date", end),
    ]);
    const list = emps ?? [];
    setEmployees(list);
    setAtt(a ?? []);
    const ids = list.map((e: any) => e.id);
    if (ids.length) {
      const { data: sal } = await (supabase.from("salaries") as any).select("id,employee_id,net_salary,bonuses,deductions,advance_deduct").eq("month", ym).eq("status" as any, "active").in("employee_id", ids);
      setPaid(Object.fromEntries((sal ?? []).map((s: any) => [s.employee_id, s])));
      const dues = await Promise.all(ids.map(async (id: string) => {
        const { data } = await supabase.rpc("employee_advance_due" as any, { p_employee_id: id } as any);
        return [id, { due: Number((data as any)?.due ?? 0), remaining: Number((data as any)?.remaining ?? 0) }] as const;
      }));
      setAdvDue(Object.fromEntries(dues));
      const { data: ad } = await (supabase.from("employee_adjustments" as any) as any)
        .select("employee_id,kind,amount").eq("month", ym).eq("status", "active").in("employee_id", ids);
      const m: Record<string, { bonus: number; penalty: number }> = {};
      for (const r of (ad ?? []) as any[]) {
        const x = (m[r.employee_id] ??= { bonus: 0, penalty: 0 });
        if (r.kind === "bonus") x.bonus += Number(r.amount) || 0; else x.penalty += Number(r.amount) || 0;
      }
      setAdj(m);
    } else { setPaid({}); setAdvDue({}); setAdj({}); }
  }, [branchId, ym]);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh(["attendance", "employees", "salaries", "advances", "employee_adjustments"], load);
  // selections belong to the month on screen
  useEffect(() => { setSelDays(new Set()); }, [ym]);

  const dayRows = useMemo(() => new Map(att.filter((a) => a.date === day).map((a) => [a.employee_id, a])), [att, day]);

  const setKind = async (emp: any, kind: DayKind, hours?: number) => {
    if (!canEdit(emp)) return toast.error("مش مسموح لك تعدّل حضور الموظف ده");
    if (day > today) return toast.error("مينفعش تسجّل حضور ليوم لسه مجاش");
    setBusy(emp.id);
    const patch: any = { status: kind, hours: kind === "hourly" ? (hours ?? (Number(dayRows.get(emp.id)?.hours) || 4)) : null };
    const existing = dayRows.get(emp.id);
    const { error } = existing
      ? await supabase.from("attendance").update(patch).eq("id", existing.id)
      : await supabase.from("attendance").insert({ branch_id: branchId, tenant_id: tenant?.id ?? null, employee_id: emp.id, employee_name: emp.name, date: day, created_by: user?.id ?? null, ...patch });
    setBusy(null);
    if (error) return toast.error(error.message);
    load();
  };

  /** Bulk: every selected employee on every selected day (or the open day) gets the same status. */
  const targetDays = multi ? [...selDays].sort() : [day];
  const applyBulk = async (kind: DayKind) => {
    const days = targetDays.filter((d) => d <= today);
    const emps = employees.filter((e) => selEmps.has(e.id));
    if (!emps.length) return toast.error("اختار موظف واحد على الأقل");
    if (!days.length) return toast.error(targetDays.length ? "مينفعش تسجّل حضور لأيام لسه مجتش" : "اختار يوم واحد على الأقل من الكالندر");
    const allowed = emps.filter((e) => canEdit(e));
    if (!allowed.length) return toast.error("مش مسموح لك تعدّل حضور الموظفين دول");
    const hours = kind === "hourly" ? Math.max(0, Math.min(24, Number(bulkHours) || 0)) : null;
    if (kind === "hourly" && !hours) return toast.error("اكتب عدد الساعات");
    const existing = new Map(att.map((a) => [`${a.employee_id}|${a.date}`, a]));
    const updIds: string[] = [];
    const inserts: any[] = [];
    for (const e of allowed) for (const d of days) {
      const ex = existing.get(`${e.id}|${d}`);
      if (ex) updIds.push(ex.id);
      else inserts.push({ branch_id: branchId, tenant_id: tenant?.id ?? null, employee_id: e.id, employee_name: e.name, date: d,
        created_by: user?.id ?? null, status: kind, hours });
    }
    setBulkBusy(true);
    try {
      for (let i = 0; i < updIds.length; i += 200) {
        const { error } = await supabase.from("attendance").update({ status: kind, hours } as any).in("id", updIds.slice(i, i + 200));
        if (error) throw error;
      }
      for (let i = 0; i < inserts.length; i += 500) {
        const { error } = await supabase.from("attendance").insert(inserts.slice(i, i + 500));
        if (error) throw error;
      }
      const label = KINDS.find((k) => k.key === kind)?.label ?? kind;
      const skipped = (emps.length - allowed.length) + (targetDays.length - days.length);
      toast.success(`اتسجل «${label}» لـ ${allowed.length} موظف × ${days.length} يوم${skipped ? ` (اتخطى ${skipped} — مش مسموح أو أيام لسه مجتش)` : ""}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBulkBusy(false);
      load();
    }
  };
  const toggleDay = (d: string) => setSelDays((p) => { const n = new Set(p); n.has(d) ? n.delete(d) : n.add(d); return n; });
  const toggleEmp = (id: string) => setSelEmps((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectWorkDaysToToday = () => {
    const n = new Set<string>();
    for (let i = 1; i <= daysIn(ym); i++) { const d = `${ym}-${pad(i)}`; if (d <= today) n.add(d); }
    setSelDays(n);
  };

  // calendar
  const first = new Date(`${ym}-01T00:00:00`).getDay();
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: daysIn(ym) }, (_, i) => `${ym}-${pad(i + 1)}`)];
  const dayStats = (date: string) => {
    const s = { present: 0, absent: 0, leave: 0, half_day: 0, hourly: 0 } as Record<DayKind, number>;
    for (const a of att) if (a.date === date) { const k = kindOf(a.status); if (k) s[k]++; }
    return s;
  };
  const moveMonth = (delta: number) => {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const next = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    setYm(next);
    setDay(next === today.slice(0, 7) ? today : `${next}-01`);
  };

  const payroll = useMemo(() => employees.map((e) => computePayroll(e, ym, att, today)), [employees, ym, att, today]);
  const [payFor, setPayFor] = useState<PayrollLine | null>(null);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(360px,1fr)_minmax(0,1.4fr)]">
        {/* Big calendar */}
        <div className="card-elevated p-4">
          <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
            <Button size="sm" variant={multi ? "default" : "outline"} onClick={() => { setMulti((v) => !v); setSelDays(new Set(multi ? [] : [day])); }}>
              {multi ? "✓ تحديد أكتر من يوم" : "تحديد أكتر من يوم"}
            </Button>
            {multi && <>
              <Button size="sm" variant="ghost" onClick={selectWorkDaysToToday}>كل الشهر لحد النهارده</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelDays(new Set())}>مسح</Button>
              <span className="text-muted-foreground">متحدد {selDays.size} يوم</span>
            </>}
          </div>
          <div className="flex items-center justify-between mb-3">
            <Button variant="ghost" size="icon" onClick={() => moveMonth(-1)} aria-label="الشهر السابق"><ChevronRight className="w-5 h-5" /></Button>
            <div className="font-extrabold text-lg">{new Date(`${ym}-01T00:00:00`).toLocaleDateString("ar-EG", { month: "long", year: "numeric" })}</div>
            <Button variant="ghost" size="icon" onClick={() => moveMonth(1)} aria-label="الشهر التالي"><ChevronLeft className="w-5 h-5" /></Button>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center">
            {WEEKDAYS.map((w) => <div key={w} className="text-[11px] font-bold text-muted-foreground py-1">{w}</div>)}
            {cells.map((date, i) => {
              if (!date) return <div key={`b${i}`} />;
              const s = dayStats(date);
              const sel = multi ? selDays.has(date) : date === day;
              const future = date > today;
              return (
                <button key={date} type="button" onClick={() => { if (multi) { if (!future) toggleDay(date); } else setDay(date); }}
                  className={`min-h-[64px] rounded-lg border p-1.5 text-right flex flex-col justify-between transition-colors ${sel ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "border-border hover:border-primary/40"} ${future ? "opacity-50" : ""} ${date === today ? "font-extrabold" : ""}`}>
                  <span className="text-sm tabular-nums">{Number(date.slice(8))}</span>
                  <span className="flex flex-wrap gap-0.5 justify-end">
                    {KINDS.filter((k) => s[k.key] > 0).map((k) => (
                      <span key={k.key} title={`${k.label}: ${s[k.key]}`} className={`text-[10px] leading-none rounded px-1 py-0.5 ${k.cls}`}>{k.short}{s[k.key]}</span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 mt-3 text-[11px]">
            {KINDS.map((k) => <span key={k.key} className="flex items-center gap-1"><span className={`rounded px-1 ${k.cls}`}>{k.short}</span>{k.label}</span>)}
          </div>
        </div>

        {/* Employees of the selected day */}
        <div className="card-elevated p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-extrabold">{multi
              ? `تسجيل جماعي — ${selDays.size} يوم`
              : `حضور يوم ${new Date(`${day}T00:00:00`).toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" })}`}</div>
            <span className="text-xs text-muted-foreground">{multi ? "علّم على الموظفين وبعدين اختار الحالة تحت" : "اختار الحالة لكل موظف — أو علّم على أكتر من موظف وطبّق مرة واحدة"}</span>
          </div>
          {employees.length > 0 && (
            <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-2 flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer font-bold">
                <Checkbox checked={selEmps.size > 0 && selEmps.size === employees.length}
                  onCheckedChange={(v) => setSelEmps(v ? new Set(employees.map((e) => e.id)) : new Set())} />
                الكل
              </label>
              <span className="text-muted-foreground">{selEmps.size} موظف × {targetDays.filter((d) => d <= today).length} يوم:</span>
              {KINDS.map((kk) => (
                <button key={kk.key} type="button" disabled={bulkBusy || !selEmps.size} onClick={() => applyBulk(kk.key)}
                  className={`px-2.5 py-1 rounded-md font-bold disabled:opacity-40 ${kk.cls}`}>{kk.label}</button>
              ))}
              <Input type="number" min={0} max={24} step={0.5} value={bulkHours} onChange={(e) => setBulkHours(e.target.value)}
                className="h-7 w-16 text-center" title="عدد الساعات لحالة «بالساعة»" />
              <span className="text-muted-foreground">ساعة</span>
            </div>
          )}
          <div className="space-y-2">
            {employees.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">لا يوجد موظفين في الفرع</div>}
            {employees.map((e) => {
              const a = dayRows.get(e.id);
              const k = kindOf(a?.status);
              const off = !isWorkDay(day, e.work_days);
              const editable = canEdit(e) && day <= today;
              return (
                <div key={e.id} className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 ${selEmps.has(e.id) ? "border-primary bg-primary/5" : "border-border"}`}>
                  <Checkbox checked={selEmps.has(e.id)} onCheckedChange={() => toggleEmp(e.id)} aria-label={`تحديد ${e.name}`} />
                  <div className="min-w-[140px] flex-1">
                    <div><EmployeeLink id={e.id} name={e.name} /></div>
                    <div className="text-[11px] text-muted-foreground">{e.job_title ?? ""}{off ? " • يوم إجازته الأسبوعية" : ""}{a?.check_in ? ` • دخل ${new Date(a.check_in).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}` : ""}</div>
                  </div>
                  {!multi && <div className="flex flex-wrap gap-1">
                    {KINDS.map((kk) => (
                      <button key={kk.key} type="button" disabled={!editable || busy === e.id} onClick={() => setKind(e, kk.key)}
                        className={`px-2.5 py-1 rounded-md text-xs font-bold border transition-colors disabled:opacity-50 ${k === kk.key ? `${kk.cls} border-transparent` : "border-border hover:border-primary/50"}`}>
                        {kk.label}
                      </button>
                    ))}
                  </div>}
                  {!multi && k === "hourly" && (
                    <div className="flex items-center gap-1">
                      <Input type="number" min={0} max={24} step={0.5} defaultValue={a?.hours ?? 4} disabled={!editable}
                        className="h-8 w-20 text-center" onBlur={(ev) => { const h = Number(ev.target.value); if (h !== Number(a?.hours)) setKind(e, "hourly", h); }} />
                      <span className="text-xs text-muted-foreground">ساعة من {shiftHours(e)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Payroll of the month */}
      <div className="card-elevated overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
          <div className="font-extrabold">مرتبات شهر {ym}</div>
          <div className="text-xs text-muted-foreground">المرتب محسوب من الحضور تلقائياً: الإجازة مدفوعة، الغياب المسجّل بس هو اللي بيتخصم، ونص اليوم والساعات بنسبتها. اليوم اللي مفيهوش تسجيل بيتحسب يوم عادي. البونص والجزاء المتسجلين على الشهر بيتضافوا / بيتخصموا وقت الصرف، وقسط السلف المستحق إجباري.</div>
        </div>
        <div className="overflow-x-auto">
          <PermTable className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr className="text-xs">
                {["الموظف", "الأساسي", "أيام العمل", "أيام مدفوعة", "غياب", "خصم الحضور", "المستحق بالحضور", "بونص / جزاء", "قسط السلف المستحق", "الصافي المتوقع", ""].map((h) => <th key={h} className="px-2 py-2.5 font-extrabold text-center">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {payroll.map((p) => {
                const due = advDue[p.employee.id]?.due ?? 0;
                const aj = adj[p.employee.id] ?? { bonus: 0, penalty: 0 };
                const gross = p.attendanceAmount + aj.bonus - aj.penalty;
                const advance = Math.min(due, Math.max(0, gross));
                const s = paid[p.employee.id];
                return (
                  <tr key={p.employee.id} className="border-t border-border/60 text-center">
                    <td className="px-2 py-2 text-right"><EmployeeLink id={p.employee.id} name={p.employee.name} /></td>
                    <td className="px-2 py-2 tabular-nums">{formatEGP(p.employee.base_salary)}</td>
                    <td className="px-2 py-2 tabular-nums">{p.workDays}</td>
                    <td className="px-2 py-2 tabular-nums">{p.paidUnits}</td>
                    <td className="px-2 py-2 tabular-nums text-destructive">{p.counts.absent}{p.counts.half_day || p.counts.hourly ? <span className="text-[10px] text-muted-foreground"> +{p.counts.half_day + p.counts.hourly} جزئي</span> : null}</td>
                    <td className="px-2 py-2 tabular-nums text-destructive">{formatEGP(p.attendanceDeduction)}</td>
                    <td className="px-2 py-2 tabular-nums font-bold">{formatEGP(p.attendanceAmount)}</td>
                    <td className="px-2 py-2 tabular-nums">
                      <button type="button" disabled={!!s || (!isAdmin && !canEdit(p.employee))} onClick={() => setAdjFor(p.employee)}
                        className="rounded px-1.5 py-0.5 hover:bg-surface-2 disabled:cursor-default" title="تسجيل بونص / جزاء">
                        <span className="text-success">+{formatEGP(aj.bonus)}</span> / <span className="text-destructive">−{formatEGP(aj.penalty)}</span>
                      </button>
                    </td>
                    <td className="px-2 py-2 tabular-nums text-warning">{formatEGP(advance)}</td>
                    <td className="px-2 py-2 tabular-nums font-extrabold text-primary">{formatEGP(gross - advance)}</td>
                    <td className="px-2 py-2">
                      {s ? <span className="inline-flex items-center gap-1 text-success text-xs font-bold"><CheckCircle2 className="w-4 h-4" /> اتصرف {formatEGP(s.net_salary)}</span>
                        : <Button size="sm" className="gap-1" disabled={!isAdmin && !canEdit(p.employee)} onClick={() => setPayFor(p)}><Wallet className="w-4 h-4" /> صرف</Button>}
                    </td>
                  </tr>
                );
              })}
              {payroll.length === 0 && <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">لا يوجد موظفين</td></tr>}
            </tbody>
          </PermTable>
        </div>
      </div>

      {adjFor && (
        <AdjustmentDialog employee={adjFor} onClose={() => setAdjFor(null)} onDone={() => { setAdjFor(null); load(); }} />
      )}
      {payFor && (
        <PaySalaryDialog employee={payFor.employee} month={ym}
          onClose={() => setPayFor(null)} onDone={() => { setPayFor(null); load(); }} />
      )}
    </div>
  );
}
