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
