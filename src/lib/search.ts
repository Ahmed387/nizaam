// Universal search helpers — case-insensitive, digit-tolerant (Arabic/English),
// forgiving of common Arabic letter variants & diacritics, and multi-token:
// every word the user types must appear somewhere in the searched text,
// regardless of word order or which field it lives in.

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;

export function normalizeForSearch(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // unify digits
  s = s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
  s = s.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
  // remove diacritics & tatweel
  s = s.replace(DIACRITICS, "").replace(TATWEEL, "");
  // unify alef / yaa / taa marbuta variants
  s = s.replace(/[إأآا]/g, "ا").replace(/[ىي]/g, "ي").replace(/ة/g, "ه");
  return s.toLowerCase().trim();
}

/** Split a query into normalized words. Empty query => empty array (matches everything). */
export function searchTokens(needle: unknown): string[] {
  return normalizeForSearch(needle).split(/\s+/).filter(Boolean);
}

/** Join any number of fields into one normalized, searchable blob. */
export function composeSearchText(...parts: unknown[]): string {
  return normalizeForSearch(parts.filter((p) => p !== null && p !== undefined && p !== "").join(" "));
}

/**
 * True when EVERY word of `needle` appears somewhere across the given fields.
 * Fields are joined first, so "كاسيل حائط" matches a product whose brand is
 * "كاسيل" and whose name contains "حائط" — in any order.
 */
export function searchMatch(needle: string, ...haystacks: unknown[]): boolean {
  const tokens = searchTokens(needle);
  if (tokens.length === 0) return true;
  const target = composeSearchText(...haystacks);
  if (!target) return false;
  return tokens.every((t) => target.includes(t));
}

/** True when every token is present in an already-composed text. */
export function tokensMatchText(tokens: string[], target: string): boolean {
  if (tokens.length === 0) return true;
  return tokens.every((t) => target.includes(t));
}

/** Any product-like row; all fields optional so every screen can pass what it has. */
export interface SearchableProduct {
  name?: string | null;
  product_name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  old_barcode?: string | null;
  legacy_code?: string | null;
  model_code?: string | null;
  brand?: string | null;
  model?: string | null;
  color?: string | null;
  size?: string | null;
  capacity?: string | null;
  product_type?: string | null;
  category_name?: string | null;
  unit?: string | null;
  supplier_name?: string | null;
  [key: string]: unknown;
}

/** All searchable fields of a product merged into one normalized string. */
export function productSearchText(p: SearchableProduct): string {
  return composeSearchText(
    p.name,
    p.product_name,
    p.sku,
    p.barcode,
    p.old_barcode,
    p.legacy_code,
    p.model_code,
    p.brand,
    p.model,
    p.color,
    p.size,
    p.capacity,
    p.product_type,
    p.category_name,
    p.unit,
    p.supplier_name,
  );
}

/** Multi-token match of a query against every searchable field of a product. */
export function productSearchMatch(p: SearchableProduct, query: string): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  return tokensMatchText(tokens, productSearchText(p));
}

/**
 * Relevance score (higher = better):
 *  3 → exact barcode / SKU / legacy-code hit
 *  2 → query words start the product name
 *  1 → matched somewhere else (attributes, category, supplier…)
 *  0 → no match
 */
export function productSearchScore(p: SearchableProduct, query: string): number {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return 1;
  const text = productSearchText(p);
  if (!tokensMatchText(tokens, text)) return 0;

  const q = tokens.join(" ");
  const codes = [p.sku, p.barcode, p.old_barcode, p.legacy_code, p.model_code].map(normalizeForSearch);
  if (codes.some((c) => c && c === q)) return 3;

  const name = normalizeForSearch(p.name ?? p.product_name);
  if (name && (name.startsWith(q) || tokens.every((t) => name.includes(t)))) return 2;

  return 1;
}

/** Filter + relevance-sort a product list. Empty query returns the list untouched. */
export function filterProductsBySearch<T extends SearchableProduct>(rows: T[], query: string): T[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return rows;
  return rows
    .map((row) => ({ row, score: productSearchScore(row, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.row);
}
