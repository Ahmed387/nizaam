/**
 * Salaries, employee advances and partner movements are cancel-only (migration 0138): a wrong one is cancelled and
 * made again. These helpers decide which button a screen shows; the server checks the same rules again.
 */
export type AdvanceRow = { amount: number | string; remaining: number | string; status?: string | null };

/** An advance can be cancelled by the owner / manager while nothing of it was deducted from a salary yet. */
export function canCancelAdvance(a: AdvanceRow | null | undefined, isAdmin: boolean): boolean {
  if (!a || !isAdmin || a.status === "cancelled") return false;
  return Math.round(Number(a.remaining) * 100) >= Math.round(Number(a.amount) * 100);
}

/** What is still owed on the employee's advances (cancelled ones carry 0). */
export function advancesOwed(rows: AdvanceRow[] | null | undefined): number {
  return (rows ?? []).filter((r) => r.status !== "cancelled").reduce((s, r) => s + (Number(r.remaining) || 0), 0);
}
