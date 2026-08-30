import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

/** الفروع التاريخية الثلاثة — أسماء حصرية مطابقة لقيود قاعدة البيانات */
export const HISTORICAL_BRANCHES = [
  "معرض عبد المنعم",
  "مخزن شلبي",
  "معرض شلبي اللي اتقفل",
] as const;
export type HistoricalBranch = (typeof HISTORICAL_BRANCHES)[number];

export const HISTORICAL_DOC_TYPES = {
  sales: "فواتير البيع",
  purchases: "فواتير الشراء",
  sales_returns: "مرتجع البيع",
  purchase_returns: "مرتجع الشراء",
  expense: "أذون الصرف",
  receipt: "أذون القبض",
} as const;
export type HistoricalFileType = keyof typeof HISTORICAL_DOC_TYPES;

export interface ImportProgress {
  phase: string;
  done: number;
  total: number;
}

export interface ImportResult {
  invoices: number;
  items: number;
  vouchers: number;
  skipped: number;
  errors: string[];
}

const BATCH = 200;

/* ------------------------------- helpers ------------------------------- */

const norm = (v: any) =>
  String(v ?? "")
    .replace(/[\u064B-\u0652\u200f\u200e]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();

/** تحويل الأرقام العربية والفواصل إلى رقم لاتيني */
export function toNum(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v)
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[,\s٬]/g, "")
    .replace(/[^\d.\-]/g, "");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

/** يقرأ تاريخ من خلية إكسيل (رقم تسلسلي أو نص) ويرجع ISO أو null */
export function parseCellDate(v: any): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return fmt(v);
  if (typeof v === "number" && v > 20000 && v < 60000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return fmt(new Date(Date.UTC(d.y, d.m - 1, d.d)));
  }
  const s = String(v)
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim();
  const m = s.match(/(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})/);
  if (!m) return null;
  let [, a, b, c] = m;
  let y: number, mo: number, day: number;
  if (a.length === 4) {
    y = +a; mo = +b; day = +c;
  } else {
    day = +a; mo = +b; y = +c;
    if (y < 100) y += 2000;
  }
  if (!y || !mo || !day || mo > 12 || day > 31) return null;
  const d = new Date(Date.UTC(y, mo - 1, day));
  if (isNaN(d.getTime())) return null;
  return fmt(d);
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);

const isValidHistDate = (iso: string | null) => !!iso && +iso.slice(0, 4) >= 2020;

/* --------------------------- header detection --------------------------- */

const KEYS: Record<string, string[]> = {
  invoice_no: ["رقم الفاتوره", "رقم المستند", "رقم الفاتورة", "الفاتوره", "رقم"],
  returned_invoice_no: ["الفاتوره المرتجعه", "الفاتوره الاصليه", "رقم الفاتوره المرتجعه"],
  date: ["التاريخ", "تاريخ"],
  party_name: ["اسم العميل", "اسم المورد", "العميل", "المورد", "الطرف", "الاسم"],
  payment_method: ["طريقه السداد", "طريقه الدفع", "السداد", "الدفع"],
  total_qty: ["اجمالي الكميه", "الكميه", "كميه"],
  discount: ["الخصم", "خصم"],
  total_amount: ["النهائي", "الاجمالي", "اجمالي", "الصافي", "المجموع", "القيمه", "total", "net", "grand total"],
  profit: ["الربح", "ربح", "المكسب"],
  paid_cash: ["المسدد", "المدفوع", "نقدي", "نقدا", "كاش"],
  credit: ["الاجل", "اجل", "المتبقي", "الباقي"],
  warehouse_name: ["المخزن", "المستودع"],
  item_code: ["كود الصنف", "الكود", "كود"],
  item_name: ["اسم الصنف", "الصنف", "البيان", "المنتج"],
  unit: ["الوحده", "وحده"],
  price: ["السعر", "سعر البيع", "سعر الشراء", "سعر"],
  // vouchers
  voucher_no: ["رقم السند", "رقم الاذن", "رقم الاذن", "السند"],
  movement_name: ["اسم الحركه", "الحركه", "نوع الحركه"],
  amount: ["القيمه", "المبلغ", "قيمه"],
  category: ["التصنيف", "البند", "النوع", "بند الصرف"],
  treasury_name: ["الخزينه", "الخزنه"],
  notes: ["ملاحظات", "ملاحظه", "بيان"],
};

type ColMap = Record<string, number>;

function detectHeader(rows: any[][]): { map: ColMap; headerRow: number } {
  let best: { map: ColMap; headerRow: number; score: number } = { map: {}, headerRow: -1, score: 0 };
  const limit = Math.min(rows.length, 25);
  for (let r = 0; r < limit; r++) {
    const map: ColMap = {};
    let score = 0;
    rows[r].forEach((cell, c) => {
      const t = norm(cell).toLowerCase();
      if (!t || t.length > 40) return;
      for (const [key, words] of Object.entries(KEYS)) {
        if (map[key] !== undefined) continue;
        if (words.some((w) => { const wl = w.toLowerCase(); return t === wl || t.includes(wl); })) {
          map[key] = c;
          score++;
          break;
        }
      }
    });
    if (score > best.score) best = { map, headerRow: r, score };
  }
  return best.score >= 2 ? { map: best.map, headerRow: best.headerRow } : { map: {}, headerRow: -1 };
}

const cell = (row: any[], map: ColMap, key: string) =>
  map[key] === undefined ? undefined : row[map[key]];

/* ------------------------------ parsing --------------------------------- */

export interface ParsedInvoice {
  key: string;
  invoice: any;
  items: any[];
}

export interface ParsedHistorical {
  invoices: ParsedInvoice[];
  vouchers: any[];
  skipped: number;
}

function readSheet(file: ArrayBuffer): any[][] {
  const wb = XLSX.read(file, { type: "array", cellDates: true });
  const out: any[][] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, defval: "", raw: true, blankrows: false });
    out.push(...rows);
  }
  return out;
}

/** يحلّل ملف فواتير/مرتجعات بهيكل شجري (سطر فاتورة + سطور أصناف تابعة) */
export function parseInvoiceSheet(
  rows: any[][],
  branch: HistoricalBranch,
  docType: "sales" | "purchases" | "sales_returns" | "purchase_returns",
): ParsedHistorical {
  const { map, headerRow } = detectHeader(rows);
  const dateCol = map.date ?? 1;
  const invoices: ParsedInvoice[] = [];
  let skipped = 0;
  let current: ParsedInvoice | null = null;
  let auto = 0;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (!row.some((c) => String(c ?? "").trim() !== "")) continue;

    const serial = String(row[0] ?? "").trim();
    const iso = parseCellDate(row[dateCol]);
    const isInvoiceRow = serial !== "" && isValidHistDate(iso);

    if (isInvoiceRow) {
      auto++;
      const date = iso as string;
      const invNoRaw = String(cell(row, map, "invoice_no") ?? "").trim();
      const invoice_no = invNoRaw || `AUTO-${docType}-${auto}`;
      const total = toNum(cell(row, map, "total_amount"));
      const paid = toNum(cell(row, map, "paid_cash"));
      const credit = toNum(cell(row, map, "credit"));
      current = {
        key: `${branch}|${docType}|${invoice_no}|${date}`,
        invoice: {
          branch_name: branch,
          doc_type: docType,
          invoice_no,
          returned_invoice_no: String(cell(row, map, "returned_invoice_no") ?? "").trim() || null,
          date,
          year: +date.slice(0, 4),
          month: +date.slice(5, 7),
          party_name: String(cell(row, map, "party_name") ?? "").trim() || null,
          payment_method: String(cell(row, map, "payment_method") ?? "").trim() || null,
          total_qty: toNum(cell(row, map, "total_qty")),
          discount: toNum(cell(row, map, "discount")),
          total_amount: total,
          profit: toNum(cell(row, map, "profit")),
          paid_cash: paid,
          credit,
          due: credit || Math.max(total - paid, 0),
          warehouse_name: String(cell(row, map, "warehouse_name") ?? "").trim() || null,
        },
        items: [],
      };
      invoices.push(current);
      continue;
    }

    // سطر صنف تابع: أي سطر غير سطر فاتورة يحمل كود أو اسم صنف
    const itemName = String(cell(row, map, "item_name") ?? "").trim();
    const itemCode = String(cell(row, map, "item_code") ?? "").trim();
    if (current && (itemName || itemCode)) {
      current.items.push({
        branch_name: branch,
        date: current.invoice.date,
        year: current.invoice.year,
        item_code: itemCode || null,
        item_name: itemName || itemCode,
        unit: String(cell(row, map, "unit") ?? "").trim() || null,
        qty: toNum(cell(row, map, "total_qty")),
        price: toNum(cell(row, map, "price")),
        discount: toNum(cell(row, map, "discount")),
        profit: toNum(cell(row, map, "profit")),
        total: toNum(cell(row, map, "total_amount")),
      });
    } else if (!itemName && !itemCode) {
      skipped++;
    }
  }
  // ربح الفاتورة من مجموع أرباح الأصناف لو رأس الفاتورة فاضي/صفر
  for (const inv of invoices) {
    if (!inv.invoice.profit && inv.items.length) {
      inv.invoice.profit = inv.items.reduce((s, it) => s + toNum(it.profit), 0);
    }
  }
  return { invoices, vouchers: [], skipped };
}

/** يحلّل ملف أذون الصرف / القبض */
export function parseVoucherSheet(
  rows: any[][],
  branch: HistoricalBranch,
  voucherType: "expense" | "receipt",
): ParsedHistorical {
  const { map, headerRow } = detectHeader(rows);
  const dateCol = map.date ?? 1;
  const vouchers: any[] = [];
  let skipped = 0;
  let auto = 0;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (!row.some((c) => String(c ?? "").trim() !== "")) continue;
    const iso = parseCellDate(row[dateCol]);
    if (!isValidHistDate(iso)) { skipped++; continue; }
    const date = iso as string;
    auto++;
    const amount = toNum(cell(row, map, "amount") ?? cell(row, map, "total_amount"));
    const movement = String(cell(row, map, "movement_name") ?? "").trim();
    // تحديد النوع من عمود الحركة لو موجود، وإلا نوع الملف المختار
    const t = norm(movement) + " " + norm(cell(row, map, "category"));
    const type: "expense" | "receipt" = /صرف|مصروف/.test(t)
      ? "expense"
      : /قبض|تحصيل|ايراد/.test(t)
        ? "receipt"
        : voucherType;
    vouchers.push({
      branch_name: branch,
      voucher_type: type,
      movement_name: movement || null,
      voucher_no: String(cell(row, map, "voucher_no") ?? "").trim() || `AUTO-${voucherType}-${auto}`,
      date,
      year: +date.slice(0, 4),
      month: +date.slice(5, 7),
      amount,
      category: String(cell(row, map, "category") ?? "").trim() || "غير مبوّب",
      party_name: String(cell(row, map, "party_name") ?? "").trim() || null,
      treasury_name: String(cell(row, map, "treasury_name") ?? "").trim() || null,
      notes: String(cell(row, map, "notes") ?? "").trim() || null,
    });
  }
  return { invoices: [], vouchers, skipped };
}

export async function parseHistoricalFile(
  file: File,
  branch: HistoricalBranch,
  fileType: HistoricalFileType,
): Promise<ParsedHistorical> {
  const buf = await file.arrayBuffer();
  const rows = readSheet(buf);
  if (fileType === "expense" || fileType === "receipt") return parseVoucherSheet(rows, branch, fileType);
  return parseInvoiceSheet(rows, branch, fileType);
}

/* ---------------------------- batch upsert ------------------------------ */

export async function uploadHistorical(
  parsed: ParsedHistorical,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportResult> {
  const result: ImportResult = { invoices: 0, items: 0, vouchers: 0, skipped: parsed.skipped, errors: [] };

  // 1) الفواتير — Upsert مجمّع يمنع التكرار عند إعادة الرفع
  const invs = parsed.invoices;
  for (let i = 0; i < invs.length; i += BATCH) {
    const chunk = invs.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("historical_invoices")
      .upsert(chunk.map((x) => x.invoice), { onConflict: "branch_name,doc_type,invoice_no,date" })
      .select("id, branch_name, doc_type, invoice_no, date");
    if (error) { result.errors.push(error.message); continue; }
    result.invoices += data?.length ?? 0;

    const byKey = new Map<string, string>();
    (data ?? []).forEach((r: any) =>
      byKey.set(`${r.branch_name}|${r.doc_type}|${r.invoice_no}|${r.date}`, r.id),
    );

    // 2) الأصناف — حذف ثم إدراج لكل فاتورة (Idempotent)
    const ids = Array.from(byKey.values());
    if (ids.length) await supabase.from("historical_invoice_items").delete().in("invoice_id", ids);

    const items = chunk.flatMap((x) => {
      const id = byKey.get(x.key);
      return id ? x.items.map((it) => ({ ...it, invoice_id: id })) : [];
    });
    for (let j = 0; j < items.length; j += BATCH) {
      const { error: e2, count } = await supabase
        .from("historical_invoice_items")
        .insert(items.slice(j, j + BATCH), { count: "exact" });
      if (e2) result.errors.push(e2.message);
      else result.items += count ?? items.slice(j, j + BATCH).length;
    }
    onProgress?.({ phase: "رفع الفواتير والأصناف", done: Math.min(i + BATCH, invs.length), total: invs.length });
  }

  // 3) السندات
  const vs = parsed.vouchers;
  for (let i = 0; i < vs.length; i += BATCH) {
    const chunk = vs.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("historical_vouchers")
      .upsert(chunk, { onConflict: "branch_name,voucher_type,voucher_no,date,amount" })
      .select("id");
    if (error) result.errors.push(error.message);
    else result.vouchers += data?.length ?? 0;
    onProgress?.({ phase: "رفع السندات", done: Math.min(i + BATCH, vs.length), total: vs.length });
  }

  return result;
}
