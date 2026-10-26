/**
 * Excel-like column filters for every table (owner 2026-10-26): an arrow beside each column title opens the list of
 * the values in that column (with counts), number conditions or a date tree, plus sorting. Filters of different
 * columns are ANDed, the values picked inside one column are ORed, and every list shows only the values left by the
 * OTHER columns' filters (like Excel). A totals row adds the number columns of the rows that are still shown.
 *
 * The values are the text the person SEES in each cell (like Excel), read from the table itself, so a table needs no
 * per-column setup. This file is pure (no React / DOM): parsing, matching, facets, sorting and totals.
 */

export type CellKind = "text" | "number" | "date";

/** One table cell as the engine sees it. */
export type Cell = {
  /** normalised display text */
  text: string;
  blank: boolean;
  num?: number;
  /** YYYY-MM-DD when the text is a date */
  day?: string;
  /** sortable timestamp when the text is a date (with its time when shown) */
  ts?: number;
};

export type NumberOp = "eq" | "gt" | "lt" | "between";
export type ColumnFilter =
  | { kind: "values"; values: string[] }
  | { kind: "number"; op: NumberOp; a: number; b?: number }
  | { kind: "date"; days?: string[]; from?: string; to?: string };

export type SortState = { col: string; dir: "asc" | "desc" } | null;
export type FilterState = { filters: Record<string, ColumnFilter>; sort: SortState };
export const EMPTY_STATE: FilterState = { filters: {}, sort: null };

/** the token a blank cell has in a values filter (Excel's «(Blanks)») */
export const BLANK = "\u0000blank";
export const BLANK_LABEL = "(فاضي)";

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const toLatin = (s: string) =>
  s.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));
const MARKS = /[‎‏‪-‮⁦-⁩ ]/g;

export const normText = (s: string | null | undefined) => String(s ?? "").replace(MARKS, " ").replace(/\s+/g, " ").trim();

const BLANKS = new Set(["", "—", "-", "–", "−"]);

/** «1,234.50 ج.م» → 1234.5 ; «(1,200)» / «−1,200» → -1200 ; «12.5%» → 12.5 ; anything else → undefined */
export function parseNumber(raw: string): number | undefined {
  let s = toLatin(normText(raw));
  if (!s) return undefined;
  s = s.replace(/ج\.?\s?م\.?|جنيه|EGP|LE|ج$/gi, "").replace(/%/g, "").replace(/\s+/g, "");
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^[−–-]/.test(s)) { neg = !neg; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/,/g, "").replace(/٬/g, "").replace(/٫/g, ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : undefined;
}

const MONTHS: Record<string, number> = {
  يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ابريل: 4, إبريل: 4, مايو: 5, يونيو: 6, يوليو: 7,
  أغسطس: 8, اغسطس: 8, سبتمبر: 9, أكتوبر: 10, اكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
};
export const MONTH_NAMES = ["", "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const pad = (n: number) => String(n).padStart(2, "0");
const validDay = (y: number, m: number, d: number) => y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

function timeOf(rest: string): number {
  // «في 1:05 م», «1:05 PM», «13:05», «13:05:22»
  const m = rest.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(ص|م|AM|PM|am|pm)?/);
  if (!m) return 0;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3] ?? 0);
  const ap = m[4];
  if (ap && /م|PM|pm/.test(ap) && h < 12) h += 12;
  if (ap && /ص|AM|am/.test(ap) && h === 12) h = 0;
  return ((h * 60 + min) * 60 + sec) * 1000;
}

/** Dates as the app shows them: «3 يونيو 2026», «3 يونيو 2026 في 1:00 م», «2026-06-03 …», «03/06/2026». */
export function parseDate(raw: string): { day: string; ts: number } | undefined {
  const s = toLatin(normText(raw));
  if (!s || s.length > 60) return undefined;
  let m = s.match(/^(\d{1,2})\s+([؀-ۿ]+)\s+(\d{4})(.*)$/);
  if (m && MONTHS[m[2]] !== undefined) {
    const d = Number(m[1]), mo = MONTHS[m[2]], y = Number(m[3]);
    if (!validDay(y, mo, d) || (m[4] && !/^[\s،,]*(في\s+)?\d{1,2}:\d{2}/.test(m[4]))) return undefined;
    return { day: `${y}-${pad(mo)}-${pad(d)}`, ts: Date.UTC(y, mo - 1, d) + timeOf(m[4] ?? "") };
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](.*))?$/);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (!validDay(y, mo, d)) return undefined;
    return { day: `${m[1]}-${m[2]}-${m[3]}`, ts: Date.UTC(y, mo - 1, d) + timeOf(m[4] ?? "") };
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (!validDay(y, mo, d) || (m[4] && !/^[\s،,]*(في\s+)?\d{1,2}:\d{2}/.test(m[4]))) return undefined;
    return { day: `${y}-${pad(mo)}-${pad(d)}`, ts: Date.UTC(y, mo - 1, d) + timeOf(m[4] ?? "") };
  }
  return undefined;
}

export function parseCell(raw: string | null | undefined): Cell {
  const text = normText(raw);
  if (BLANKS.has(text)) return { text: "", blank: true };
  const num = parseNumber(text);
  if (num !== undefined) return { text, blank: false, num };
  const d = parseDate(text);
  if (d) return { text, blank: false, day: d.day, ts: d.ts };
  return { text, blank: false };
}

/** identifiers that look like numbers (phones, codes, document numbers) are listed as text, not summed */
const ID_HEADER = /تليفون|هاتف|موبايل|محمول|الكود|كود|رقم|SKU|code|باركود|بطاقة|الرقم القومي/i;

export function detectKind(label: string, cells: Cell[]): CellKind {
  const filled = cells.filter((c) => !c.blank);
  if (!filled.length) return "text";
  if (!ID_HEADER.test(label) && filled.every((c) => c.num !== undefined) && !filled.some((c) => /^0\d/.test(c.text))) return "number";
  if (filled.every((c) => c.day !== undefined)) return "date";
  return "text";
}

/** a number column whose sum means something (not a balance, a price, a percent, an average or an identifier) */
const NO_SUM = /رصيد|الرصيد|سعر|السعر|نسبة|النسبة|%|هامش|متوسط|كود|رقم|تليفون|هاتف|#|الحد|حد التنبيه|السن|العمر|السنة|الشهر|ترتيب/;
export function isSummable(label: string, kind: CellKind, cells: Cell[]): boolean {
  if (kind !== "number") return false;
  if (NO_SUM.test(label)) return false;
  return cells.some((c) => !c.blank);
}

export const valueKey = (c: Cell) => (c.blank ? BLANK : c.text);

export function cellMatches(c: Cell, f: ColumnFilter): boolean {
  if (f.kind === "values") return f.values.includes(valueKey(c));
  if (f.kind === "number") {
    if (c.blank || c.num === undefined) return false;
    const n = c.num;
    const eps = 1e-9;
    if (f.op === "eq") return Math.abs(n - f.a) < 0.005 + eps;
    if (f.op === "gt") return n > f.a + eps;
    if (f.op === "lt") return n < f.a - eps;
    const lo = Math.min(f.a, f.b ?? f.a), hi = Math.max(f.a, f.b ?? f.a);
    return n >= lo - eps && n <= hi + eps;
  }
  // date
  if (c.blank || !c.day) return false;
  if (f.days && f.days.length && !f.days.includes(c.day)) return false;
  if (f.from && c.day < f.from) return false;
  if (f.to && c.day > f.to) return false;
  return true;
}

export const isActive = (s: FilterState) => Object.keys(s.filters).length > 0 || !!s.sort;

/** rows[r][c] (only the filterable columns, in `cols` order); returns which rows pass every filter but `except` */
export function visibleRows(rows: Cell[][], cols: string[], state: FilterState, except?: string): boolean[] {
  const active = cols
    .map((id, i) => [i, id === except ? undefined : state.filters[id]] as const)
    .filter((x): x is readonly [number, ColumnFilter] => !!x[1]);
  return rows.map((row) => active.every(([i, f]) => cellMatches(row[i], f)));
}

export type Facet = { value: string; label: string; count: number; num?: number; day?: string; ts?: number };

/** the distinct values of one column among the rows the OTHER filters leave (Excel's cascading lists) */
export function facets(rows: Cell[][], cols: string[], state: FilterState, col: string, kind: CellKind): Facet[] {
  const ci = cols.indexOf(col);
  if (ci < 0) return [];
  const vis = visibleRows(rows, cols, state, col);
  const map = new Map<string, Facet>();
  rows.forEach((row, r) => {
    if (!vis[r]) return;
    const c = row[ci];
    const k = valueKey(c);
    const f = map.get(k);
    if (f) f.count += 1;
    else map.set(k, { value: k, label: c.blank ? BLANK_LABEL : c.text, count: 1, num: c.num, day: c.day, ts: c.ts });
  });
  return sortFacets([...map.values()], kind);
}

const collator = typeof Intl !== "undefined" ? new Intl.Collator("ar", { numeric: true, sensitivity: "base" }) : null;
const cmpText = (a: string, b: string) => (collator ? collator.compare(a, b) : a < b ? -1 : a > b ? 1 : 0);

export function sortFacets(list: Facet[], kind: CellKind): Facet[] {
  return list.sort((a, b) => {
    if (a.value === BLANK) return 1;
    if (b.value === BLANK) return -1;
    if (kind === "number") return (a.num ?? 0) - (b.num ?? 0);
    if (kind === "date") return (a.ts ?? 0) - (b.ts ?? 0);
    return cmpText(a.label, b.label);
  });
}

/** stable order of the row indices for one column; blanks always last */
export function sortOrder(rows: Cell[][], ci: number, dir: "asc" | "desc", kind: CellKind): number[] {
  const idx = rows.map((_, i) => i);
  const sign = dir === "asc" ? 1 : -1;
  return idx.sort((x, y) => {
    const a = rows[x][ci], b = rows[y][ci];
    if (a.blank !== b.blank) return a.blank ? 1 : -1;
    let r = 0;
    if (!a.blank) {
      if (kind === "number") r = (a.num ?? 0) - (b.num ?? 0);
      else if (kind === "date") r = (a.ts ?? 0) - (b.ts ?? 0);
      else r = cmpText(a.text, b.text);
    }
    return r !== 0 ? r * sign : x - y;
  });
}

export function sumColumn(rows: Cell[][], ci: number, visible: boolean[]): number {
  let s = 0;
  rows.forEach((row, r) => { if (visible[r] && row[ci].num !== undefined) s += row[ci].num as number; });
  return Math.round(s * 100) / 100;
}

const fmtNum = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** short Arabic text of a filter for the chips bar */
export function describeFilter(label: string, f: ColumnFilter): string {
  if (f.kind === "values") {
    const names = f.values.map((v) => (v === BLANK ? BLANK_LABEL : v));
    return `${label}: ${names.length <= 2 ? names.join("، ") : `${names.slice(0, 2).join("، ")} و${names.length - 2} كمان`}`;
  }
  if (f.kind === "number") {
    if (f.op === "eq") return `${label} = ${fmtNum(f.a)}`;
    if (f.op === "gt") return `${label} أكبر من ${fmtNum(f.a)}`;
    if (f.op === "lt") return `${label} أصغر من ${fmtNum(f.a)}`;
    return `${label} بين ${fmtNum(Math.min(f.a, f.b ?? f.a))} و ${fmtNum(Math.max(f.a, f.b ?? f.a))}`;
  }
  const parts: string[] = [];
  if (f.from) parts.push(`من ${dayLabel(f.from)}`);
  if (f.to) parts.push(`لـ ${dayLabel(f.to)}`);
  if (f.days?.length) parts.push(f.days.length === 1 ? dayLabel(f.days[0]) : `${f.days.length} يوم`);
  return `${label}: ${parts.join(" ")}`;
}

export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m] ?? m} ${y}`;
}

export const sortWords = (kind: CellKind): [string, string] =>
  kind === "number" ? ["من الأصغر للأكبر", "من الأكبر للأصغر"]
  : kind === "date" ? ["من الأقدم للأحدث", "من الأحدث للأقدم"]
  : ["من أ إلى ي", "من ي إلى أ"];

// ---------- remembering the filters of a table on this device («زي ما سبتها»)
export function loadState(key: string): FilterState {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return EMPTY_STATE;
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || typeof v.filters !== "object") return EMPTY_STATE;
    return { filters: v.filters ?? {}, sort: v.sort ?? null };
  } catch {
    return EMPTY_STATE;
  }
}

export function saveState(key: string, s: FilterState) {
  try {
    if (!isActive(s)) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* private window / blocked storage: filters just aren't remembered */
  }
}

export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
