import { supabase } from "@/integrations/supabase/client";

/**
 * Saves one company setting (migration 0094: settings are per company — PRIMARY KEY (scope, key), scope = the
 * company). The tenant trigger fills tenant_id, so each company updates only its own row. Throws on any error, so
 * a screen never says «تم الحفظ» when nothing was saved.
 */
export async function saveCompanySetting(key: string, value: unknown, userId?: string | null) {
  const { error } = await supabase.from("settings").upsert(
    { key, value: value as any, updated_by: userId ?? null, updated_at: new Date().toISOString() } as any,
    { onConflict: "scope,key" },
  );
  if (error) throw error;
}
