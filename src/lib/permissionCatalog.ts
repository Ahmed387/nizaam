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
};

export const PAGE_ROUTES: Record<string, string> = {
  dashboard: "/branch/:branch/dashboard",
  admin_home: "/admin/dashboard",
};

/** Which sidebar section each page key belongs to (sub-sections follow their parent). */
const SECTION_OF: Record<string, SectionId> = {
  dashboard: "general", admin_home: "general", admin_ask_me: "general", admin_insights: "general",
  sales: "ops", invoices: "ops", preorders: "ops", shipments: "ops", inventory: "ops", transfers: "ops",
  customers: "ops", suppliers: "ops", employees: "ops", advances: "ops", attendance: "ops", attachments: "ops",
  doc_class: "ops", admin_catalog: "ops", admin_product_attributes: "ops", admin_contacts: "ops",
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
  for (const s of PERMISSION_CATALOG) for (const p of s.pages) {
    if (!p.route) continue;
    const re = new RegExp("^" + p.route.replace(":branch", "[^/]+") + "/?$");
    if (re.test(pathname)) return p;
  }
  return null;
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
