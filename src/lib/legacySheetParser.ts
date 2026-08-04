import * as XLSX from "xlsx";

/**
 * قارئ ملفات النظام القديم (Block Format).
 *
 * شكل الملف:
 *   A1                → نوع المستند: بيع / شراء / مرتجع بيع / مرتجع شراء
 *   صف العناوين       → التاريخ | الوقت | رقم الفاتورة | [الفاتورة المرتجعة] | الحساب | طريقة السداد | ...
 *   صف الهيدر         → أول عمود فيه رقم مسلسل (1، 2، 3 …)
 *   صف عناوين الأصناف → رقم الصنف | اسم الصنف | وحدة | المتاح | كمية | السعر | الخصم | النهائى
 *   صفوف الأصناف      → سطر لكل صنف
 *   صف الإجمالي       → مجاميع بدون رقم صنف
 *   صف فاضي           → نهاية البلوك
 */

export type LegacyKind = "sale" | "purchase" | "sale_return" | "purchase_return";

export const LEGACY_KIND_LABEL: Record<LegacyKind, string> = {
  sale: "فواتير بيع",
  purchase: "فواتير شراء",
  sale_return: "مرتجعات بيع",
  purchase_return: "مرتجعات شراء",
};

export interface LegacyItem {
  code: string;
  name: string;
  qty: number;
  price: number;
  discount: number;
  total: number;
}

export interface LegacyPayment {
  method: "cash" | "instapay" | "vodafone" | "bank";
  amount: number;
}

export interface LegacyDoc {
  seq: number;
  row: number;
  legacyNumber: string;
  /** رقم المستند الأصلي (للمرتجعات فقط) */
  originalNumber: string | null;
  dateISO: string;
  account: string;
  paymentLabel: string;
  warehouse: string;
  headerDiscount: number;
  headerTotal: number;
  credit: number;
  due: number;
  paid: number;
  payments: LegacyPayment[];
  items: LegacyItem[];
  itemsTotal: number;
  warnings: string[];
}

export interface ParsedLegacySheet {
  kind: LegacyKind | null;
  rawKind: string;
  docs: LegacyDoc[];
  warehouses: string[];
  accounts: string[];
  itemCount: number;
  grandTotal: number;
  issues: string[];
}

/* ------------------------------------------------------------------ */

const KIND_FROM_TITLE: { match: string; kind: LegacyKind }[] = [
  { match: "مرتجع بيع", kind: "sale_return" },
  { match: "مرتجع شراء", kind: "purchase_return" },
  { match: "مرتجع مبيعات", kind: "sale_return" },
  { match: "مرتجع مشتريات", kind: "purchase_return" },
  { match: "شراء", kind: "purchase" },
  { match: "مشتريات", kind: "purchase" },
  { match: "بيع", kind: "sale" },
  { match: "مبيعات", kind: "sale" },
];

const clean = (v: any) => (v === null || v === undefined ? "" : String(v).trim());

const num = (v: any) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const isSeq = (v: any) => {
  const s = clean(v);
  return /^\d+$/.test(s);
};

function two(n: number) {
  return String(n).padStart(2, "0");
}

/** يحوّل خلية تاريخ (Date أو نص) + خلية وقت إلى ISO محلي بدون إزاحة توقيت. */
function toISODateTime(dateCell: any, timeCell: any): string {
  let y = 0, m = 0, d = 0;
  if (dateCell instanceof Date) {
    y = dateCell.getFullYear(); m = dateCell.getMonth() + 1; d = dateCell.getDate();
  } else {
    const s = clean(dateCell);
    const mm = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/) || s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (mm) {
      if (mm[1].length === 4) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
      else { d = +mm[1]; m = +mm[2]; y = +mm[3]; }
    }
  }
  if (!y) return "";

  let hh = 0, mi = 0, ss = 0;
  if (timeCell instanceof Date) {
    hh = timeCell.getHours(); mi = timeCell.getMinutes(); ss = timeCell.getSeconds();
  } else {
    const t = clean(timeCell).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (t) { hh = +t[1]; mi = +t[2]; ss = +(t[3] ?? 0); }
  }
  return `${y}-${two(m)}-${two(d)}T${two(hh)}:${two(mi)}:${two(ss)}`;
}

/** يبني خريطة عنوان → رقم عمود من صف عناوين. */
function headerMap(row: any[]): Record<string, number> {
  const map: Record<string, number> = {};
  row.forEach((cell, i) => {
    const k = clean(cell);
    if (k && !(k in map)) map[k] = i;
  });
  return map;
}

const pick = (map: Record<string, number>, row: any[], ...names: string[]) => {
  for (const n of names) if (n in map) return row[map[n]];
  return undefined;
};

/* ------------------------------------------------------------------ */

/** يستنتج نوع المستند من اسم الملف (مثلاً "فواتير_شراء-3.xlsx" → purchase). */
export function kindFromFileName(fileName: string): LegacyKind | null {
  const n = fileName.replace(/[_\-.]+/g, " ");
  return KIND_FROM_TITLE.find((k) => n.includes(k.match))?.kind ?? null;
}

const isDateCell = (v: any) => {
  if (v instanceof Date) return true;
  const s = clean(v);
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s) || /^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(s);
};

/** ترتيب الأعمدة الافتراضي لما الملف ميكونش فيه صف عناوين. */
const POSITIONAL_DOC: Record<string, number> = {
  "التاريخ": 0, "الوقت": 1, "رقم الفاتورة": 2, "المخزن": 3,
  "طريقة السداد": 4, "كمية": 5, "الخصم": 6, "النهائى": 7,
};
const POSITIONAL_ITEM: Record<string, number> = {
  "رقم الصنف": 0, "اسم الصنف": 1, "وحدة": 2, "المتاح": 3,
  "كمية": 4, "السعر": 5, "الخصم": 6, "النهائى": 7,
};

export function parseLegacyRows(rows: any[][], fallbackKind: LegacyKind | null = null): ParsedLegacySheet {
  const issues: string[] = [];
  const docs: LegacyDoc[] = [];

  // 1) نوع المستند من أول خلية غير فاضية، وإلا من اسم الملف
  let rawKind = "";
  for (const r of rows.slice(0, 5)) {
    const c = clean(r?.[0]);
    if (c && !isDateCell(c)) { rawKind = c; break; }
  }
  const titleKind = KIND_FROM_TITLE.find((k) => rawKind.includes(k.match))?.kind ?? null;
  const kind = titleKind ?? fallbackKind;
  if (!titleKind && fallbackKind) issues.push(`مفيش عنوان جوه الملف — النوع اتحدد من اسم الملف: ${LEGACY_KIND_LABEL[fallbackKind]}.`);
  if (!kind) issues.push(`مش عارف نوع المستند لا من عنوان الملف ولا من اسمه — اختاره يدوي.`);

  // 2) صف عناوين المستند (لو موجود)
  let headIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] ?? []).map(clean);
    if (cells.includes("رقم الفاتورة") && cells.includes("التاريخ")) { headIdx = i; break; }
  }
  const headerless = headIdx < 0;
  const H = headerless ? POSITIONAL_DOC : headerMap(rows[headIdx]);
  if (headerless) {
    issues.push("الملف مفيهوش صف عناوين — اتقرى بترتيب الأعمدة: التاريخ | الوقت | رقم الفاتورة | المخزن | طريقة السداد | كمية | خصم | الإجمالي. راجع المعاينة قبل الترحيل.");
  }

  // 3) المرور على البلوكات
  let itemH: Record<string, number> | null = headerless ? POSITIONAL_ITEM : null;
  let cur: LegacyDoc | null = null;
  let seq = 0;
  const push = () => { if (cur) { finalizeDoc(cur); docs.push(cur); cur = null; } };

  for (let i = headerless ? 0 : headIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const first = clean(row[0]);

    // صف عناوين الأصناف (في أي عمود)
    if (row.some((c) => clean(c) === "رقم الصنف")) { itemH = headerMap(row); continue; }

    // هيدر مستند جديد
    const isDocHeader = headerless ? isDateCell(row[0]) : isSeq(first);
    if (isDocHeader) {
      push();
      seq = headerless ? seq + 1 : +first;
      cur = buildDoc(row, H, seq, i + 1, kind);
      continue;
    }

    if (!cur) continue;

    const m = itemH ?? POSITIONAL_ITEM;
    const code = clean(pick(m, row, "رقم الصنف", "كود الصنف"));
    const name = clean(pick(m, row, "اسم الصنف", "الصنف"));

    // صف صنف حقيقي: لازم يكون فيه اسم صنف
    if (name) {
      const qty = Math.abs(num(pick(m, row, "كمية", "الكمية")));
      const price = Math.abs(num(pick(m, row, "السعر", "سعر")));
      const disc = Math.abs(num(pick(m, row, "الخصم", "خصم")));
      const total = Math.abs(num(pick(m, row, "النهائى", "الاجمالى", "الإجمالي")));
      if (qty > 0) {
        cur.items.push({ code, name, qty, price, discount: disc, total: total || qty * price - disc });
      } else {
        cur.warnings.push(`الصنف "${name}" كميته صفر — اتجاهل.`);
      }
      continue;
    }

    // صف إجمالي أو صف فاضي → نهاية البلوك (الهيدر الجاي هو اللي بيفتح مستند جديد)
  }
  push();

  const warehouses = [...new Set(docs.map((d) => d.warehouse).filter(Boolean))];
  const accounts = [...new Set(docs.map((d) => d.account).filter(Boolean))];

  return {
    kind,
    rawKind: rawKind || (kind ? LEGACY_KIND_LABEL[kind] : ""),
    docs,
    warehouses,
    accounts,
    itemCount: docs.reduce((s, d) => s + d.items.length, 0),
    grandTotal: docs.reduce((s, d) => s + d.headerTotal, 0),
    issues,
  };
}


function buildDoc(row: any[], H: Record<string, number>, seq: number, rowNo: number, kind: LegacyKind | null): LegacyDoc {
  const total = Math.abs(num(pick(H, row, "النهائى", "الاجمالى", "الإجمالي")));
  const payLabel = clean(pick(H, row, "طريقة السداد"));
  const hasCreditCol = "الآجل" in H || "الاجل" in H;
  // لو مفيش عمود "الآجل" نعتمد على طريقة السداد: آجل → المبلغ كله على الحساب
  const credit = hasCreditCol
    ? Math.abs(num(pick(H, row, "الآجل", "الاجل")))
    : (payLabel.includes("آجل") || payLabel.includes("اجل") ? total : 0);
  const due = hasCreditCol ? Math.abs(num(pick(H, row, "المستحق"))) : credit;


  const payments: LegacyPayment[] = [];
  const addPay = (method: LegacyPayment["method"], v: any) => {
    const amt = Math.abs(num(v));
    if (amt > 0) payments.push({ method, amount: amt });
  };
  addPay("instapay", pick(H, row, "انستاباي", "إنستاباي"));
  addPay("vodafone", pick(H, row, "فودافون كاش"));
  addPay("bank", pick(H, row, "PayMob", "paymob"));

  const digital = payments.reduce((s, p) => s + p.amount, 0);
  // المدفوع وقت إنشاء المستند = الإجمالي − الآجل (المستحق بيتغير مع التحصيلات اللاحقة)
  const paid = Math.max(0, Math.min(total, +(total - credit).toFixed(2)));
  const cash = Math.max(0, +(paid - digital).toFixed(2));
  if (cash > 0) payments.unshift({ method: "cash", amount: cash });

  return {
    seq,
    row: rowNo,
    legacyNumber: clean(pick(H, row, "رقم الفاتورة", "رقم المستند")),
    originalNumber: clean(pick(H, row, "الفاتورة المرتجعة")) || null,
    dateISO: toISODateTime(pick(H, row, "التاريخ"), pick(H, row, "الوقت")),
    account: clean(pick(H, row, "الحساب", "العميل", "المورد")),
    paymentLabel: clean(pick(H, row, "طريقة السداد")),
    warehouse: clean(pick(H, row, "المخزن")),
    headerDiscount: Math.abs(num(pick(H, row, "خصم", "الخصم"))),
    headerTotal: total,
    credit,
    due,
    paid,
    payments,
    items: [],
    itemsTotal: 0,
    warnings: [],
  };
}

function finalizeDoc(d: LegacyDoc) {
  d.itemsTotal = +d.items.reduce((s, i) => s + i.total, 0).toFixed(2);
  if (!d.legacyNumber) d.warnings.push("مفيش رقم مستند.");
  if (!d.dateISO) d.warnings.push("التاريخ غير مقروء.");
  if (!d.items.length) d.warnings.push("المستند مفيهوش أصناف.");
  const diff = Math.abs(d.itemsTotal - d.headerTotal);
  if (d.items.length && diff > 1) {
    d.warnings.push(`مجموع الأصناف (${d.itemsTotal}) مش مطابق لإجمالي الفاتورة (${d.headerTotal}).`);
  }
}

/** يقرأ ملف Excel بصيغة النظام القديم. */
export async function parseLegacyFile(file: File): Promise<ParsedLegacySheet> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: true, defval: "" });
  return parseLegacyRows(rows);
}
