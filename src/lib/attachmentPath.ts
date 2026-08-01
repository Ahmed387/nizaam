import { supabase } from "@/integrations/supabase/client";

let cachedTenantId: string | null = null;

/** Current user's tenant id (cached per session) — used to scope storage paths. */
export async function getTenantId(): Promise<string> {
  if (cachedTenantId) return cachedTenantId;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("يجب تسجيل الدخول");
  const { data, error } = await supabase.from("profiles").select("tenant_id").eq("id", uid).maybeSingle();
  if (error || !data?.tenant_id) throw new Error("تعذر تحديد الشركة الحالية");
  cachedTenantId = data.tenant_id as string;
  return cachedTenantId;
}

/**
 * Builds a tenant-scoped storage path: `<tenant_id>/<suffix>`.
 * Storage policies require the first folder segment to match the uploader's tenant,
 * which prevents writing files into another company's namespace.
 */
export async function tenantStoragePath(suffix: string): Promise<string> {
  const tid = await getTenantId();
  return `${tid}/${suffix.replace(/^\/+/, "")}`;
}
