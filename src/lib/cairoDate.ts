/**
 * Canonical Cairo day-boundary engine. Every date filter on a timestamp column must use this.
 * Handles Egypt DST (UTC+2 / UTC+3) by resolving the real offset for each day.
 */
const TZ = "Africa/Cairo";

const dayStr = (d: string | Date): string => {
  if (typeof d === "string") return d.slice(0, 10);
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
};

/** Cairo offset in minutes at a given UTC instant. */
function cairoOffsetMin(utcMs: number): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** ISO instant for a Cairo wall-clock time on a given day. */
function cairoInstant(day: string, h: number, m: number, s: number, ms: number): string {
  const [y, mo, d] = day.split("-").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, m, s, ms);
  let off = cairoOffsetMin(naive);
  off = cairoOffsetMin(naive - off * 60000);
  return new Date(naive - off * 60000).toISOString();
}

export function getCairoDayBounds(fromDate?: string | Date | null, toDate?: string | Date | null) {
  return {
    startIso: fromDate ? cairoInstant(dayStr(fromDate), 0, 0, 0, 0) : undefined,
    endIso: toDate ? cairoInstant(dayStr(toDate), 23, 59, 59, 999) : undefined,
  };
}

/** Apply a Cairo day range to a PostgREST builder. `dateOnly` for `date` columns (compare plain days). */
export function applyCairoRange<Q extends { gte: any; lte: any }>(qb: Q, col: string, from?: string | null, to?: string | null, dateOnly = false): Q {
  if (dateOnly) {
    if (from) qb = qb.gte(col, dayStr(from));
    if (to) qb = qb.lte(col, dayStr(to));
    return qb;
  }
  const { startIso, endIso } = getCairoDayBounds(from, to);
  if (startIso) qb = qb.gte(col, startIso);
  if (endIso) qb = qb.lte(col, endIso);
  return qb;
}

/** Client-side check: is an ISO timestamp inside the Cairo day range? */
export function inCairoRange(iso: string | null | undefined, from?: string | null, to?: string | null): boolean {
  if (!iso) return !from && !to;
  const t = new Date(iso).getTime();
  const { startIso, endIso } = getCairoDayBounds(from, to);
  if (startIso && t < new Date(startIso).getTime()) return false;
  if (endIso && t > new Date(endIso).getTime()) return false;
  return true;
}

const cairoDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
/**
 * The Cairo day (YYYY-MM-DD) of an instant («2026-10-01T22:30:00Z» → «2026-10-02»); a plain day stays as it is.
 * "" when the value is not a date.
 */
const dayOfCache = new Map<string, string>();
export function cairoDayOf(v: string | Date): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const key = typeof v === "string" ? v : "";
  if (key) { const hit = dayOfCache.get(key); if (hit !== undefined) return hit; }
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const p = cairoDayFmt.formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const day = `${g("year")}-${g("month")}-${g("day")}`;
  if (key) { if (dayOfCache.size > 20000) dayOfCache.clear(); dayOfCache.set(key, day); }
  return day;
}

/** Today's day (YYYY-MM-DD) in Cairo, independent of the device clock's timezone. */
export const cairoTodayDay = (): string => dayStr(new Date());

/** Shift a YYYY-MM-DD day by n days (calendar arithmetic, no timezone drift). */
export function addDaysDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** First day of the month containing `day`, shifted by `monthOffset` months. */
export function monthStartDay(day: string, monthOffset = 0): string {
  const [y, m] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + monthOffset, 1));
  return t.toISOString().slice(0, 10);
}

/** Cairo midnight of a day as a Date instant. */
export const cairoStart = (day: string) => new Date(getCairoDayBounds(day).startIso!);
/** Cairo 23:59:59.999 of a day as a Date instant. */
export const cairoEnd = (day: string) => new Date(getCairoDayBounds(undefined, day).endIso!);
