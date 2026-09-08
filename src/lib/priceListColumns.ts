// Unified price-list column dictionary + field normalization (single source of truth)
// Used by the Excel/CSV import path in PriceList.tsx. Catalog-only: no accounting/inventory coupling.

export const PRICE_LIST_ALIASES = {
  product_name: [
    "product_name", "product", "name", "item", "item name", "item_name", "description",
    "اسم المنتج", "المنتج", "الاسم", "اسم الصنف", "البيان", "الصنف/البيان", "المواصفات",
  ],
  model_code: [
    "model_code", "model", "الموديل", "موديل", "طراز", "الطراز", "كود", "الكود",
    "رقم الموديل", "الصنف", "كود الصنف", "item code", "item_code", "part no", "part_no",
    "sku", "code",
  ],
  cost_price: [
    "cost_price", "cost", "سعر الشراء", "شراء", "سعر التكلفة", "التكلفة", "السعر",
    "سعر الفاتورة", "سعر المورد", "سعر التاجر", "جملة", "سعر الجملة", "price",
  ],
  suggested_sell_price: [
    "suggested_sell_price", "suggested_price", "سعر البيع المقترح", "سعر البيع", "بيع",
    "البيع المقترح", "سعر المستهلك", "المستهلك", "القطاعي", "سعر القطاعي", "سعر العميل",
    "retail", "retail_price", "rrp", "consumer_price",
  ],
  category: ["category", "الفئة", "التصنيف", "القسم", "نوع الصنف"],
} as const;

export type PriceListField = keyof typeof PRICE_LIST_ALIASES;

const AR_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** Normalize Arabic text: presentation forms, digits, tatweel, diacritics, spacing. */
export function normalizeArabicText(input: unknown): string {
  let s = String(input ?? "");
  if (!s) return "";
  try { s = s.normalize("NFKC"); } catch { /* ignore */ }
  s = s.replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] ?? d);
  s = s.replace(/[\u0640]/g, "");
  s = s.replace(/[\u064B-\u0652\u0670]/g, "");
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "");
  return s.replace(/\s+/g, " ").trim();
}

const headerKey = (s: string) =>
  normalizeArabicText(s).toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();

/** Read a field from a sheet row using the unified alias dictionary (exact then partial header match). */
export function readField(row: Record<string, unknown>, field: PriceListField): string | undefined {
  const aliases = PRICE_LIST_ALIASES[field].map(headerKey);
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const hit = keys.find((k) => headerKey(k) === alias);
    if (hit && String(row[hit] ?? "").trim() !== "") return String(row[hit]);
  }
  for (const alias of aliases) {
    if (alias.length < 4) continue;
    const hit = keys.find((k) => headerKey(k).includes(alias));
    if (hit && String(row[hit] ?? "").trim() !== "") return String(row[hit]);
  }
  return undefined;
}

/** Parse a numeric cell tolerating Arabic digits, currency symbols and thousand separators. */
export function parseNumber(value: unknown): number {
  const s = normalizeArabicText(value).replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(/,/g, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const MODEL_PATTERNS: RegExp[] = [
  /\b[A-Z]{1,5}[-_/]?[A-Z0-9]*\d[A-Z0-9-]{2,}\b/,   // GR-RT468WE, NF321, WM-8600A
  /\b\d{4,6}\b/,                                     // 8600 / 9600
];

/** Extract a model code embedded in the product name when no model column exists. */
export function extractModelFromName(name: string): string | undefined {
  const s = normalizeArabicText(name);
  for (const re of MODEL_PATTERNS) {
    const m = s.match(re);
    if (m?.[0]) {
      const v = m[0].trim();
      if (v.length >= 3) return v;
    }
  }
  return undefined;
}

export type NormalizedPriceRow = {
  product_name: string;
  model_code?: string;
  category?: string;
  cost_price: number;
  suggested_sell_price: number;
};

/** Normalize one sheet row into a price-list item (unified for Excel and CSV). */
export function normalizeSheetRow(row: Record<string, unknown>): NormalizedPriceRow {
  const product_name = normalizeArabicText(readField(row, "product_name") ?? "");
  let model_code = normalizeArabicText(readField(row, "model_code") ?? "") || undefined;
  if (!model_code && product_name) model_code = extractModelFromName(product_name);
  return {
    product_name,
    model_code,
    category: normalizeArabicText(readField(row, "category") ?? "") || undefined,
    cost_price: parseNumber(readField(row, "cost_price")),
    suggested_sell_price: parseNumber(readField(row, "suggested_sell_price")),
  };
}

/** Decode a CSV/text file, falling back to windows-1256 when UTF-8 yields replacement chars. */
export async function decodeTextFile(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  const bad = (utf8.match(/\uFFFD/g) ?? []).length;
  if (bad === 0) return utf8;
  try {
    const win = new TextDecoder("windows-1256").decode(buf);
    if ((win.match(/\uFFFD/g) ?? []).length < bad) return win;
  } catch { /* decoder unsupported */ }
  return utf8;
}
