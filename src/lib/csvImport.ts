import * as XLSX from "xlsx";

/**
 * أدوات استيراد CSV/Excel للبيانات الأساسية (ترحيل من نظام قديم).
 * عناوين الأعمدة بالعربي والإنجليزي جنب بعض: "اسم الفرع / Branch Name".
 */

export interface CsvColumn {
  key: string;
  ar: string;
  en: string;
  required?: boolean;
  type?: "string" | "number" | "date";
  /** شرح مختصر يظهر في جدول الأعمدة */
  note?: string;
}

export interface ParsedCsvRow<T = any> {
  index: number; // رقم الصف في الملف (بعد الهيدر)
  data: T;
  errors: string[];
}

export const headerOf = (c: CsvColumn) => `${c.ar} / ${c.en}`;

const norm = (s: string) =>
  String(s ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** يطابق الهيدر سواء كان بالصيغة المزدوجة أو بالعربي فقط أو بالإنجليزي فقط */
function matchHeader(cols: CsvColumn[], header: string): CsvColumn | undefined {
  const h = norm(header);
  return cols.find(
    (c) => norm(headerOf(c)) === h || norm(c.ar) === h || norm(c.en) === h || norm(c.key) === h,
  );
}

function csvEscape(v: any) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsvTemplate(cols: CsvColumn[], sample: Record<string, any>) {
  const head = cols.map((c) => csvEscape(headerOf(c))).join(",");
  const row = cols.map((c) => csvEscape(sample[c.key] ?? "")).join(",");
  return "\uFEFF" + head + "\r\n" + row + "\r\n";
}

export function downloadCsvTemplate(filename: string, cols: CsvColumn[], sample: Record<string, any>) {
  const blob = new Blob([buildCsvTemplate(cols, sample)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsvRows(filename: string, headers: string[], rows: (string | number)[][]) {
  const body = [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** قارئ CSV بسيط بيدعم علامات التنصيص والفواصل جوّه الخانة */
function splitCsv(text: string, delim: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delim) { row.push(cell); cell = ""; continue; }
    if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; continue; }
    if (ch === "\r") continue;
    cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => String(c).trim() !== ""));
}

function detectDelimiter(firstLine: string) {
  const counts: [string, number][] = [
    [",", (firstLine.match(/,/g) || []).length],
    [";", (firstLine.match(/;/g) || []).length],
    ["\t", (firstLine.match(/\t/g) || []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export interface ParseResult<T = any> {
  rows: ParsedCsvRow<T>[];
  fileHeaders: string[];
  missingRequired: CsvColumn[];
  unknownHeaders: string[];
}

function excelDateToISO(v: any): string | null {
  if (typeof v === "number" && v > 20000 && v < 60000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function parseTable<T = any>(matrix: string[][], cols: CsvColumn[]): ParseResult<T> {
  if (!matrix.length) return { rows: [], fileHeaders: [], missingRequired: cols.filter((c) => c.required), unknownHeaders: [] };
  const fileHeaders = matrix[0].map((h) => String(h ?? "").trim());
  const map = fileHeaders.map((h) => matchHeader(cols, h));
  const found = new Set(map.filter(Boolean).map((c) => c!.key));
  const missingRequired = cols.filter((c) => c.required && !found.has(c.key));
  const unknownHeaders = fileHeaders.filter((h, i) => h && !map[i]);

  const rows: ParsedCsvRow<T>[] = matrix.slice(1).map((cells, i) => {
    const data: any = {};
    const errors: string[] = [];
    for (const col of cols) {
      const idx = map.findIndex((c) => c?.key === col.key);
      const raw = idx >= 0 ? cells[idx] : "";
      const empty = raw === undefined || raw === null || String(raw).trim() === "";
      if (empty) {
        if (col.required) errors.push(`عمود «${col.ar}» مطلوب وفاضي`);
        data[col.key] = null;
        continue;
      }
      if (col.type === "number") {
        const n = Number(String(raw).replace(/[,\s٬]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
        if (Number.isNaN(n)) { errors.push(`«${col.ar}» لازم يكون رقم (القيمة: ${raw})`); data[col.key] = null; }
        else data[col.key] = n;
      } else if (col.type === "date") {
        const iso = excelDateToISO(raw);
        if (!iso) { errors.push(`«${col.ar}» تاريخ غير مفهوم (القيمة: ${raw})`); data[col.key] = null; }
        else data[col.key] = iso;
      } else {
        data[col.key] = String(raw).trim();
      }
    }
    return { index: i + 2, data, errors };
  });

  return { rows, fileHeaders, missingRequired, unknownHeaders };
}

export async function readImportFile<T = any>(file: File, cols: CsvColumn[]): Promise<ParseResult<T>> {
  const isExcel = /\.(xlsx|xls)$/i.test(file.name);
  if (isExcel) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: true, defval: "" }) as any;
    return parseTable<T>(matrix.map((r: any[]) => r.map((c) => (c === null || c === undefined ? "" : String(c)))), cols);
  }
  const text = await file.text();
  const delim = detectDelimiter(text.split(/\r?\n/)[0] ?? "");
  return parseTable<T>(splitCsv(text.replace(/^\uFEFF/, ""), delim), cols);
}

/** بيرجّع القيم المكررة في عمود معيّن جوّه نفس الملف */
export function findDuplicates<T>(rows: ParsedCsvRow<T>[], get: (d: any) => string | null | undefined) {
  const seen = new Map<string, number[]>();
  rows.forEach((r) => {
    const v = String(get(r.data) ?? "").trim().toLowerCase();
    if (!v) return;
    seen.set(v, [...(seen.get(v) ?? []), r.index]);
  });
  return [...seen.entries()].filter(([, idx]) => idx.length > 1);
}
