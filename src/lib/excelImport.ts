import * as XLSX from "xlsx";

export interface ImportColumn {
  key: string;          // field name in output row
  header: string;       // header in Arabic for the template/excel
  required?: boolean;
  type?: "string" | "number" | "date";
}

export interface ParsedRow<T = any> {
  index: number;        // 1-based row index in the sheet (header excluded)
  data: T;
  errors: string[];
}

export function downloadTemplate(filename: string, columns: ImportColumn[], sampleRow?: Record<string, any>) {
  const headers = columns.map((c) => c.header);
  const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow ? columns.map((c) => sampleRow[c.key] ?? "") : []]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Template");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export async function parseExcelFile<T = any>(file: File, columns: ImportColumn[]): Promise<ParsedRow<T>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return json.map((raw, i) => {
    const data: any = {};
    const errors: string[] = [];
    for (const col of columns) {
      const v = raw[col.header];
      const empty = v === "" || v === null || v === undefined;
      if (col.required && empty) {
        errors.push(`عمود "${col.header}" مطلوب`);
        continue;
      }
      if (empty) { data[col.key] = null; continue; }
      if (col.type === "number") {
        const n = Number(v);
        if (Number.isNaN(n)) errors.push(`"${col.header}" يجب أن يكون رقم`);
        data[col.key] = n;
      } else if (col.type === "date") {
        const d = new Date(v);
        if (isNaN(d.getTime())) errors.push(`"${col.header}" تاريخ غير صحيح`);
        data[col.key] = d.toISOString().slice(0, 10);
      } else {
        data[col.key] = String(v).trim();
      }
    }
    return { index: i + 2, data, errors };
  });
}
