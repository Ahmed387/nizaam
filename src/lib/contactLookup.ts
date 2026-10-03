import { supabase } from "@/integrations/supabase/client";

/** Which contact types a document accepts. Every kind also accepts `both`. */
export type ContactKind = "customer" | "supplier" | "any";

export interface ContactLookupRow {
  id: string;
  name: string;
  phone: string | null;
  type: string;
  branch_id: string | null;
}

/**
 * Single server-side contact lookup used by every document picker.
 * Eligibility (branch, activity, type, archive) and search live in the
 * `search_branch_contacts` RPC so no picker can drift or hit the 1,000-row cap.
 */
export async function searchContacts(branchId: string | null | undefined, kind: ContactKind, query: string, limit = 50): Promise<ContactLookupRow[]> {
  if (!branchId) return [];
  const { data, error } = await supabase.rpc("search_branch_contacts" as any, {
    p_branch_id: branchId, p_kind: kind, p_query: query.trim() || null, p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as ContactLookupRow[];
}

/** Resolve already-selected ids (works for archived/historical links too). */
export async function getContactsByIds(branchId: string | null | undefined, ids: string[]): Promise<ContactLookupRow[]> {
  const clean = ids.filter(Boolean);
  if (!branchId || clean.length === 0) return [];
  const { data, error } = await supabase.rpc("search_branch_contacts" as any, {
    p_branch_id: branchId, p_kind: "any", p_query: null, p_limit: clean.length, p_ids: clean,
  });
  if (error) throw error;
  return (data ?? []) as ContactLookupRow[];
}
