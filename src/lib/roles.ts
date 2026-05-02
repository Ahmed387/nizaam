import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "branch_manager" | "cashier" | "warehouse" | "accountant" | "super_admin";

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "مالك المنصة",
  admin: "مدير عام",
  branch_manager: "مدير فرع",
  cashier: "كاشير",
  warehouse: "مخزن",
  accountant: "محاسب",
};

export async function fetchUserContext(userId: string) {
  const [{ data: profile }, { data: roles }, { data: branchUsers }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("branch_users").select("branch_id, branches(*)").eq("user_id", userId),
  ]);

  let tenant: { id: string; name: string; slug: string; logo_url: string | null; primary_color: string | null } | null = null;
  if ((profile as any)?.tenant_id) {
    const { data: t } = await supabase
      .from("tenants")
      .select("id, name, slug, logo_url, primary_color")
      .eq("id", (profile as any).tenant_id)
      .maybeSingle();
    tenant = (t as any) ?? null;
  }

  const userRoles = (roles ?? []).map((r) => r.role as AppRole);
  const isAdminOrSuper = userRoles.includes("admin") || userRoles.includes("super_admin");

  // الأدمن يشوف كل فروع شركته، أما باقي الموظفين فيشوفوا الفروع المسجل فيهم فقط
  let branches: any[] = [];
  if (isAdminOrSuper && (profile as any)?.tenant_id) {
    const { data: allBranches } = await supabase
      .from("branches")
      .select("*")
      .eq("tenant_id", (profile as any).tenant_id)
      .eq("is_active", true)
      .order("name");
    branches = allBranches ?? [];
  } else {
    branches = (branchUsers ?? []).map((b: any) => b.branches).filter(Boolean);
  }

  return {
    profile,
    tenantId: (profile as any)?.tenant_id ?? null,
    tenant,
    roles: userRoles,
    branches,
  };
}

export async function logAudit(params: {
  userId: string;
  userName: string;
  tenantId?: string | null;
  branchId?: string | null;
  action: "CREATE" | "UPDATE" | "DELETE" | "CANCEL";
  entity: string;
  entityId?: string;
  details?: any;
}) {
  await supabase.from("audit_log").insert({
    user_id: params.userId,
    user_name: params.userName,
    tenant_id: params.tenantId ?? null,
    branch_id: params.branchId ?? null,
    action: params.action,
    entity: params.entity,
    entity_id: params.entityId,
    details: params.details ?? {},
  } as any);
}
