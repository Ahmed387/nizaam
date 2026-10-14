import { supabase } from "@/integrations/supabase/client";

/** Which contact types a document accepts. Every kind also accepts `both`. */
export type ContactKind = "customer" | "supplier" | "any";

export interface ContactLookupRow {
  id: string;
  name: string;
  phone: string | null;
  type: string;
  branch_id: string | null;
  branch_name?: string | null;
}

/** Rows per page of the picker (the list loads the next page while scrolling). */
export const CONTACT_PAGE = 50;

/**
 * Single server-side contact lookup used by every document picker.
 * Every customer / supplier of the company (not archived), own branch first, searched and paged in the
 * `search_branch_contacts` RPC (migration 0085) — no 1,000-row cap, no picker can drift.
 */
export async function searchContacts(branchId: string | null | undefined, kind: ContactKind, query: string, limit = CONTACT_PAGE, offset = 0): Promise<ContactLookupRow[]> {
  if (!branchId) return [];
  const { data, error } = await supabase.rpc("search_branch_contacts" as any, {
    p_branch_id: branchId, p_kind: kind, p_query: query.trim() || null, p_limit: limit, p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as ContactLookupRow[];
}

/** Resolve already-selected ids (works for archived/historical links too). */
export async function getContactsByIds(branchId: string | null | undefined, ids: string[]): Promise<ContactLookupRow[]> {
  const clean = ids.filter(Boolean);
  if (!branchId || clean.length === 0) return [];
  const { data, error } = await supabase.rpc("search_branch_contacts" as any, {
    p_branch_id: branchId, p_kind: "any", p_query: null, p_limit: Math.min(clean.length, 200), p_ids: clean,
  });
  if (error) throw error;
  return (data ?? []) as ContactLookupRow[];
}
