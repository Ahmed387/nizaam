import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "branch_manager" | "cashier" | "warehouse" | "accountant";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "مدير عام",
  branch_manager: "مدير فرع",
  cashier: "كاشير",
  warehouse: "مخزن",
  accountant: "محاسب",
};

export async function fetchUserContext(userId: string) {
  const [{ data: profile }, { data: roles }, { data: branches }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("branch_users").select("branch_id, branches(*)").eq("user_id", userId),
  ]);
  return {
    profile,
    roles: (roles ?? []).map((r) => r.role as AppRole),
    branches: (branches ?? []).map((b: any) => b.branches).filter(Boolean),
  };
}

export async function logAudit(params: {
  userId: string;
  userName: string;
  branchId?: string | null;
  action: "CREATE" | "UPDATE" | "DELETE" | "CANCEL";
  entity: string;
  entityId?: string;
  details?: any;
}) {
  await supabase.from("audit_log").insert({
    user_id: params.userId,
    user_name: params.userName,
    branch_id: params.branchId ?? null,
    action: params.action,
    entity: params.entity,
    entity_id: params.entityId,
    details: params.details ?? {},
  });
}
