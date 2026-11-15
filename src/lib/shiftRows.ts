// «سجل الورديات» table shapes (owner 2026-11-15 «هل ده منظر منسق ومرتب؟» → «نفذ», migration 0224). Pure, tested.
export interface ShiftRowLike {
  status: string;
  opening_cash: number;
  cash_sales: number | null;
  expected_cash: number | null;
  closing_cash: number | null;
  variance: number | null;
  reported_opening_cash?: number | null;
  expected_opening_cash?: number | null;
}
export interface LiveFigures { cash_sales: number; cash_movement: number | null; expected_cash: number }

/** «14/11 — 3:25 م» in Cairo time; the full date + year goes in the tooltip (`fullDateTime`). */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { timeZone: "Africa/Cairo", day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("ar-EG", { timeZone: "Africa/Cairo", hour: "numeric", minute: "2-digit" });
  return `${day} — ${time}`;
}
export function fullDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "full", timeStyle: "short" });
}

/** What the cashier counted at the opening minus what the system expected; null when nothing was counted. */
export function openingDiff(r: Pick<ShiftRowLike, "reported_opening_cash" | "expected_opening_cash" | "opening_cash">): number | null {
  if (r.reported_opening_cash == null) return null;
  return Math.round((Number(r.reported_opening_cash) - Number(r.expected_opening_cash ?? 0)) * 100) / 100;
}

/** The numbers a row shows: a closed shift its stored ones; an open shift the live ones (no «فعلي» / «الفرق» yet). */
export function shiftFigures(r: ShiftRowLike, live?: LiveFigures | null) {
  if (r.status === "open") {
    return {
      live: true,
      cash_sales: live ? Number(live.cash_sales) : null,
      expected_cash: live ? Number(live.expected_cash) : null,
      closing_cash: null as number | null,
      variance: null as number | null,
    };
  }
  return { live: false, cash_sales: r.cash_sales, expected_cash: r.expected_cash, closing_cash: r.closing_cash, variance: r.variance };
}

/** Totals of the CLOSED shifts only — an open shift has no actual cash or difference yet. */
export function closedTotals(rows: ShiftRowLike[]) {
  const closed = rows.filter((r) => r.status !== "open");
  const sum = (f: (r: ShiftRowLike) => number | null | undefined) => Math.round(closed.reduce((s, r) => s + Number(f(r) ?? 0), 0) * 100) / 100;
  return {
    count: closed.length,
    open: rows.length - closed.length,
    opening_cash: sum((r) => r.opening_cash),
    opening_diff: sum((r) => openingDiff(r) ?? 0),
    cash_sales: sum((r) => r.cash_sales),
    expected_cash: sum((r) => r.expected_cash),
    closing_cash: sum((r) => r.closing_cash),
    variance: sum((r) => r.variance),
  };
}
