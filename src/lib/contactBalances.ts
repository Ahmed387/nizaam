// TODO Phase 2.2B: Remove after contacts.balance column is dropped
// Central helper for reading contact balances from the canonical view
// `v_contact_balances` instead of the legacy stored column `contacts.balance`.
// The column still exists during Phase 2.2A — do NOT rely on it for reads.
import { supabase } from "@/integrations/supabase/client";

export interface ContactBalanceRow {
  contact_id: string;
  total_balance: number;
  ledger_balance: number;
  credit_balance: number;
  overdue_amount: number;
  last_transaction_date: string | null;
}

/** Fetch a single contact's live balance from v_contact_balances. */
export async function fetchContactBalance(id: string | null | undefined): Promise<number> {
  if (!id) return 0;
  const { data } = await supabase
    .from("v_contact_balances" as any)
    .select("total_balance")
    .eq("contact_id", id)
    .maybeSingle();
  return Number((data as any)?.total_balance ?? 0);
}

/** Fetch a map of contact_id → total_balance for a list of ids. */
export async function fetchContactBalanceMap(
  ids: (string | null | undefined)[],
): Promise<Record<string, number>> {
  const clean = Array.from(new Set(ids.filter(Boolean) as string[]));
  if (!clean.length) return {};
  const { data } = await supabase
    .from("v_contact_balances" as any)
    .select("contact_id, total_balance")
    .in("contact_id", clean);
  const m: Record<string, number> = {};
  (data ?? []).forEach((r: any) => {
    m[r.contact_id] = Number(r.total_balance ?? 0);
  });
  return m;
}

/** Merge live balances into an array of contact-like rows (keyed by row.id). */
export function mergeBalancesById<T extends { id: string; balance?: number | null }>(
  rows: T[],
  map: Record<string, number>,
): T[] {
  return rows.map((r) => ({ ...r, balance: map[r.id] ?? Number(r.balance ?? 0) }));
}
