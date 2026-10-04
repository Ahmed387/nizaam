import { supabase } from "@/integrations/supabase/client";

export type LedgerAllocation = Map<string, { paid: number; remaining: number }>;

/**
 * Ledger-based FIFO matching (RPC `doc_ledger_allocation`). Per contact and branch, every settlement
 * on the contact's statement — direct invoice payments, manual or linked receipt/payment vouchers,
 * supplier payments, the credit part of returns and an opening credit — is applied to the oldest debt
 * first (opening balance first). With `asOf` only movements dated on or before it are counted, so a
 * period shows its documents as they stood at the end of that period.
 * Returns documentId → { paid, remaining }. Σ remaining over all docs + opening = the branch statement balance.
 */
export async function fetchLedgerAllocation(
  kind: "sale" | "purchase",
  branchId: string,
  contactIds: (string | null | undefined)[],
  asOf?: string | null,
  signal?: AbortSignal,
): Promise<LedgerAllocation> {
  const out: LedgerAllocation = new Map();
  const ids = [...new Set(contactIds.filter(Boolean) as string[])];
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    for (let from = 0; ; from += 1000) {
      let q: any = (supabase.rpc as any)("doc_ledger_allocation", {
        p_kind: kind, p_branch_id: branchId, p_contact_ids: chunk, p_as_of: asOf || null,
      }).order("doc_id").range(from, from + 999);
      if (signal) q = q.abortSignal(signal);
      const { data, error } = await q;
      if (error) throw error;
      for (const r of (data ?? []) as any[]) {
        if (r.doc_id) out.set(r.doc_id, { paid: Number(r.paid) || 0, remaining: Number(r.remaining) || 0 });
      }
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

/** Purchase invoices: paid/remaining from the supplier's branch statement (see fetchLedgerAllocation). */
export function fetchPurchaseAllocation(branchId: string, contactIds: string[], signal?: AbortSignal, asOf?: string | null) {
  return fetchLedgerAllocation("purchase", branchId, contactIds, asOf, signal);
}
