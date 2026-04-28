import { supabase } from "@/integrations/supabase/client";

export async function notify(params: {
  userId: string;
  title: string;
  body?: string;
  type?: "advance_request" | "advance_approved" | "advance_rejected" | "general";
  link?: string;
  relatedEntity?: string;
  relatedEntityId?: string;
}) {
  await supabase.from("notifications").insert({
    user_id: params.userId,
    title: params.title,
    body: params.body ?? null,
    type: params.type ?? "general",
    link: params.link ?? null,
    related_entity: params.relatedEntity ?? null,
    related_entity_id: params.relatedEntityId ?? null,
  } as any);
}

export async function notifyMany(userIds: string[], payload: Omit<Parameters<typeof notify>[0], "userId">) {
  if (!userIds.length) return;
  await supabase.from("notifications").insert(
    userIds.map((u) => ({
      user_id: u,
      title: payload.title,
      body: payload.body ?? null,
      type: payload.type ?? "general",
      link: payload.link ?? null,
      related_entity: payload.relatedEntity ?? null,
      related_entity_id: payload.relatedEntityId ?? null,
    })) as any
  );
}

/** Get all branch managers for a branch (users with branch_manager role assigned to this branch). */
export async function getBranchManagers(branchId: string): Promise<string[]> {
  const { data: bu } = await supabase.from("branch_users").select("user_id").eq("branch_id", branchId);
  const ids = (bu ?? []).map((r: any) => r.user_id);
  if (!ids.length) return [];
  const { data: roles } = await supabase
    .from("user_roles")
    .select("user_id")
    .in("user_id", ids)
    .eq("role", "branch_manager");
  return Array.from(new Set((roles ?? []).map((r: any) => r.user_id)));
}

/** Get all admins for a tenant. */
export async function getTenantAdmins(tenantId: string): Promise<string[]> {
  const { data: profs } = await supabase.from("profiles").select("id").eq("tenant_id", tenantId);
  const ids = (profs ?? []).map((p: any) => p.id);
  if (!ids.length) return [];
  const { data: roles } = await supabase
    .from("user_roles")
    .select("user_id")
    .in("user_id", ids)
    .eq("role", "admin");
  return Array.from(new Set((roles ?? []).map((r: any) => r.user_id)));
}
