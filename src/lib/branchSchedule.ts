import { supabase } from "@/integrations/supabase/client";
import { cairoTodayDay } from "@/lib/cairoDate";

export interface BranchSchedule {
  id?: string;
  tenant_id?: string;
  branch_id: string;
  open_time: string | null;
  close_time: string | null;
  close_grace_minutes: number;
  weekly_off: number[];
  reminder_hours: number;
  auto_close_hours: number;
  pre_close_warn_minutes: number;
  block_open_on_off_day: boolean;
}

export interface BranchClosure {
  id: string;
  branch_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
}

export const defaultSchedule = (branch_id: string): BranchSchedule => ({
  branch_id,
  open_time: null,
  close_time: null,
  close_grace_minutes: 60,
  weekly_off: [],
  reminder_hours: 12,
  auto_close_hours: 16,
  pre_close_warn_minutes: 30,
  block_open_on_off_day: false,
});

export const WEEK_DAYS = [
  { v: 6, label: "السبت" },
  { v: 0, label: "الأحد" },
  { v: 1, label: "الإثنين" },
  { v: 2, label: "الثلاثاء" },
  { v: 3, label: "الأربعاء" },
  { v: 4, label: "الخميس" },
  { v: 5, label: "الجمعة" },
];

export async function fetchSchedules(): Promise<Record<string, BranchSchedule>> {
  const { data } = await supabase.from("branch_schedules" as any).select("*");
  const out: Record<string, BranchSchedule> = {};
  for (const r of (data ?? []) as any[]) out[r.branch_id] = r as BranchSchedule;
  return out;
}

export async function fetchClosures(branchId?: string): Promise<BranchClosure[]> {
  let q = supabase.from("branch_closures" as any).select("*").order("start_date", { ascending: false });
  if (branchId) q = q.eq("branch_id", branchId);
  const { data } = await q;
  return ((data ?? []) as any[]) as BranchClosure[];
}

const todayStr = () => cairoTodayDay();

/** Why is the branch closed today (weekly off / exceptional closure)? null = open. */
export function offDayReason(schedule: BranchSchedule | undefined, closures: BranchClosure[], date = todayStr()): string | null {
  const closure = closures.find((c) => c.branch_id === (schedule?.branch_id ?? c.branch_id) && date >= c.start_date && date <= c.end_date);
  if (closure) return `إغلاق استثنائي${closure.reason ? `: ${closure.reason}` : ""}`;
  if (schedule?.weekly_off?.length) {
    const dow = new Date(date + "T00:00:00").getDay();
    if (schedule.weekly_off.includes(dow)) {
      return `إجازة أسبوعية (${WEEK_DAYS.find((d) => d.v === dow)?.label ?? ""})`;
    }
  }
  return null;
}

/** Minutes remaining until the branch close time (negative = already past). null if no close time. */
export function minutesToClose(closeTime: string | null | undefined, now = new Date()): number | null {
  if (!closeTime) return null;
  const [h, m] = closeTime.split(":").map(Number);
  const close = new Date(now);
  close.setHours(h, m, 0, 0);
  return Math.round((close.getTime() - now.getTime()) / 60000);
}

export function hoursOpen(openedAt: string, now = new Date()): number {
  return (now.getTime() - new Date(openedAt).getTime()) / 3_600_000;
}

/** Number of actual working days in [from,to] after removing weekly off-days and exceptional closures. */
export function countWorkingDays(
  schedule: BranchSchedule | undefined,
  closures: BranchClosure[],
  from: string,
  to: string,
): number {
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 0;
  let n = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (!offDayReason(schedule, closures, iso)) n += 1;
  }
  return n;
}
