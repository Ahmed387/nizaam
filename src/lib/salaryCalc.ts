import { supabase } from "@/integrations/supabase/client";
import { isWorkDay } from "@/components/ShiftEditor";

export type AttendanceSummary = {
  workDaysInMonth: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  leaveDays: number;
  totalLateMinutes: number;
  dailyRate: number;
  absentDeduction: number;
  lateDeduction: number;
  totalDeduction: number;
};

const SHIFT_MINUTES = 8 * 60;

function daysInMonth(year: number, month0: number) {
  return new Date(year, month0 + 1, 0).getDate();
}

export async function summarizeMonth(
  employee: { id: string; base_salary: number | string; work_days?: any; work_start?: string | null; late_grace_minutes?: number | null },
  monthKey: string, // YYYY-MM
): Promise<AttendanceSummary> {
  const [yStr, mStr] = monthKey.split("-");
  const year = Number(yStr);
  const month0 = Number(mStr) - 1;
  const dim = daysInMonth(year, month0);

  // Count work days in month
  let workDays = 0;
  for (let d = 1; d <= dim; d++) {
    const date = `${monthKey}-${String(d).padStart(2, "0")}`;
    if (isWorkDay(date, employee.work_days)) workDays++;
  }

  const start = `${monthKey}-01`;
  const end = `${monthKey}-${String(dim).padStart(2, "0")}`;
  const { data: rows } = await supabase
    .from("attendance")
    .select("date,status,check_in")
    .eq("employee_id", employee.id)
    .gte("date", start)
    .lte("date", end);

  let present = 0, late = 0, leave = 0, lateMinutes = 0;
  for (const r of rows ?? []) {
    if (r.status === "leave") { leave++; continue; }
    if (r.status === "present") present++;
    if (r.status === "late") {
      late++; present++;
      if (r.check_in && employee.work_start) {
        const [h, m] = employee.work_start.split(":").map(Number);
        const expected = new Date(r.date);
        expected.setHours(h, m, 0, 0);
        const actual = new Date(r.check_in);
        const grace = Number(employee.late_grace_minutes ?? 0);
        const diff = Math.max(0, Math.round((actual.getTime() - expected.getTime()) / 60000) - grace);
        lateMinutes += diff;
      }
    }
  }
  const absent = Math.max(0, workDays - present - leave);
  const base = Number(employee.base_salary) || 0;
  const dailyRate = workDays > 0 ? base / workDays : 0;
  const absentDeduction = Math.round(absent * dailyRate);
  const lateDeduction = Math.round((lateMinutes / SHIFT_MINUTES) * dailyRate);
  return {
    workDaysInMonth: workDays,
    presentDays: present,
    lateDays: late,
    absentDays: absent,
    leaveDays: leave,
    totalLateMinutes: lateMinutes,
    dailyRate,
    absentDeduction,
    lateDeduction,
    totalDeduction: absentDeduction + lateDeduction,
  };
}
