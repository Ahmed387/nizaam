import { textHas } from "@/lib/docMeta";
import type { DocumentFilters } from "@/components/documents/UnifiedDocumentFilters";

/**
 * In-memory checks of the unified filter (owner 2026-11-18) for lists that are read whole: inventory tabs, count
 * sessions, branch transfers, vessel transfers. Every check is skipped when its field is empty.
 */

/** a Cairo day (yyyy-mm-dd, or a timestamp whose first 10 characters are the day) inside من / إلى */
export function dayIn(day: string | null | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  const d = String(day ?? "").slice(0, 10);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/** a number inside «المبلغ من / إلى» (min / max are the typed text) */
export function amountIn(n: number | string | null | undefined, min: string, max: string): boolean {
  const lo = min.trim() === "" ? null : Number(min), hi = max.trim() === "" ? null : Number(max);
  if (lo === null && hi === null) return true;
  const v = Number(n);
  if (!Number.isFinite(v)) return false;
  if (lo !== null && Number.isFinite(lo) && v < lo) return false;
  if (hi !== null && Number.isFinite(hi) && v > hi) return false;
  return true;
}

/** any of several numbers inside the range (a session whose item cost is in range, …) */
export const anyAmountIn = (ns: (number | string | null | undefined)[], min: string, max: string) =>
  (min.trim() === "" && max.trim() === "") || ns.some((n) => amountIn(n, min, max));

/** the search box: every typed word somewhere in the given texts (Arabic spelling rules of the system) */
export const searchHas = (texts: (string | null | undefined)[], q: string) =>
  !q.trim() || textHas(texts.filter(Boolean).join(" "), q);

/** a filter is set (for «مسح الفلتر» and the empty-list text) */
export const hasAny = (f: DocumentFilters) => Object.values(f).some((v) => String(v ?? "").trim() !== "");

/** a product's price for «المبلغ من / إلى» (owner 2026-11-18 «سعر البيع او سعر الشراء وليس الاجمالى»):
 *  "buy" = its cost (moving average, else the cost price), anything else = the selling price */
export const productPrice = (p: { selling_price?: any; avg_cost?: any; cost_price?: any }, basis: string) =>
  basis === "buy" ? (Number(p.avg_cost) > 0 ? Number(p.avg_cost) : Number(p.cost_price) || 0) : Number(p.selling_price) || 0;
