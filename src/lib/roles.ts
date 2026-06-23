import { supabase } from "@/integrations/supabase/client";

export type AppRole =
  | "admin"
  | "branch_manager"
  | "cashier"
  | "warehouse"
  | "accountant"
  | "super_admin"
  | "viewer"
  | "supervisor"
  | "worker"
  | "driver";

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "مالك المنصة",
  admin: "مدير عام",
  branch_manager: "مدير فرع",
  cashier: "كاشير",
  warehouse: "أمين مخازن",
  accountant: "محاسب",
  viewer: "Viewer — مراقب (قراءة فقط لكل البيانات)",
  supervisor: "ملاحظ (متابعة الحضور والانصراف فقط)",
  worker: "عامل",
  driver: "سواق",
};

/** Roles whose users only access their own profile (worker/driver). */
export const SELF_ONLY_ROLES: AppRole[] = ["worker", "driver"];

/** Permission catalog used by the admin Role Permissions panel. */
export const PERMISSION_GROUPS: { key: string; label: string; actions: ("view" | "create" | "update" | "delete")[] }[] = [
  { key: "dashboard", label: "الرئيسية", actions: ["view"] },
  { key: "sales", label: "المبيعات", actions: ["view", "create", "update", "delete"] },
  { key: "invoices", label: "الفواتير والمستندات", actions: ["view", "update", "delete"] },
  { key: "preorders", label: "طلبات الحجز", actions: ["view", "create", "update", "delete"] },
  { key: "shipments", label: "الشحنات", actions: ["view", "create", "update", "delete"] },
  { key: "inventory", label: "المخزون", actions: ["view", "create", "update", "delete"] },
  { key: "transfers", label: "نقل المخزون بين الفروع", actions: ["view", "create"] },
  { key: "customers", label: "العملاء", actions: ["view", "create", "update", "delete"] },
  { key: "suppliers", label: "الموردين", actions: ["view", "create", "update", "delete"] },
  { key: "treasury", label: "الخزنة", actions: ["view"] },
  { key: "receipt_vouchers", label: "سندات القبض", actions: ["view", "create", "delete"] },
  { key: "payment_vouchers", label: "سندات الصرف", actions: ["view", "create", "delete"] },
  { key: "employees", label: "الموظفين", actions: ["view", "create", "update", "delete"] },
  { key: "advances", label: "السلف", actions: ["view", "create", "update"] },
  { key: "attendance", label: "الحضور والانصراف", actions: ["view", "create", "update"] },
  { key: "reports", label: "التقارير", actions: ["view"] },
];

/** Roles managed via the Permissions panel (super_admin/admin always full). */
export const MANAGED_ROLES: AppRole[] = [
  "branch_manager",
  "accountant",
  "cashier",
  "warehouse",
  "supervisor",
  "worker",
  "driver",
  "viewer",
];

/** Sensible defaults applied the first time the panel is opened for a tenant. */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, Record<string, boolean>> = {
  branch_manager: Object.fromEntries(PERMISSION_GROUPS.flatMap(g => g.actions.map(a => [`${g.key}.${a}`, true]))),
  accountant: {
    "dashboard.view": true, "sales.view": true, "invoices.view": true, "invoices.update": true,
    "preorders.view": true, "shipments.view": true, "inventory.view": true,
    "customers.view": true, "suppliers.view": true, "treasury.view": true,
    "receipt_vouchers.view": true, "receipt_vouchers.create": true,
    "payment_vouchers.view": true, "payment_vouchers.create": true,
    "employees.view": true, "employees.create": true, "employees.update": true,
    "advances.view": true, "advances.create": true, "advances.update": true,
    "attendance.view": true, "attendance.create": true, "attendance.update": true,
    "reports.view": true,
  },
  cashier: {
    "dashboard.view": true, "sales.view": true, "sales.create": true,
    "invoices.view": true, "preorders.view": true, "preorders.create": true,
    "inventory.view": true, "customers.view": true, "customers.create": true,
    "receipt_vouchers.view": true, "receipt_vouchers.create": true,
    "attendance.view": true, "attendance.create": true,
  },
  warehouse: {
    "dashboard.view": true, "inventory.view": true, "inventory.create": true, "inventory.update": true,
    "transfers.view": true, "transfers.create": true,
    "shipments.view": true, "shipments.create": true, "shipments.update": true,
    "suppliers.view": true, "suppliers.create": true, "suppliers.update": true,
    "employees.view": true, "employees.create": true, "employees.update": true,
    "advances.view": true, "advances.create": true,
    "attendance.view": true, "attendance.create": true,
  },
  supervisor: {
    "employees.view": true,
    "attendance.view": true, "attendance.create": true, "attendance.update": true,
  },
  worker: {},
  driver: {},
  viewer: Object.fromEntries(PERMISSION_GROUPS.flatMap(g => g.actions.filter(a => a === "view").map(a => [`${g.key}.${a}`, true]))),
};

/** Local permission check (mirrors DB has_permission). Admin/super always true. */
export function checkPermission(
  roles: AppRole[],
  permsByRole: Record<string, Record<string, boolean>>,
  key: string,
): boolean {
  if (roles.includes("admin") || roles.includes("super_admin")) return true;
  return roles.some((r) => permsByRole[r]?.[key] === true);
}

export async function fetchUserContext(userId: string) {
  const [{ data: profile }, { data: roles }, { data: branchUsers }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("branch_users").select("branch_id, branches(*)").eq("user_id", userId),
  ]);

  let tenant: any = null;
  if ((profile as any)?.tenant_id) {
    const { data: t } = await supabase
      .from("tenants")
      .select("id, name, slug, logo_url, primary_color, is_suspended, suspension_reason")
      .eq("id", (profile as any).tenant_id)
      .maybeSingle();
    tenant = (t as any) ?? null;
  }

  const userRoles = (roles ?? []).map((r) => r.role as AppRole);
  const isAdminOrSuper = userRoles.includes("admin") || userRoles.includes("super_admin");
  const isSupervisor = userRoles.includes("supervisor");

  // Admin/Supervisor see all tenant branches. Others see only their assigned branches.
  let branches: any[] = [];
  if ((isAdminOrSuper || isSupervisor) && (profile as any)?.tenant_id) {
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
