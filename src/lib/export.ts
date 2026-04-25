import * as XLSX from "xlsx";

export function exportToExcel(filename: string, sheets: { name: string; rows: any[] }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows);
    // RTL
    if (!ws["!views"]) ws["!views"] = [{ RTL: true }];
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 30));
  }
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function printReport(title: string, html: string) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
    <title>${title}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
      *{box-sizing:border-box;font-family:'Cairo',sans-serif}
      body{padding:24px;color:#111}
      h1{margin:0 0 4px;font-size:22px}
      .meta{color:#666;font-size:12px;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px}
      th,td{border:1px solid #ddd;padding:8px;text-align:right}
      th{background:#f5f5f5;font-weight:700}
      .kpi{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
      .kpi>div{flex:1;min-width:140px;border:1px solid #ddd;border-radius:8px;padding:10px}
      .kpi b{display:block;font-size:18px;margin-top:4px}
      .pos{color:#16a34a}.neg{color:#dc2626}
      @media print{.no-print{display:none}}
    </style></head><body>
    <h1>${title}</h1>
    <div class="meta">تاريخ التقرير: ${new Date().toLocaleString("ar-EG")}</div>
    ${html}
    <button class="no-print" onclick="window.print()" style="position:fixed;top:10px;left:10px;padding:8px 16px;background:#3b82f6;color:#fff;border:0;border-radius:6px;cursor:pointer">طباعة / حفظ PDF</button>
    </body></html>`);
  w.document.close();
}
