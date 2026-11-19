import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

/**
 * الأرشيف التاريخي (خارج السيستم — مش بيأثر على الخزنة ولا الحسابات ولا المخزون).
 * 0272 (owner 2026-11-19): الفرع اسم حر بيتقري من اسم ملف «سهل» («تقرير فواتير البيع ل معرض سكة تلة سنة 2025»)
 * ويتعدل قبل الرفع؛ نوع الملف من أول خلية في الشيت («بيع» / «شراء» / «مرتجع بيع» / «مرتجع شراء» / «قبض» / «صرف»).
 */
export type HistoricalBranch = string;

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

const BATCH = 100;

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
    // Excel day number (1900 system): day 25569 = 1970-01-01; the time part is dropped
    return fmt(new Date(Math.round((Math.floor(v) - 25569) * 86400000)));
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
  // «سهل» names the customer / supplier column «الحساب»
  party_name: ["الحساب", "اسم العميل", "اسم المورد", "العميل", "المورد", "الطرف", "الاسم"],
  payment_method: ["طريقه السداد", "طريقه الدفع", "السداد", "الدفع"],
  total_qty: ["اجمالي الكميه", "الكميه", "كميه"],
  discount: ["الخصم", "خصم"],
  total_amount: ["النهائي", "الاجمالي", "اجمالي", "الصافي", "المجموع", "القيمه", "total", "net", "grand total"],
  profit: ["الربح", "ربح", "المكسب"],
  // «مسدد نقدا» = كل اللي اتدفع مع الفاتورة؛ «درج النقدية» عمود خزنة واحدة بس — مش هو
  paid_cash: ["مسدد نقدا", "المسدد", "المدفوع"],
  credit: ["الاجل", "اجل", "المتبقي", "الباقي"],
  warehouse_name: ["المخزن", "المستودع"],
  item_code: ["كود الصنف", "الكود", "كود"],
  item_name: ["اسم الصنف", "الصنف", "البيان", "المنتج"],
  unit: ["الوحده", "وحده"],
  price: ["السعر", "سعر البيع", "سعر الشراء", "سعر"],
  // vouchers
  voucher_no: ["رقم الحركه", "رقم السند", "رقم الاذن", "السند"],
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
    const cells = (rows[r] ?? []).map((cell) => norm(cell).toLowerCase());
    const taken = new Set<number>();
    // exact header names first («رقم الحركه» is the voucher number, not «رقم»), then «contains»
    for (const exact of [true, false]) {
      cells.forEach((t, c) => {
        if (!t || t.length > 40 || taken.has(c)) return;
        for (const [key, words] of Object.entries(KEYS)) {
          if (map[key] !== undefined) continue;
          if (words.some((w) => { const wl = norm(w).toLowerCase(); return exact ? t === wl : t.includes(wl); })) {
            map[key] = c;
            taken.add(c);
            score++;
            break;
          }
        }
      });
    }
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

export function readSheet(file: ArrayBuffer | Uint8Array): any[][] {
  // dates stay Excel day numbers (no time zone): a Date object made in Cairo shifted 15/11 to 14/11
  const wb = XLSX.read(file, { type: "array", cellDates: false });
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
      const isReturn = docType === "sales_returns" || docType === "purchase_returns";
      const invNoRaw = String(cell(row, map, "invoice_no") ?? "").trim();
      const returnedRaw =
        String(cell(row, map, "returned_invoice_no") ?? "").trim() || (isReturn ? invNoRaw : "");
      // 0272: «رقم الفاتورة» هو رقم المستند (المرتجع كمان) — العمود الأول مجرد رقم السطر في التقرير وبيبدأ من 1 في كل ملف
      const invoice_no = invNoRaw || (isReturn ? serial : "") || `AUTO-${docType}-${auto}`;
      const total = toNum(cell(row, map, "total_amount"));
      const paid = toNum(cell(row, map, "paid_cash"));
      const credit = toNum(cell(row, map, "credit"));
      current = {
        key: `${branch}|${docType}|${invoice_no}|${date}`,
        invoice: {
          branch_name: branch,
          doc_type: docType,
          invoice_no,
          returned_invoice_no: returnedRaw || null,
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

    // سطر صنف تابع: عمود 0 فاضي + كود واسم صنف موجودين
    const codeRaw = row[1];
    const nameRaw = row[2];
    const hasPositionalItem =
      serial === "" &&
      codeRaw !== undefined && codeRaw !== null && String(codeRaw).trim() !== "" &&
      nameRaw !== undefined && nameRaw !== null && String(nameRaw).trim() !== "" &&
      String(codeRaw).trim() !== "رقم الصنف";

    const mappedName = String(cell(row, map, "item_name") ?? "").trim();
    const mappedCode = String(cell(row, map, "item_code") ?? "").trim();

    if (current && (hasPositionalItem || mappedName || mappedCode)) {
      const item_code = hasPositionalItem ? String(codeRaw).trim() : mappedCode || null;
      const item_name = hasPositionalItem ? String(nameRaw).trim() : mappedName || mappedCode;
      const qty = hasPositionalItem ? toNum(row[5]) : toNum(cell(row, map, "total_qty"));
      const price = hasPositionalItem ? toNum(row[6]) : toNum(cell(row, map, "price"));
      const discount = hasPositionalItem ? toNum(row[7]) : toNum(cell(row, map, "discount"));
      const profit = hasPositionalItem ? toNum(row[8]) : toNum(cell(row, map, "profit"));
      const total = hasPositionalItem
        ? toNum(row[9]) || toNum(row[8])
        : toNum(cell(row, map, "total_amount"));
      current.items.push({
        branch_name: branch,
        date: current.invoice.date,
        year: current.invoice.year,
        item_code: item_code || null,
        item_name,
        unit: hasPositionalItem
          ? String(row[3] ?? "").trim() || null
          : String(cell(row, map, "unit") ?? "").trim() || null,
        qty,
        price,
        discount,
        profit,
        total,
      });
    } else {
      skipped++;
    }
  }
  // ربح الفاتورة من مجموع أرباح الأصناف لو رأس الفاتورة فاضي/صفر
  for (const inv of invoices) {
    if (!inv.invoice.profit && inv.items.length) {
      inv.invoice.profit = inv.items.reduce((s, it) => s + toNum(it.profit), 0);
    }
  }
  return { invoices: dedupeInvoices(invoices), vouchers: [], skipped };
}

/** يمنع تكرار (branch, doc_type, invoice_no, date) داخل نفس الدفعة */
function dedupeInvoices(list: ParsedInvoice[]): ParsedInvoice[] {
  const byKey = new Map<string, ParsedInvoice>();
  for (const inv of list) {
    const prev = byKey.get(inv.key);
    if (!prev) { byKey.set(inv.key, inv); continue; }
    // دمج: نجمع القيم والأصناف في سجل واحد
    prev.items.push(...inv.items);
    const a = prev.invoice, b = inv.invoice;
    a.total_qty = toNum(a.total_qty) + toNum(b.total_qty);
    a.discount = toNum(a.discount) + toNum(b.discount);
    a.total_amount = toNum(a.total_amount) + toNum(b.total_amount);
    a.profit = toNum(a.profit) + toNum(b.profit);
    a.paid_cash = toNum(a.paid_cash) + toNum(b.paid_cash);
    a.credit = toNum(a.credit) + toNum(b.credit);
    a.due = toNum(a.due) + toNum(b.due);
    a.returned_invoice_no = a.returned_invoice_no ?? b.returned_invoice_no;
    a.party_name = a.party_name ?? b.party_name;
  }
  return Array.from(byKey.values());
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

  // 1) الفواتير — Upsert مجمّع (بعد تنقية التكرار) يمنع خطأ ON CONFLICT
  const invs = dedupeInvoices(parsed.invoices);
  for (let i = 0; i < invs.length; i += BATCH) {
    const chunk = invs.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("historical_invoices")
      .upsert(chunk.map((x) => x.invoice), { onConflict: "tenant_id,branch_name,doc_type,invoice_no,date" })
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

  // 3) السندات — تنقية التكرار داخل نفس الدفعة
  const vMap = new Map<string, any>();
  for (const v of parsed.vouchers) {
    vMap.set(`${v.branch_name}|${v.voucher_type}|${v.voucher_no}|${v.date}|${v.amount}`, v);
  }
  const vs = Array.from(vMap.values());
  for (let i = 0; i < vs.length; i += BATCH) {
    const chunk = vs.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("historical_vouchers")
      .upsert(chunk, { onConflict: "tenant_id,branch_name,voucher_type,voucher_no,date,amount" })
      .select("id");
    if (error) result.errors.push(error.message);
    else result.vouchers += data?.length ?? 0;
    onProgress?.({ phase: "رفع السندات", done: Math.min(i + BATCH, vs.length), total: vs.length });
  }

  return result;
}


/* ------------------------- «سهل» file detection (0272) ------------------------- */

const SAHL_KIND: Record<string, HistoricalFileType> = {
  "بيع": "sales", "شراء": "purchases", "مرتجع بيع": "sales_returns", "مرتجع شراء": "purchase_returns",
  "قبض": "receipt", "صرف": "expense",
};

/** نوع الملف من أول خلية في شيت «سهل»، وإلا من اسم الملف («فواتير البيع» / «مرتجع الشراء» …). */
export function sahlKind(rows: any[][], fileName = ""): HistoricalFileType | null {
  const first = norm(rows?.[0]?.[0]);
  for (const [label, kind] of Object.entries(SAHL_KIND)) if (first === norm(label)) return kind;
  const n = norm(fileName);
  if (/مرتجع (ال)?بيع/.test(n)) return "sales_returns";
  if (/مرتجع (ال)?شراء/.test(n)) return "purchase_returns";
  if (/(فواتير|فاتوره) (ال)?بيع/.test(n)) return "sales";
  if (/(فواتير|فاتوره) (ال)?شراء/.test(n)) return "purchases";
  if (/(ال)?قبض/.test(n)) return "receipt";
  if (/(ال)?صرف/.test(n)) return "expense";
  return null;
}

/** الفرع من اسم ملف «سهل»: «تقرير فواتير البيع ل معرض سكة تلة سنة 2025.xlsx» → «معرض سكة تلة». */
export function sahlBranchFromName(fileName: string): string {
  const base = String(fileName ?? "").split(/[\\/#]/).pop()!.replace(/\.(xlsx|xls)$/i, "");
  const m = base.match(/\sل\s*(.+?)(?:\s*(?:سنة|سنه|من)\s+[\d٠-٩]|$)/);
  return (m ? m[1] : "").replace(/\s+/g, " ").replace(/^م(معرض)/, "$1").trim();
}

/** «مخزن شلبى» = «مخزن شلبي»، «سكة تله» = «سكة تلة»، «عبدالمنعم» = «عبد المنعم»: نفس الفرع اللي في الأرشيف بنفس اسمه. */
export function matchKnownBranch(name: string, known: string[]): string {
  const key = (x: string) => norm(x).replace(/\s+/g, "");
  const k = key(name);
  return known.find((b) => key(b) === k) ?? name.trim();
}

export interface SahlFilePlan {
  fileName: string;
  sha256: string;
  kind: HistoricalFileType | null;
  branch: string;
  dateFrom: string | null;
  dateTo: string | null;
  parsed: ParsedHistorical;
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
  return Array.from(h).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** يقرا ملف «سهل» ويطلع نوعه وفرعه وفترته من غير ما تختار حاجة. */
export function planSahlFile(fileName: string, bytes: ArrayBuffer | Uint8Array, sha256: string, branchOverride?: string): SahlFilePlan {
  const rows = readSheet(bytes);
  const kind = sahlKind(rows, fileName);
  const branch = (branchOverride ?? sahlBranchFromName(fileName)).trim();
  const parsed: ParsedHistorical = !kind || !branch
    ? { invoices: [], vouchers: [], skipped: rows.length }
    : kind === "expense" || kind === "receipt"
      ? parseVoucherSheet(rows, branch, kind)
      : parseInvoiceSheet(rows, branch, kind);
  const days = [...parsed.invoices.map((i) => i.invoice.date as string), ...parsed.vouchers.map((v) => v.date as string)].sort();
  return { fileName, sha256, kind, branch, dateFrom: days[0] ?? null, dateTo: days[days.length - 1] ?? null, parsed };
}

/** نفس الخطة بفرع تاني (المالك عدّل اسم الفرع قبل الرفع). */
export function withBranch(plan: SahlFilePlan, branch: string): SahlFilePlan {
  const b = branch.trim();
  const fix = (o: any) => ({ ...o, branch_name: b });
  return {
    ...plan, branch: b,
    parsed: {
      ...plan.parsed,
      invoices: plan.parsed.invoices.map((x) => ({
        key: x.key.replace(/^[^|]*/, b), invoice: fix(x.invoice), items: x.items.map(fix),
      })),
      vouchers: plan.parsed.vouchers.map(fix),
    },
  };
}

/** عدد المستندات والسطور اللي في الخطة. */
export function planCounts(plan: SahlFilePlan) {
  return {
    docs: plan.parsed.invoices.length + plan.parsed.vouchers.length,
    items: plan.parsed.invoices.reduce((s, i) => s + i.items.length, 0),
    total: plan.parsed.invoices.reduce((s, i) => s + toNum(i.invoice.total_amount), 0)
      + plan.parsed.vouchers.reduce((s, v) => s + toNum(v.amount), 0),
  };
}

/**
 * يرفع ملف «سهل» واحد: لو نفس الملف (SHA-256) اترفع قبل كده يتخطى؛ غير كده يشيل اللي في الأرشيف لنفس الفرع والنوع
 * في نفس الفترة (عشان الملف الجديد هو المرجع ومفيش تكرار مع رفعة قديمة) وبعدين يرفع ويسجّل الملف.
 */
export async function uploadSahlPlan(plan: SahlFilePlan, onProgress?: (p: ImportProgress) => void):
  Promise<ImportResult & { status: "done" | "duplicate" | "empty"; replaced: number }> {
  const empty = { invoices: 0, items: 0, vouchers: 0, skipped: plan.parsed.skipped, errors: [] as string[], replaced: 0 };
  if (!plan.kind || !plan.dateFrom || !plan.dateTo) return { ...empty, status: "empty" };
  const { data: seen } = await supabase.from("historical_archive_files" as any).select("id").eq("sha256", plan.sha256).maybeSingle();
  if (seen) return { ...empty, status: "duplicate" };

  let replaced = 0;
  const isVoucher = plan.kind === "expense" || plan.kind === "receipt";
  const table = isVoucher ? "historical_vouchers" : "historical_invoices";
  const typeCol = isVoucher ? "voucher_type" : "doc_type";
  const { count } = await supabase.from(table as any).select("id", { count: "exact", head: true })
    .eq("branch_name", plan.branch).eq(typeCol, plan.kind).gte("date", plan.dateFrom).lte("date", plan.dateTo);
  if (count) {
    const { error } = await supabase.from(table as any).delete()
      .eq("branch_name", plan.branch).eq(typeCol, plan.kind).gte("date", plan.dateFrom).lte("date", plan.dateTo);
    if (error) return { ...empty, status: "done", errors: [`مقدرتش أشيل الرفعة القديمة لنفس الفترة: ${error.message}`] };
    replaced = count;
  }
  const res = await uploadHistorical(plan.parsed, onProgress);
  if (!res.errors.length) {
    const { error } = await supabase.from("historical_archive_files" as any).insert({
      sha256: plan.sha256, file_name: plan.fileName, branch_name: plan.branch, kind: plan.kind,
      date_from: plan.dateFrom, date_to: plan.dateTo, rows_count: res.invoices + res.vouchers, replaced_count: replaced,
    } as any);
    if (error) res.errors.push(error.message);
  }
  return { ...res, status: "done", replaced };
}
