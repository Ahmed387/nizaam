/**
 * Product search in the stock-transfer picker (0143): the same matching as the sale screen (`searchMatch`: any words,
 * any order, «ة» = «ه», Arabic / English digits) plus «أكواد قريبة» — codes one or two letters away from what was
 * typed (a typo like WFJ221 for WFJ211), so every look-alike shows in the list.
 */
import { normalizeForSearch, searchMatch } from "@/lib/search";

export type CodedProduct = { id: string; name: string; sku?: string | null; legacy_code?: string | null; brand?: string | null; model?: string | null };

const clean = (s: unknown) => normalizeForSearch(s).replace(/[\s\-_./]/g, "");

/** Edit distance (insert / delete / replace / swap of neighbours), stopping early above `cap`. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > cap) return cap + 1;
  }
  return d[a.length][b.length];
}

/** Products whose words match (name, code, old code, brand, model) — exact code first. */
export function matchProducts<T extends CodedProduct>(query: string, items: T[], limit = 60): T[] {
  const q = query.trim();
  if (!q) return items.slice(0, limit);
  const qc = clean(q);
  const hits = items.filter((p) => searchMatch(q, p.name, p.sku, p.legacy_code, p.brand, p.model));
  hits.sort((x, y) => Number(clean(y.sku) === qc || clean(y.legacy_code) === qc) - Number(clean(x.sku) === qc || clean(x.legacy_code) === qc));
  return hits.slice(0, limit);
}

/**
 * Codes close to what was typed (one letter for short codes, two for longer), the products already in `exclude` left
 * out. Only for a single word of 3+ characters (a code), closest first.
 */
export function similarCodes<T extends CodedProduct>(query: string, items: T[], exclude: Set<string> = new Set(), limit = 15): { item: T; code: string; distance: number }[] {
  const q = clean(query);
  if (q.length < 3 || /\s/.test(query.trim())) return [];
  const cap = q.length <= 4 ? 1 : 2;
  const out: { item: T; code: string; distance: number }[] = [];
  for (const p of items) {
    if (exclude.has(p.id)) continue;
    let best: { code: string; distance: number } | null = null;
    for (const raw of [p.sku, p.legacy_code]) {
      const c = clean(raw);
      if (!c) continue;
      const dist = editDistance(q, c, cap);
      if (dist <= cap && (!best || dist < best.distance)) best = { code: String(raw), distance: dist };
    }
    if (best) out.push({ item: p, ...best });
  }
  return out.sort((a, b) => a.distance - b.distance || a.code.localeCompare(b.code)).slice(0, limit);
}
