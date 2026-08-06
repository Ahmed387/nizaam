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
  | "driver"
  | "partner";

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
  partner: "شريك",
};

/** Roles whose users only access their own profile (worker/driver). */
export const SELF_ONLY_ROLES: AppRole[] = ["worker", "driver"];

type PermGroup = { key: string; label: string; actions: ("view" | "create" | "update" | "delete")[] };

/** Branch/operations permission catalog. */
export const BRANCH_PERMISSION_GROUPS: PermGroup[] = [
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
  { key: "attachments", label: "المرفقات (ملفات الفواتير والمستندات)", actions: ["view", "create", "update", "delete"] },
];

/** Admin sidebar pages — the owner can grant any of these to any role. */
export const ADMIN_NAV_PERMISSION_GROUPS: PermGroup[] = [
  { key: "admin_home", label: "الرئيسية (لوحة التحكم العامة)", actions: ["view"] },
  { key: "admin_cockpit", label: "لوحة المالك", actions: ["view"] },
  { key: "admin_ask_me", label: "اسألني (المساعد الذكي)", actions: ["view"] },
  { key: "admin_insights", label: "الرؤى التنفيذية", actions: ["view"] },
  { key: "admin_catalog", label: "الفروع والمخزون", actions: ["view"] },
  { key: "admin_product_attributes", label: "خصائص المنتجات", actions: ["view"] },
  { key: "admin_contacts", label: "جهات التواصل", actions: ["view"] },
  { key: "admin_employees", label: "الموظفين (إدارة)", actions: ["view"] },
  { key: "admin_presence", label: "تتبع المستخدمين", actions: ["view"] },
  { key: "admin_shifts", label: "سجل الورديات", actions: ["view"] },
  { key: "admin_main_treasury", label: "الخزنة الرئيسية", actions: ["view"] },
  { key: "admin_finance", label: "المالية", actions: ["view"] },
  { key: "admin_financial_position", label: "الذمة المالية للشركاء", actions: ["view"] },
  { key: "admin_reports_hub", label: "التقارير (المركزية)", actions: ["view"] },
  { key: "admin_system_health", label: "فحص السيستم", actions: ["view"] },
  { key: "admin_approvals", label: "طلبات موافقة الأدمن", actions: ["view"] },
  { key: "admin_data_migration", label: "ترحيل الفواتير القديمة (المالك فقط افتراضيًا)", actions: ["view"] },
  { key: "admin_settings", label: "الإعدادات", actions: ["view"] },
];

/** Sub-sections (tabs) inside admin hub pages — each can be granted separately. */
export const ADMIN_SUBSECTION_PERMISSION_GROUPS: PermGroup[] = [
  // الفروع والمخزون
  { key: "admin_catalog_branches", label: "الفروع والمخزون ← إدارة الفروع", actions: ["view"] },
  { key: "admin_catalog_categories", label: "الفروع والمخزون ← التصنيفات", actions: ["view"] },
  { key: "admin_catalog_pricelist", label: "الفروع والمخزون ← قائمة الأسعار", actions: ["view"] },
  { key: "admin_catalog_inventory", label: "الفروع والمخزون ← مخزون كل الفروع", actions: ["view"] },
  // المالية
  { key: "admin_finance_vouchers", label: "المالية ← السندات المالية", actions: ["view"] },
  { key: "admin_finance_receivables", label: "المالية ← ذمم العملاء والموردين", actions: ["view"] },
  // التقارير
  { key: "admin_monthly_profit", label: "ملخص الأرباح الشهري", actions: ["view"] },
  { key: "admin_reports_owner", label: "التقارير ← نظرة المالك", actions: ["view"] },
  { key: "admin_reports_central", label: "التقارير ← العمليات (مركزية)", actions: ["view"] },
  { key: "admin_reports_profitability", label: "التقارير ← الربحية", actions: ["view"] },
  { key: "admin_reports_insights", label: "التقارير ← الرؤى التنفيذية", actions: ["view"] },
  { key: "admin_reports_scheduled", label: "التقارير ← التقارير المجدولة", actions: ["view"] },
  { key: "admin_reports_audit", label: "التقارير ← سجل العمليات", actions: ["view"] },
  { key: "admin_reports_price_audit", label: "التقارير ← سجل الأسعار", actions: ["view"] },
  { key: "admin_reports_return_overrides", label: "التقارير ← تجاوزات المرتجعات", actions: ["view"] },
  // مركز الموافقات
  { key: "admin_approvals_requests", label: "الموافقات ← طلبات الموافقة", actions: ["view"] },
  { key: "admin_approvals_discounts", label: "الموافقات ← طلبات الخصم", actions: ["view"] },
  { key: "admin_approvals_advances", label: "الموافقات ← طلبات السلف", actions: ["view"] },
];

/**
 * Sub-section key → parent page key. When a sub-section has no explicit rule,
 * it inherits the parent page permission.
 */
export const SUBSECTION_PARENT: Record<string, string> = {
  admin_catalog_branches: "admin_catalog",
  admin_catalog_categories: "admin_catalog",
  admin_catalog_pricelist: "admin_catalog",
  admin_catalog_inventory: "admin_catalog",
  admin_finance_vouchers: "admin_finance",
  admin_finance_receivables: "admin_finance",
  admin_reports_owner: "admin_reports_hub",
  admin_reports_central: "admin_reports_hub",
  admin_reports_profitability: "admin_reports_hub",
  admin_reports_insights: "admin_reports_hub",
  admin_reports_scheduled: "admin_reports_hub",
  admin_reports_audit: "admin_reports_hub",
  admin_reports_price_audit: "admin_reports_hub",
  admin_reports_return_overrides: "admin_reports_hub",
  admin_approvals_requests: "admin_approvals",
  admin_approvals_discounts: "admin_approvals",
  admin_approvals_advances: "admin_approvals",
};

/** Full permission catalog used by the admin Role Permissions panel. */
export const PERMISSION_GROUPS: PermGroup[] = [
  ...BRANCH_PERMISSION_GROUPS,
  ...ADMIN_NAV_PERMISSION_GROUPS,
];

/** Everything an owner can grant to a single user (roles + sub-sections). */
export const USER_PERMISSION_GROUPS: PermGroup[] = [
  ...BRANCH_PERMISSION_GROUPS,
  ...ADMIN_NAV_PERMISSION_GROUPS,
  ...ADMIN_SUBSECTION_PERMISSION_GROUPS,
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
  branch_manager: Object.fromEntries(BRANCH_PERMISSION_GROUPS.flatMap(g => g.actions.map(a => [`${g.key}.${a}`, true]))),
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
  viewer: Object.fromEntries(BRANCH_PERMISSION_GROUPS.flatMap(g => g.actions.filter(a => a === "view").map(a => [`${g.key}.${a}`, true]))),
};

/**
 * Local permission check (mirrors DB has_permission). Admin/super always true.
 * Resolution order: per-user override → role matrix → parent page (for sub-sections).
 */
export function checkPermission(
  roles: AppRole[],
  permsByRole: Record<string, Record<string, boolean>>,
  key: string,
  userOverrides: Record<string, boolean> = {},
): boolean {
  if (roles.includes("admin") || roles.includes("super_admin")) return true;
  if (userOverrides[key] !== undefined) return userOverrides[key];
  if (roles.some((r) => permsByRole[r]?.[key] === true)) return true;
  const parent = SUBSECTION_PARENT[key.replace(/\.[^.]+$/, "")];
  if (parent) {
    const hasExplicit = roles.some((r) => permsByRole[r]?.[key] !== undefined);
    if (!hasExplicit) return checkPermission(roles, permsByRole, `${parent}.view`, userOverrides);
  }
  return false;
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
      .select("id, name, slug, logo_url, primary_color, is_suspended, suspension_reason, owner_user_id, setup_completed")
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
