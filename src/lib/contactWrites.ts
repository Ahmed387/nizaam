import { supabase } from "@/integrations/supabase/client";

/**
 * Contact writes go through SECURITY DEFINER RPCs (SEC-004): the browser has no INSERT/UPDATE/DELETE
 * on `contacts`. The server checks company, branch and permission, and only these fields are accepted.
 * Edits other than "also customer / also supplier" and deletes are admin-only; branch managers keep
 * sending approval requests.
 */
export interface ContactInput {
  name?: string;
  type?: "customer" | "supplier" | "both";
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  /** Create only. */
  branch_id?: string | null;
}

export async function saveContact(id: string | null, data: ContactInput): Promise<{ data: any; error: { message: string } | null }> {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  const { data: row, error } = await (supabase.rpc as any)("save_contact", { p_id: id, p_data: clean });
  return { data: row ?? null, error: error ? { message: error.message } : null };
}

export async function deleteContact(id: string): Promise<{ error: { message: string } | null }> {
  const { error } = await (supabase.rpc as any)("delete_contact", { p_id: id });
  return { error: error ? { message: error.message } : null };
}
