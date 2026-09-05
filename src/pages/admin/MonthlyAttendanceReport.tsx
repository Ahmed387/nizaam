import { useEffect, useMemo, useState } from "react";
import { ConditionalLayout } from "@/components/layout/ConditionalLayout";
import { DataTable } from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatHours } from "@/lib/attendanceHours";
import { isWorkDay } from "@/components/ShiftEditor";

/**
 * تقرير الحضور الشهري المجمّع (عرض فقط).
 * فلاتره منفصلة تماماً عن فلاتر شاشة الحضور اليومي، ولا ينشئ أي قيود أو حركات مالية.
 */

function daysInMonth(year: number, month0: number) {
  return new Date(year, month0 + 1, 0).getDate();
}

function lateMinutesOf(row: any, emp: any): number {
  if (row.status !== "late" || !row.check_in || !emp?.work_start) return 0;
  const [h, m] = String(emp.work_start).split(":").map(Number);
  const expected = new Date(row.date);
  expected.setHours(h || 0, m || 0, 0, 0);
  const grace = Number(emp.late_grace_minutes ?? 0);
  const diff = Math.round((new Date(row.check_in).getTime() - expected.getTime()) / 60000) - grace;
  return Math.max(0, diff);
}

export default function MonthlyAttendanceReport({ embedded = false }: { embedded?: boolean } = {}) {
  const { branches } = useAuth();
  // فلتر مستقل بالكامل عن شاشة الحضور اليومي
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [branchId, setBranchId] = useState<string>("all");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [yStr, mStr] = month.split("-");
      const dim = daysInMonth(Number(yStr), Number(mStr) - 1);
      const start = `${month}-01`;
      const end = `${month}-${String(dim).padStart(2, "0")}`;

      let empQ = supabase
        .from("employees")
        .select("id,name,branch_id,is_active,work_days,work_start,late_grace_minutes")
        .eq("is_active", true);
      let attQ = supabase
        .from("attendance")
        .select("employee_id,branch_id,date,status,check_in,check_out")
        .gte("date", start)
        .lte("date", end);
      if (branchId !== "all") {
        empQ = empQ.eq("branch_id", branchId);
        attQ = attQ.eq("branch_id", branchId);
      }
      // استعلامان فقط للشهر كله (تجميع محلي) لتفادي أي حمل زائد على قاعدة البيانات
      const [{ data: emps }, { data: att }] = await Promise.all([empQ, attQ]);
      if (cancelled) return;

      const nameById = new Map(branches.map((b) => [b.id, b.name]));
      const byEmp = new Map<string, any[]>();
      for (const r of (att ?? []) as any[]) {
        const list = byEmp.get(r.employee_id) ?? [];
        list.push(r);
        byEmp.set(r.employee_id, list);
      }

      const result = (emps ?? []).map((e: any) => {
        const list = byEmp.get(e.id) ?? [];
        let present = 0, late = 0, leave = 0, lateMin = 0, workedMin = 0;
        for (const r of list) {
          if (r.status === "leave") { leave++; continue; }
          if (r.status === "present" || r.status === "late") present++;
          if (r.status === "late") { late++; lateMin += lateMinutesOf(r, e); }
          if (r.check_in && r.check_out) {
            const d = Math.round((new Date(r.check_out).getTime() - new Date(r.check_in).getTime()) / 60000);
            if (d > 0) workedMin += d;
          }
        }
        let workDays = 0;
        for (let d = 1; d <= dim; d++) {
          if (isWorkDay(`${month}-${String(d).padStart(2, "0")}`, e.work_days)) workDays++;
        }
        return {
          id: e.id,
          name: e.name,
          branch_name: nameById.get(e.branch_id) ?? "—",
          work_days: workDays,
          present_days: present,
          leave_days: leave,
          absent_days: Math.max(0, workDays - present - leave),
          late_days: late,
          late_minutes: lateMin,
          worked_minutes: workedMin,
        };
      });
      setRows(result);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [month, branchId, branches]);

  const totals = useMemo(() => ({
    present: rows.reduce((s, r) => s + r.present_days, 0),
    absent: rows.reduce((s, r) => s + r.absent_days, 0),
    lateMin: rows.reduce((s, r) => s + r.late_minutes, 0),
  }), [rows]);

  const actions = (
    <div className="flex gap-2">
      <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
      <Select value={branchId} onValueChange={setBranchId}>
        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">كل الفروع</SelectItem>
          {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <ConditionalLayout
      embedded={embedded}
      variant="admin"
      title="التقرير الشهري للحضور"
      subtitle={`حضور ${totals.present} يوم • غياب ${totals.absent} يوم • تأخير ${formatHours(totals.lateMin)}`}
      actions={actions}
    >
      <DataTable
        loading={loading}
        rows={rows}
        empty="لا توجد بيانات لهذا الشهر"
        columns={[
          { key: "name", header: "الموظف", align: "center", render: (r: any) => <span className="font-semibold">{r.name}</span> },
          { key: "branch_name", header: "الفرع", align: "center" },
          { key: "work_days", header: "أيام العمل", align: "center", numeric: true },
          { key: "present_days", header: "أيام الحضور", align: "center", numeric: true, render: (r: any) => <span className="text-success font-semibold tabular-nums">{r.present_days}</span> },
          { key: "absent_days", header: "أيام الغياب", align: "center", numeric: true, render: (r: any) => <span className={r.absent_days > 0 ? "text-destructive font-semibold tabular-nums" : "tabular-nums"}>{r.absent_days}</span> },
          { key: "leave_days", header: "إجازات", align: "center", numeric: true },
          { key: "late_days", header: "مرات التأخير", align: "center", numeric: true },
          { key: "late_minutes", header: "إجمالي التأخير", align: "center", render: (r: any) => <span dir="ltr" className="tabular-nums">{formatHours(r.late_minutes)}</span> },
          { key: "worked_minutes", header: "ساعات العمل", align: "center", render: (r: any) => <span dir="ltr" className="tabular-nums">{formatHours(r.worked_minutes)}</span> },
        ]}
      />
    </ConditionalLayout>
  );
}
