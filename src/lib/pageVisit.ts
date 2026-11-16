/**
 * Which page a pathname is, for the daily activity report (migration 0238). Catalogue pages (`pageForPath`) give
 * their own key and Arabic label; a few screens outside the catalogue are named here. Document pages
 * (/sales/123) count under their list page («الفواتير»). Branch id from /branch/:id/….
 */
import { pageForPath } from "@/lib/permissionCatalog";

const EXTRA: { re: RegExp; key: string; label: string }[] = [
  { re: /^\/branch\/[^/]+\/sales\/new/, key: "sales_new", label: "شاشة البيع" },
  { re: /^\/branch\/[^/]+\/shipments\/new/, key: "shipments_new", label: "فاتورة شراء جديدة" },
  { re: /^\/branch\/[^/]+\/sale-returns\/new/, key: "sale_return_new", label: "مرتجع بيع جديد" },
  { re: /^\/branch\/[^/]+\/purchase-returns\/new/, key: "purchase_return_new", label: "مرتجع شراء جديد" },
  { re: /^\/branch\/[^/]+\/shifts\/open/, key: "shift_open", label: "فتح الوردية" },
  { re: /^\/branch\/[^/]+\/shifts\/close/, key: "shift_close", label: "قفل الوردية" },
  { re: /^\/branch\/[^/]+\/inventory-count/, key: "inventory_count", label: "الجرد" },
  { re: /^\/admin\/eta-invoices/, key: "admin_eta", label: "الفواتير الإلكترونية" },
  { re: /^\/admin\/financial-statements/, key: "admin_fin_statements", label: "القوائم المالية" },
  { re: /^\/admin\/audit-log/, key: "admin_audit_log", label: "سجل العمليات" },
  { re: /^\/admin\/hidden-contacts/, key: "admin_hidden_contacts", label: "الحسابات المخفية" },
  { re: /^\/admin\/accounts-balances|^\/branch\/[^/]+\/accounts-balances/, key: "accounts_balances", label: "أرصدة مدين / دائن" },
  { re: /^\/admin\/archive|^\/branch\/[^/]+\/archive/, key: "archive", label: "الأرشيف" },
  { re: /^\/profile/, key: "profile", label: "الملف الشخصي" },
  { re: /^\/guide/, key: "guide", label: "الدليل" },
];

export interface PageVisit { key: string; label: string; branch: string | null }

export function pageVisitOf(pathname: string): PageVisit | null {
  const branch = pathname.match(/^\/branch\/([0-9a-f-]{36})(?:\/|$)/)?.[1] ?? null;
  for (const e of EXTRA) if (e.re.test(pathname)) return { key: e.key, label: e.label, branch };
  const p = pageForPath(pathname);
  if (p) return { key: p.key.replace(/[^a-z0-9_.:-]/g, "_").slice(0, 80), label: p.label, branch };
  if (/^\/(login|signup|forgot-password|reset-password|welcome|setup|suspended|branch-paused)?$/.test(pathname)) return null;
  // anything else: its first two path words, so the report still says where he was
  const key = pathname.split("/").filter(Boolean).slice(0, 2).filter((s) => !/^[0-9a-f-]{36}$/.test(s)).join("_").replace(/[^a-z0-9_-]/g, "");
  return key.length >= 2 ? { key, label: key, branch } : null;
}
