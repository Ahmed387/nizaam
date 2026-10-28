/**
 * Permissions catalogue, grouped exactly like the sidebar (owner decision 2026-10-24, migration 0114).
 *
 * Every permission key that exists in roles.ts (branch pages, admin pages, admin sub-sections, sensitive data)
 * appears here exactly once — `permissionCatalog.test.ts` fails if one is missing or doubled.
 *
 * Parts: a card / box / column / dialog inside a page, key «part.<page>.<part>.view». With no rule of its
 * own a part follows its page (see `resolvePermission` in roles.ts and `has_permission` in the database).
 * `sensitive`: a number worth thinking twice about (profit, till cash, cost). `offscreen`: a part that is not
 * on the screen until something happens (a dialog, an alert) — the customize mode lists those on the side.
 */
import {
  ADMIN_NAV_PERMISSION_GROUPS,
  ADMIN_SUBSECTION_PERMISSION_GROUPS,
  BRANCH_PERMISSION_GROUPS,
  PERM_HELP,
  SENSITIVE_PERMISSION_GROUPS,
  SUBSECTION_PARENT,
} from "@/lib/roles";

export type PermAction = "view" | "create" | "update" | "delete";
export type SectionId = "general" | "ops" | "money" | "admin" | "personal";

export interface PagePart {
  id: string;
  label: string;
  kind: "كارت" | "بوكس" | "جدول" | "عمود" | "تاب" | "زرار" | "نافذة" | "تنبيه" | "رسم بياني";
  sensitive?: boolean;
  offscreen?: boolean;
}

export interface CatalogPage {
  key: string;
  label: string;
  help?: string;
  actions: PermAction[];
  /** where the page lives: a branch page (one per branch) or the company-wide admin page */
  scope: "branch" | "admin" | "data";
  /** tabs inside the page that have their own permission key (admin sub-sections) */
  children: { key: string; label: string; help?: string }[];
  parts: PagePart[];
  /** route pattern for «ظبطها على الصفحة نفسها»; `:branch` is replaced by a branch id */
  route?: string;
}

export interface CatalogSection {
  id: SectionId;
  label: string;
  pages: CatalogPage[];
}

export const ACTION_LABELS: Record<PermAction, string> = { view: "يشوف", create: "يضيف", update: "يعدل", delete: "يلغي" };

/** Parts of each page that are switchable on their own. Pages not listed here have no parts yet. */
export const PAGE_PARTS: Record<string, PagePart[]> = {
  dashboard: [
    { id: "reservations", label: "الحجوزات الشغالة", kind: "بوكس" },
    { id: "quick_actions", label: "إجراءات سريعة", kind: "بوكس" },
    { id: "sales_today", label: "مبيعات اليوم", kind: "كارت" },
    { id: "sales_month", label: "مبيعات الشهر", kind: "كارت" },
    { id: "gross_profit_today", label: "مجمل ربح اليوم", kind: "كارت", sensitive: true },
    { id: "till_balance", label: "رصيد الخزنة", kind: "كارت", sensitive: true },
    { id: "month_target", label: "هدف مبيعات الشهر", kind: "بوكس" },
    { id: "sales_chart", label: "المبيعات آخر 30 يوم", kind: "رسم بياني" },
    { id: "collections", label: "تحصيلات اليوم حسب الطريقة", kind: "بوكس" },
    { id: "top_products", label: "أكثر المنتجات مبيعاً", kind: "بوكس" },
    { id: "top_customers", label: "أكثر العملاء شراءً", kind: "بوكس" },
    { id: "recent_moves", label: "آخر الحركات", kind: "جدول" },
    { id: "stock_alerts", label: "تنبيهات المخزون", kind: "جدول" },
    { id: "invoice_quick", label: "نافذة تفاصيل الفاتورة", kind: "نافذة", offscreen: true },
  ],
  admin_home: [
    { id: "business_snapshot", label: "هل بنكسب؟ (ملخص الشهر)", kind: "بوكس", sensitive: true },
    { id: "sales_today", label: "مبيعات النهارده", kind: "كارت" },
    { id: "low_stock", label: "أصناف قربت تخلص", kind: "كارت" },
    { id: "pending_approvals", label: "طلبات مستنية موافقتك", kind: "كارت" },
    { id: "data_errors", label: "أخطاء في البيانات", kind: "كارت" },
    { id: "branches", label: "كروت الفروع", kind: "بوكس" },
    { id: "recent_docs", label: "آخر 5 حركات", kind: "جدول" },
    { id: "doc_details", label: "تفاصيل المستند تحت السطر", kind: "نافذة", offscreen: true },
  ],
  reports: [
    { id: "date_filter", label: "فلتر التاريخ", kind: "بوكس" },
    { id: "net_sales", label: "المبيعات (صافي)", kind: "كارت" },
    { id: "returns", label: "المرتجعات", kind: "كارت" },
    { id: "gross_profit", label: "إجمالي الربح", kind: "كارت", sensitive: true },
    { id: "opex", label: "المصاريف التشغيلية", kind: "كارت", sensitive: true },
    { id: "net_profit", label: "صافي الربح", kind: "كارت", sensitive: true },
    { id: "invoice_count", label: "عدد الفواتير", kind: "كارت" },
    { id: "working_days", label: "أيام العمل الفعلية", kind: "كارت" },
    { id: "avg_sales_day", label: "متوسط المبيعات / يوم", kind: "كارت" },
    { id: "avg_profit_day", label: "متوسط الربح / يوم", kind: "كارت", sensitive: true },
    { id: "avg_invoices_day", label: "متوسط الفواتير / يوم", kind: "كارت" },
    { id: "tab_charts", label: "تاب التحليل البصري", kind: "تاب" },
    { id: "chart_daily", label: "رسم المبيعات والأرباح اليومية", kind: "رسم بياني", sensitive: true },
    { id: "chart_expenses", label: "رسم المصروفات حسب النوع", kind: "رسم بياني" },
    { id: "chart_top10", label: "رسم أكثر 10 منتجات إيراداً", kind: "رسم بياني" },
    { id: "tab_products", label: "تاب أكثر مبيعاً", kind: "تاب" },
    { id: "tab_leastsold", label: "تاب الأقل مبيعاً", kind: "تاب" },
    { id: "tab_expenses", label: "تاب سندات الصرف", kind: "تاب" },
    { id: "tab_lowstock", label: "تاب مخزون منخفض", kind: "تاب" },
    { id: "pdf_button", label: "زرار «تقرير تفصيلي PDF»", kind: "زرار" },
  ],
  treasury: [
    { id: "export_button", label: "زرار تصدير كشف الخزينة Excel", kind: "زرار", sensitive: true },
    { id: "transfer_button", label: "زرار «تحويل لفرع»", kind: "زرار" },
    { id: "transfer_fees", label: "كروت عمولات التحويل", kind: "بوكس", sensitive: true },
    { id: "pending_incoming", label: "تنبيه تحويلات وارد مستنية تأكيد", kind: "تنبيه" },
    { id: "tab_movements", label: "تاب حركات الخزنة", kind: "تاب" },
    { id: "tab_reversals", label: "تاب الحركات العكسية والإلغاءات", kind: "تاب" },
    { id: "tab_receipts", label: "تاب سندات القبض", kind: "تاب" },
    { id: "tab_payments", label: "تاب سندات الصرف", kind: "تاب" },
    { id: "tab_transfers", label: "تاب التحويلات بين الفروع", kind: "تاب" },
    { id: "filters", label: "فلاتر حركات الخزينة", kind: "بوكس" },
    { id: "selection_bar", label: "شريط تحديد الحركات وإجمالياتها", kind: "بوكس" },
  ],
  invoices: [
    { id: "excel_button", label: "زرار تصدير Excel", kind: "زرار" },
    { id: "pdf_button", label: "زرار طباعة / PDF", kind: "زرار" },
    { id: "tab_sale", label: "فواتير البيع", kind: "تاب" },
    { id: "tab_purchase", label: "فواتير الشراء", kind: "تاب" },
    { id: "tab_sale_return", label: "مرتجع بيع", kind: "تاب" },
    { id: "tab_purchase_return", label: "مرتجع شراء", kind: "تاب" },
    { id: "tab_income", label: "سندات القبض", kind: "تاب" },
    { id: "tab_expense", label: "سندات الصرف", kind: "تاب" },
    { id: "tab_transfer", label: "تحويل المخازن", kind: "تاب" },
    { id: "tab_quote", label: "عروض الأسعار", kind: "تاب" },
    { id: "cancelled_view", label: "زرار «النشطة / الملغاة»", kind: "زرار" },
    { id: "filters", label: "الفلاتر", kind: "بوكس" },
    { id: "bulk_bar", label: "شريط التحديد الجماعي (طباعة / تحويل نقدي وآجل)", kind: "بوكس" },
  ],
  sales: [
    { id: "discount_bar", label: "شريط الخصم (إجمالي الخصم ونسبته والحد المسموح)", kind: "بوكس", sensitive: true },
    { id: "cost_total", label: "إجمالي التكلفة (تحت الإجمالي النهائي)", kind: "بوكس", sensitive: true },
    { id: "net_profit", label: "صافي الربح (تحت الإجمالي النهائي)", kind: "بوكس", sensitive: true },
    { id: "profit_pct", label: "نسبة الربح (تحت الإجمالي النهائي)", kind: "بوكس", sensitive: true },
  ],
  inventory: [
    { id: "import_button", label: "زرار استيراد Excel", kind: "زرار" },
    { id: "barcode_buttons", label: "زراير طباعة الباركود", kind: "زرار" },
    { id: "new_product_button", label: "زرار «منتج جديد»", kind: "زرار" },
    { id: "cycle_count_alert", label: "تنبيه الجرد الدوري", kind: "تنبيه" },
  ],
  customers: [
    { id: "export_buttons", label: "زراير تصدير Excel / PDF", kind: "زرار" },
    { id: "add_button", label: "زرار «إضافة جهة»", kind: "زرار" },
    { id: "counts_line", label: "سطر إجمالي الجهات", kind: "بوكس" },
  ],
};

/** Where each page opens for «افتح الصفحة وظبطها»; `:branch` is replaced by the chosen branch. */
export const PAGE_ROUTES: Record<string, string> = {
  // branch pages
  dashboard: "/branch/:branch/dashboard",
  sales: "/branch/:branch/sales/new",
  invoices: "/branch/:branch/invoices",
  preorders: "/branch/:branch/pre-orders",
  shipments: "/branch/:branch/shipments/new",
  inventory: "/branch/:branch/inventory",
  transfers: "/branch/:branch/transfers",
  customers: "/branch/:branch/contacts",
  suppliers: "/branch/:branch/suppliers",
  treasury: "/branch/:branch/treasury",
  receipt_vouchers: "/branch/:branch/receipt-vouchers",
  payment_vouchers: "/branch/:branch/payment-vouchers",
  employees: "/branch/:branch/employees",
  advances: "/branch/:branch/advance-requests",
  attendance: "/branch/:branch/attendance",
  reports: "/branch/:branch/reports",
  attachments: "/branch/:branch/attachments",
  // company pages
  admin_home: "/admin/dashboard",
  admin_ask_me: "/admin/ask-me",
  admin_insights: "/admin/insights",
  admin_catalog: "/admin/catalog",
  admin_product_attributes: "/admin/product-attributes",
  admin_contacts: "/admin/contacts",
  admin_employees: "/admin/employees",
  admin_presence: "/admin/presence",
  admin_shifts: "/admin/shifts",
  admin_main_treasury: "/admin/main-treasury",
  admin_finance: "/admin/finance",
  admin_financial_position: "/admin/financial-position",
  admin_reports_hub: "/admin/reports-hub",
  admin_monthly_profit: "/admin/monthly-profit",
  admin_historical_analytics: "/admin/historical-analytics",
  admin_system_health: "/admin/system-health",
  admin_approvals: "/admin/approvals-hub",
  admin_settings: "/admin/settings",
};

/** Which sidebar section each page key belongs to (sub-sections follow their parent). */
const SECTION_OF: Record<string, SectionId> = {
  dashboard: "general", admin_home: "general", admin_ask_me: "general", admin_insights: "general",
  sales: "ops", invoices: "ops", preorders: "ops", shipments: "ops", inventory: "ops", transfers: "ops",
  customers: "ops", suppliers: "ops", employees: "ops", advances: "ops", attendance: "ops", attachments: "ops",
  doc_class: "ops", returns: "ops", admin_catalog: "ops", admin_product_attributes: "ops", admin_contacts: "ops",
  admin_employees: "ops", admin_presence: "ops", admin_shifts: "ops",
  treasury: "money", receipt_vouchers: "money", payment_vouchers: "money", reports: "money",
  admin_main_treasury: "money", admin_finance: "money", admin_financial_position: "money",
  admin_reports_hub: "money", admin_monthly_profit: "money", admin_historical_analytics: "money", net_profit: "money",
  admin_system_health: "admin", admin_approvals: "admin", admin_settings: "admin",
};

export const SECTION_LABELS: Record<SectionId, string> = {
  general: "عام", ops: "العمليات", money: "المالية", admin: "الإدارة", personal: "المصاريف الشخصية",
};

function buildCatalog(): CatalogSection[] {
  const sections: CatalogSection[] = (Object.keys(SECTION_LABELS) as SectionId[]).map((id) => ({ id, label: SECTION_LABELS[id], pages: [] }));
  const push = (g: { key: string; label: string; actions: PermAction[] }, scope: CatalogPage["scope"]) => {
    const section = sections.find((s) => s.id === (SECTION_OF[g.key] ?? "admin"))!;
    section.pages.push({
      key: g.key,
      label: g.label,
      help: PERM_HELP[g.key],
      actions: g.actions,
      scope,
      children: ADMIN_SUBSECTION_PERMISSION_GROUPS
        .filter((c) => SUBSECTION_PARENT[c.key] === g.key)
        .map((c) => ({ key: c.key, label: c.label.includes("←") ? c.label.split("←").slice(1).join("←").trim() : c.label, help: PERM_HELP[c.key] })),
      parts: PAGE_PARTS[g.key] ?? [],
      route: PAGE_ROUTES[g.key],
    });
  };
  BRANCH_PERMISSION_GROUPS.forEach((g) => push(g as any, "branch"));
  ADMIN_NAV_PERMISSION_GROUPS.forEach((g) => push(g as any, "admin"));
  // sub-sections without a parent page (e.g. ملخص الأرباح الشهري) stand as pages of their own
  ADMIN_SUBSECTION_PERMISSION_GROUPS.filter((c) => !SUBSECTION_PARENT[c.key]).forEach((g) => push(g as any, "admin"));
  SENSITIVE_PERMISSION_GROUPS.forEach((g) => push(g as any, "data"));
  return sections;
}

export const PERMISSION_CATALOG: CatalogSection[] = buildCatalog();

export const partKey = (page: string, part: string) => `part.${page}.${part}.view`;

/** Every key the screens can set (page actions, sub-sections, parts). */
export function allCatalogKeys(): string[] {
  const keys: string[] = [];
  PERMISSION_CATALOG.forEach((s) => s.pages.forEach((p) => {
    p.actions.forEach((a) => keys.push(`${p.key}.${a}`));
    p.children.forEach((c) => keys.push(`${c.key}.view`));
    p.parts.forEach((x) => keys.push(partKey(p.key, x.id)));
  }));
  return keys;
}

/** The catalogue page whose route matches a pathname (for the customize bar). */
export function pageForPath(pathname: string): CatalogPage | null {
  // exact route first; then the longest route the path starts with («/branch/x/invoices/123» → invoices)
  let best: CatalogPage | null = null;
  let bestLen = -1;
  for (const s of PERMISSION_CATALOG) for (const p of s.pages) {
    if (!p.route) continue;
    const base = p.route.replace(":branch", "[^/]+");
    if (new RegExp("^" + base + "/?$").test(pathname)) return p;
    if (new RegExp("^" + base + "/").test(pathname) && p.route.length > bestLen) { best = p; bestLen = p.route.length; }
  }
  return best;
}

/** Plain search over pages, tabs and parts (labels and help). */
export function searchCatalog(term: string) {
  const t = term.trim();
  if (!t) return [] as { section: CatalogSection; page: CatalogPage }[];
  const hit = (s?: string) => !!s && s.includes(t);
  const out: { section: CatalogSection; page: CatalogPage }[] = [];
  PERMISSION_CATALOG.forEach((section) => section.pages.forEach((page) => {
    if (hit(page.label) || hit(page.help) || page.children.some((c) => hit(c.label)) || page.parts.some((x) => hit(x.label))) out.push({ section, page });
  }));
  return out;
}
