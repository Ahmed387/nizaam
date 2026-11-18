/**
 * Period presets of the unified filter (owner 2026-11-18): weeks start on SATURDAY; every choice is its own range;
 * «بداية العام الحالي / السابق» and «نهاية العام السابق» are single days. Cairo days only (never the device timezone).
 */
import { addDaysDay, cairoTodayDay, monthStartDay } from "@/lib/cairoDate";

export type PeriodKey =
  | "today" | "yesterday"
  | "thisWeek" | "lastWeek" | "weekBefore"
  | "thisMonth" | "lastMonth" | "monthBefore"
  | "thisYear" | "lastYear" | "yearBefore"
  | "startThisYear" | "startLastYear" | "endLastYear";

export const PERIOD_PRESETS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "اليوم" },
  { key: "yesterday", label: "الأمس" },
  { key: "thisWeek", label: "الأسبوع الحالي" },
  { key: "lastWeek", label: "الأسبوع السابق" },
  { key: "weekBefore", label: "الأسبوع الأسبق" },
  { key: "thisMonth", label: "الشهر الحالي" },
  { key: "lastMonth", label: "الشهر السابق" },
  { key: "monthBefore", label: "الشهر الأسبق" },
  { key: "thisYear", label: "العام الحالي" },
  { key: "lastYear", label: "العام السابق" },
  { key: "yearBefore", label: "العام الأسبق" },
  { key: "startThisYear", label: "بداية العام الحالي" },
  { key: "startLastYear", label: "بداية العام السابق" },
  { key: "endLastYear", label: "نهاية العام السابق" },
];

/** Saturday on or before the day (0 = Sunday … 6 = Saturday). */
export function weekStartSat(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDaysDay(day, -((dow + 1) % 7));
}

/** The range of a preset; the current week / month / year end today, past ones are full. */
export function periodRange(key: PeriodKey, today: string = cairoTodayDay()): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const ws = weekStartSat(today);
  switch (key) {
    case "today": return { from: today, to: today };
    case "yesterday": { const d = addDaysDay(today, -1); return { from: d, to: d }; }
    case "thisWeek": return { from: ws, to: today };
    case "lastWeek": return { from: addDaysDay(ws, -7), to: addDaysDay(ws, -1) };
    case "weekBefore": return { from: addDaysDay(ws, -14), to: addDaysDay(ws, -8) };
    case "thisMonth": return { from: monthStartDay(today), to: today };
    case "lastMonth": return { from: monthStartDay(today, -1), to: addDaysDay(monthStartDay(today), -1) };
    case "monthBefore": return { from: monthStartDay(today, -2), to: addDaysDay(monthStartDay(today, -1), -1) };
    case "thisYear": return { from: `${y}-01-01`, to: today };
    case "lastYear": return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case "yearBefore": return { from: `${y - 2}-01-01`, to: `${y - 2}-12-31` };
    case "startThisYear": return { from: `${y}-01-01`, to: `${y}-01-01` };
    case "startLastYear": return { from: `${y - 1}-01-01`, to: `${y - 1}-01-01` };
    case "endLastYear": return { from: `${y - 1}-12-31`, to: `${y - 1}-12-31` };
  }
}

/** Which preset (if any) a from / to pair is — for showing it as chosen. */
export function presetOf(from: string, to: string, today: string = cairoTodayDay()): PeriodKey | null {
  if (!from || !to) return null;
  return PERIOD_PRESETS.find((p) => { const r = periodRange(p.key, today); return r.from === from && r.to === to; })?.key ?? null;
}
