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
  | "partner"
  | "owner";

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
  owner: "مالك الشركة",
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
  { key: "shipments", label: "فواتير الشراء", actions: ["view", "create", "update", "delete"] },
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
  // 0093: «تحويل لنقدي / لآجل» on sale and purchase invoices (moves the money on the right days)
  { key: "doc_class", label: "تحويل الفاتورة نقدي / آجل (بيع وشراء)", actions: ["update"] },
  // 0132: «تعديل المرتجع» — on for everyone by default, the owner closes it per person / branch / role
  { key: "returns", label: "تعديل المرتجعات (بيع وشراء)", actions: ["update"] },
];

/** Admin sidebar pages — the owner can grant any of these to any role. */
export const ADMIN_NAV_PERMISSION_GROUPS: PermGroup[] = [
  { key: "admin_home", label: "الرئيسية (لوحة التحكم العامة)", actions: ["view"] },
  { key: "admin_ask_me", label: "اسألني (المساعد الذكي)", actions: ["view"] },
  { key: "admin_insights", label: "الرؤى التنفيذية", actions: ["view"] },
  { key: "admin_catalog", label: "الفروع والمخزون", actions: ["view"] },
  { key: "admin_product_attributes", label: "خصائص المنتجات", actions: ["view"] },
  { key: "admin_contacts", label: "الحسابات", actions: ["view"] },
  { key: "admin_employees", label: "الموظفين (إدارة)", actions: ["view"] },
  { key: "admin_presence", label: "تتبع المستخدمين", actions: ["view"] },
  { key: "admin_shifts", label: "سجل الورديات", actions: ["view"] },
  { key: "admin_main_treasury", label: "ملخص الخزائن", actions: ["view"] },
  { key: "admin_finance", label: "المالية", actions: ["view"] },
  { key: "admin_financial_position", label: "الذمة المالية للشركاء", actions: ["view"] },
  { key: "admin_reports_hub", label: "التقارير (المركزية)", actions: ["view"] },
  { key: "admin_historical_analytics", label: "الأرشيف والتحليل التاريخي", actions: ["view"] },
  { key: "admin_system_health", label: "فحص السيستم", actions: ["view"] },
  { key: "admin_approvals", label: "طلبات موافقة الأدمن", actions: ["view"] },
  { key: "admin_settings", label: "الإعدادات", actions: ["view"] },
];

/** Sub-sections (tabs) inside admin hub pages — each can be granted separately. */
export const ADMIN_SUBSECTION_PERMISSION_GROUPS: PermGroup[] = [
  // الفروع والمخزون
  { key: "admin_catalog_branches", label: "الفروع والمخزون ← إدارة الفروع", actions: ["view"] },
  { key: "admin_catalog_categories", label: "الفروع والمخزون ← التصنيفات", actions: ["view"] },
  { key: "admin_catalog_pricelist", label: "الفروع والمخزون ← قائمة الأسعار", actions: ["view"] },
  { key: "admin_catalog_inventory", label: "الفروع والمخزون ← مخزون كل الفروع", actions: ["view"] },
  { key: "admin_catalog_images", label: "الفروع والمخزون ← صور المنتجات", actions: ["view"] },
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
  admin_catalog_images: "admin_catalog",
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

/**
 * شرح بالعامية البسيطة لكل صلاحية — بيظهر جوه شاشة الصلاحيات عشان الأونر
 * يعرف بالظبط هو بيفتح إيه للموظف قبل ما يديله الصلاحية.
 */
export const PERM_HELP: Record<string, string> = {
  // الفرع والعمليات
  returns: "زرار «تعديل المرتجع» في مرتجع البيع والشراء: المرتجع القديم بيتلغي والجديد بيتسجّل بنفس تاريخه. مفتوح للكل — اقفله لمين ما تحب. (إلغاء المرتجع لوحده للمالك بس)",
  dashboard: "الصفحة الأولى للفرع: أرقام اليوم (مبيعات، كاش، تنبيهات) — من غيرها الموظف مش هيشوف ملخص الفرع.",
  sales: "عمل فواتير بيع جديدة للعملاء. «إنشاء» يعني يقدر يبيع، و«حذف» يعني يقدر يلغي بيع (خطر).",
  invoices: "استعراض الفواتير والمستندات المسجلة والبحث فيها. «تعديل» بيخليه يفتح فاتورة قديمة ويغيّرها.",
  preorders: "طلبات الحجز (اللي العميل بيدفع فيها عربون على صنف مش موجود دلوقتي).",
  shipments: "فواتير الشراء من الموردين ودخول البضاعة للمخزن وتكاليف فاتورة الشراء.",
  inventory: "أصناف المخزن وكمياتها وأسعارها. «تعديل» بيسمح بتغيير بيانات الصنف وسعره.",
  transfers: "تحويل بضاعة من فرع لفرع تاني (الفرع المستلم لازم يأكد الاستلام).",
  customers: "ملف العملاء وأرصدتهم وكشوف حسابهم.",
  suppliers: "ملف الموردين والمستحق عليهم أو ليهم.",
  treasury: "خزنة الفرع: الوارد والصادر والرصيد الحالي — بيشوف فلوس الفرع.",
  receipt_vouchers: "سندات القبض — تحصيل فلوس من عميل ودخولها الخزنة.",
  payment_vouchers: "سندات الصرف — طلع فلوس من الخزنة (مصاريف أو دفع لمورد). دي صلاحية حساسة.",
  employees: "ملفات موظفين الفرع (بياناتهم ومرتباتهم وسلفهم).",
  advances: "سلف الموظفين: طلبها وخصمها من المرتب.",
  attendance: "تسجيل ومتابعة الحضور والانصراف.",
  reports: "تقارير الفرع (مبيعات، أرباح الفرع، حركة المخزن).",
  attachments: "رفع وحذف صور وملفات الفواتير والمستندات.",

  // قائمة الإدارة
  admin_home: "لوحة التحكم العامة لكل الشركة (مش فرع واحد) — أرقام كل الفروع مجمّعة.",
  admin_ask_me: "المساعد الذكي «اسألني» — بيسأل بالعربي عن أي رقم في الشركة ويجاوبه من الداتا. أي حد ياخدها هيقدر يعرف أرقام المبيعات والأرباح.",
  admin_insights: "الرؤى التنفيذية: تحليلات وملاحظات ذكية عن أداء الشركة.",
  admin_catalog: "الفروع والمخزون مركزيًا: إدارة الفروع، التصنيفات، قائمة الأسعار، ومخزون كل الفروع.",
  admin_product_attributes: "الماركات والموديلات والمقاسات والألوان اللي بتتستخدم في تعريف الأصناف.",
  admin_contacts: "دفتر العملاء والموردين لكل الفروع في مكان واحد.",
  admin_employees: "إدارة كل موظفين الشركة: إضافة موظف، مرتبات، سلف، حسابات دخول.",
  admin_presence: "مين داخل على النظام دلوقتي ومين آخر مرة دخل.",
  admin_shifts: "سجل ورديات الكاشير: فتح وقفل الوردية والعجز والزيادة.",
  admin_main_treasury: "ملخص الخزائن: عرض فقط لأرصدة كل الخزائن مجمّعة — مفيهاش تحويل فلوس.",
  admin_finance: "المالية: السندات وذمم العملاء والموردين والحسابات — صلاحية حساسة جدًا.",
  admin_financial_position: "الذمة المالية للشركاء: رأس المال والسحوبات والسلف وتوزيع الأرباح. للمالك والشركاء بس عادةً.",
  admin_reports_hub: "مركز التقارير: كل تقارير الشركة (أرباح، ربحية، ميزانية، مقارنات).",
  admin_historical_analytics: "الأرشيف والتحليل التاريخي: بيانات السنين اللي فاتت (2022-2025) للفروع القديمة — عرض وتحليل بس، مالهاش علاقة بحسابات السنة الحالية.",
  admin_system_health: "فحص السيستم: مشاكل الداتا والتنبيهات الفنية.",
  admin_approvals: "مركز الموافقات: الموافقة على طلبات الحذف والتعديل والخصومات والسلف.",
  admin_settings: "إعدادات الشركة والصلاحيات والنسخ الاحتياطي — أخطر صلاحية، للمالك فقط.",

  // الأقسام الفرعية
  admin_catalog_branches: "إضافة وتعديل الفروع نفسها.",
  admin_catalog_categories: "شجرة تصنيفات الأصناف.",
  admin_catalog_pricelist: "قائمة أسعار البيع وتعديلها بالجملة (نسبة زيادة أو تخفيض).",
  admin_catalog_inventory: "مخزون كل الفروع في شاشة واحدة.",
  admin_catalog_images: "صور المنتجات: ملخص الصور، ربط صورة بمنتج، أكبر الصور ومسحها، والرفع بالجملة (الربط والمسح والرفع لمين يقدر يعدّل المخزون بس).",
  admin_finance_vouchers: "كل سندات القبض والصرف لكل الفروع.",
  admin_finance_receivables: "المستحق على العملاء والمستحق للموردين.",
  admin_monthly_profit: "ملخص الأرباح الشهري بالعامية: الشركة كسبت كام الشهر ده ونصيب كل شريك.",
  admin_reports_owner: "نظرة المالك داخل مركز التقارير.",
  admin_reports_central: "تقارير العمليات المركزية لكل الفروع.",
  admin_reports_profitability: "ربحية الأصناف والفروع والعملاء.",
  admin_reports_insights: "الرؤى التنفيذية داخل مركز التقارير.",
  admin_reports_scheduled: "التقارير اللي بتتبعت أوتوماتيك بشكل دوري.",
  admin_reports_audit: "سجل العمليات: مين عمل إيه وامتى.",
  admin_reports_price_audit: "سجل تغييرات الأسعار.",
  admin_reports_return_overrides: "المرتجعات اللي اتعملت خارج سياسة الإرجاع.",
  admin_approvals_requests: "طلبات الموافقة على الحذف والتعديل الجاية من الفروع.",
  admin_approvals_discounts: "طلبات الخصم اللي محتاجة موافقة.",
  admin_approvals_advances: "طلبات سلف الموظفين.",

  // بيانات حسّاسة
  net_profit: "رؤية أرقام صافي الربح في الكروت والتقارير. لو مقفولة الموظف هيشوف «غير مصرح» مكان الرقم.",
};

/** صلاحيات بيانات حسّاسة — بتتمنح لموظف بعينه فقط (مش أدوار). */
export const SENSITIVE_PERMISSION_GROUPS: PermGroup[] = [
  { key: "net_profit", label: "رؤية صافي الربح", actions: ["view"] },
];


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
  ...SENSITIVE_PERMISSION_GROUPS,
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
    "returns.update": true,
  },
  cashier: {
    "dashboard.view": true, "sales.view": true, "sales.create": true,
    "invoices.view": true, "preorders.view": true, "preorders.create": true,
    "inventory.view": true, "customers.view": true, "customers.create": true,
    "receipt_vouchers.view": true, "receipt_vouchers.create": true,
    "attendance.view": true, "attendance.create": true,
    "returns.update": true,
  },
  warehouse: {
    "dashboard.view": true, "inventory.view": true, "inventory.create": true, "inventory.update": true,
    "transfers.view": true, "transfers.create": true,
    "shipments.view": true, "shipments.create": true, "shipments.update": true,
    "suppliers.view": true, "suppliers.create": true, "suppliers.update": true,
    "employees.view": true, "employees.create": true, "employees.update": true,
    "advances.view": true, "advances.create": true,
    "attendance.view": true, "attendance.create": true,
    "returns.update": true,
  },
  supervisor: {
    "employees.view": true,
    "attendance.view": true, "attendance.create": true, "attendance.update": true,
    "returns.update": true,
  },
  worker: { "returns.update": true },
  driver: { "returns.update": true },
  // المراقب: يشوف كل حاجة المالك بيشوفها (عرض فقط) — من غير الإعدادات
  viewer: {
    ...Object.fromEntries(
      [...BRANCH_PERMISSION_GROUPS, ...ADMIN_NAV_PERMISSION_GROUPS, ...ADMIN_SUBSECTION_PERMISSION_GROUPS]
        .filter((g) => g.key !== "admin_settings")
        .flatMap((g) => g.actions.filter((a) => a === "view").map((a) => [`${g.key}.${a}`, true])),
    ),
    "net_profit.view": true,
  },
};


/** Override map key for one branch («sales.create@<branch id>»); the plain key is the base for every branch. */
export const branchKey = (key: string, branchId: string) => `${key}@${branchId}`;

/**
 * How one employee works in one branch (migration 0122): «عرض فقط» (read), «إدارة كاملة» (full — every branch
 * permission there), or «إدارة جزئية» = his role, or the template chosen for that branch (`role` = a ready role
 * or «tpl:<id>», whose map must be in permsByRole), plus his own changes.
 */
export type BranchRule = { read?: boolean; full?: boolean; role?: string | null };

/** Any permission action that is not a plain view / read. */
export const isWriteKey = (key: string) => !["view", "read"].includes(key.split(".").pop() ?? "");

/**
 * Local permission check — mirrors the database `perm_resolve(user, key, branch)` (migrations 0114 / 0115 / 0122):
 *   super admin / company owner → always true
 *   «عرض فقط» branch + a write key → false
 *   override for this branch → «إدارة كاملة» branch (any key but a company page «admin_…») → true
 *   override for every branch → manager (admin) → true unless taken away above
 *   the branch's template (when chosen) or his roles → a part follows its page → an admin sub-section follows its parent
 */
export function checkPermission(
  roles: AppRole[],
  permsByRole: Record<string, Record<string, boolean>>,
  key: string,
  userOverrides: Record<string, boolean> = {},
  branchId?: string | null,
  rule?: BranchRule | null,
): boolean {
  if (roles.includes("super_admin") || roles.includes("owner")) return true;
  if (branchId && rule?.read && isWriteKey(key)) return false;
  if (branchId && userOverrides[branchKey(key, branchId)] !== undefined) return userOverrides[branchKey(key, branchId)];
  if (branchId && rule?.full && !/^(part\.)?admin_/.test(key)) return true;
  if (userOverrides[key] !== undefined) return userOverrides[key];
  if (roles.includes("admin")) return true;
  const rs = branchId && rule?.role ? [rule.role] : roles;
  if (rs.some((r) => permsByRole[r]?.[key] === true)) return true;
  const hasExplicit = rs.some((r) => permsByRole[r]?.[key] !== undefined);
  // A part of a page (card / box / column, migration 0114) with no rule of its own follows its page.
  const part = /^part\.([a-z0-9_]+)\.[a-z0-9_]+\.view$/.exec(key);
  if (part && !hasExplicit) return checkPermission(roles, permsByRole, `${part[1]}.view`, userOverrides, branchId, rule);
  const parent = SUBSECTION_PARENT[key.replace(/\.[^.]+$/, "")];
  if (parent && !hasExplicit) return checkPermission(roles, permsByRole, `${parent}.view`, userOverrides, branchId, rule);
  return false;
}

/** Can the signed-in user see this part of a page? (`part.<page>.<part>.view`, follows the page when unset) */
export const partPermKey = (page: string, part: string) => `part.${page}.${part}.view`;

export async function fetchUserContext(userId: string) {
  const [{ data: profile }, { data: roles }, buRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("branch_users").select("branch_id, access_level, full_access, branch_role, branch_template, branches(*)").eq("user_id", userId),
  ]);
  // a database without migration 0122 has no full_access / branch_role / branch_template: read the old columns
  // instead of leaving the employee with no branch at all
  let branchUsers: any[] | null = (buRes as any).data;
  if ((buRes as any).error) {
    const { data } = await supabase.from("branch_users").select("branch_id, access_level, branches(*)").eq("user_id", userId);
    branchUsers = data as any[] | null;
  }

  const tid = (profile as any)?.tenant_id ?? null;
  const userRoles = (roles ?? []).map((r) => r.role as AppRole);
  const isAdminOrSuper = userRoles.includes("admin") || userRoles.includes("super_admin") || userRoles.includes("owner");
  const isSupervisor = userRoles.includes("supervisor");
  // المراقب: عرض فقط لكل الفروع — لازم يشوف قائمة الفروع كاملة
  const isViewer = userRoles.includes("viewer");
  const seesAll = (isAdminOrSuper || isSupervisor || isViewer) && !!tid;

  // Speed (login): the company row and the branch list only need the profile — fetch them together.
  const [tRes, bRes] = await Promise.all([
    tid
      ? supabase.from("tenants")
          .select("id, name, slug, logo_url, primary_color, is_suspended, suspension_reason, owner_user_id, setup_completed")
          .eq("id", tid).maybeSingle()
      : Promise.resolve({ data: null } as any),
    seesAll
      ? supabase.from("branches").select("*").eq("tenant_id", tid).eq("is_active", true).order("name")
      : Promise.resolve({ data: null } as any),
  ]);
  const tenant: any = (tRes as any)?.data ?? null;

  // Per-branch access level from branch_users (manage | read). Missing = manage (backward compatible).
  const accessByBranch: Record<string, "manage" | "read"> = {};
  // how he works in each branch (migration 0122): full / read / the template of that branch
  const ruleByBranch: Record<string, { full: boolean; role: string | null; template: string | null }> = {};
  (branchUsers ?? []).forEach((b: any) => {
    accessByBranch[b.branch_id] = b.access_level === "read" ? "read" : "manage";
    ruleByBranch[b.branch_id] = { full: !!b.full_access, role: b.branch_role ?? null, template: b.branch_template ?? null };
  });

  // Admin/Supervisor/Viewer see all tenant branches. Others see only their assigned branches.
  let branches: any[] = seesAll
    ? ((bRes as any)?.data ?? [])
    : (branchUsers ?? []).map((b: any) => b.branches).filter(Boolean);
  // A branch paused by the platform owner (migration 0109) is closed to its employees; owners / admins
  // still see it (read only — the database refuses any work in it).
  if (!isAdminOrSuper) branches = branches.filter((b: any) => !b?.platform_paused);

  // Owner / admin / super admin keep permanent "manage" on every branch (owner immunity).
  branches = branches.map((b: any) => ({
    ...b,
    access_level: isAdminOrSuper ? "manage" : (accessByBranch[b.id] ?? "manage"),
    full_access: !isAdminOrSuper && !!ruleByBranch[b.id]?.full,
    branch_role: isAdminOrSuper ? null : ruleByBranch[b.id]?.role ?? null,
    branch_template: isAdminOrSuper ? null : ruleByBranch[b.id]?.template ?? null,
  }));

  return {
    profile,
    tenantId: (profile as any)?.tenant_id ?? null,
    tenant,
    roles: userRoles,
    branches,
  };
}

/**
 * Audit rows are written by the server (log_audit_event): user, name and company come from the
 * session, never from the browser (Step 5). userId / userName / tenantId stay in the signature for
 * the existing callers and are ignored. A failed audit write never blocks the business action.
 */
export async function logAudit(params: {
  userId?: string;
  userName?: string;
  tenantId?: string | null;
  branchId?: string | null;
  action: "CREATE" | "UPDATE" | "DELETE" | "CANCEL";
  entity: string;
  entityId?: string;
  details?: any;
}) {
  const { error } = await (supabase.rpc as any)("log_audit_event", {
    p_action: params.action,
    p_entity: params.entity,
    p_entity_id: params.entityId ?? null,
    p_branch_id: params.branchId ?? null,
    p_details: params.details ?? {},
  });
  if (error) console.warn("audit log failed:", error.message);
}
