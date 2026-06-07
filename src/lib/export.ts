import * as XLSX from "xlsx";

export function exportToExcel(filename: string, sheets: { name: string; rows: any[] }[]) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows);
    if (!ws["!views"]) ws["!views"] = [{ RTL: true }];
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 30));
  }
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * Shared print stylesheet used for every PDF/print window in the app.
 * - Cairo Arabic font preloaded and we wait for it before triggering print
 * - A4 size with safe margins
 * - Tables: repeat <thead> on each page, never split a row, never split a heading from next block
 */
const PRINT_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { font-family: 'Cairo', 'Tahoma', sans-serif; color: #111; background: #fff; }
  body { padding: 0; margin: 0; }
  .page { padding: 4px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  h2 { font-size: 18px; margin: 16px 0 8px; page-break-after: avoid; break-after: avoid; }
  h3 { font-size: 15px; margin: 14px 0 6px; page-break-after: avoid; break-after: avoid; }
  h4 { font-size: 13px; margin: 10px 0 4px; page-break-after: avoid; break-after: avoid; }
  p { margin: 4px 0; }
  .meta { color: #666; font-size: 12px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 12px; page-break-inside: auto; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th, td { border: 1px solid #d4d4d4; padding: 6px 8px; text-align: right; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 700; }
  tbody tr:nth-child(even) td { background: #fafafa; }
  .kpi { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; page-break-inside: avoid; }
  .kpi > div { flex: 1; min-width: 140px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; background: #fafafa; }
  .kpi b { display: block; font-size: 18px; margin-top: 4px; }
  .pos { color: #16a34a; } .neg { color: #dc2626; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; page-break-inside: avoid; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; page-break-inside: avoid; }
  .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
  .row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12.5px; }
  .row span:first-child { color: #555; }
  .row b { color: #111; }
  .muted { color: #666; font-size: 11.5px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; background: #eef2ff; color: #3730a3; }
  hr { border: 0; border-top: 1px solid #e5e7eb; margin: 10px 0; }
  img { max-width: 100%; }
  .avoid-break { page-break-inside: avoid; break-inside: avoid; }
  .no-print { display: none !important; }
  .print-bar {
    position: fixed; top: 10px; left: 10px; display: flex; gap: 8px; z-index: 9999;
  }
  .print-bar button {
    padding: 8px 14px; background: #3b82f6; color: #fff; border: 0; border-radius: 6px;
    cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600;
  }
  .print-bar button.secondary { background: #6b7280; }
  @media print { .print-bar { display: none !important; } }
`;

export function printReport(title: string, html: string, opts?: { landscape?: boolean }) {
  const w = window.open("", "_blank", "width=1000,height=800");
  if (!w) return;
  const orientation = opts?.landscape ? "landscape" : "portrait";
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
    <title>${title}</title>
    <style>${PRINT_STYLES}
      @page { size: A4 ${orientation}; margin: 14mm 12mm; }
    </style></head><body>
    <div class="page">
      <h1>${title}</h1>
      <div class="meta">تاريخ التقرير: ${new Date().toLocaleString("ar-EG")}</div>
      ${html}
    </div>
    <div class="print-bar">
      <button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
      <button class="secondary" onclick="window.close()">إغلاق</button>
    </div>
    <script>
      (async function(){
        try { if (document.fonts && document.fonts.ready) { await document.fonts.ready; } } catch(e){}
        // Give layout one tick to settle (esp. tables/images)
        setTimeout(function(){ window.focus(); window.print(); }, 250);
      })();
    </script>
    </body></html>`);
  w.document.close();
}

/**
 * Print arbitrary HTML using the shared print stylesheet but without the report wrapper.
 * Use this for invoices, shipments, vouchers — anywhere the caller fully controls layout.
 */
export function printHtml(title: string, bodyHtml: string, opts?: { landscape?: boolean }) {
  const w = window.open("", "_blank", "width=1000,height=800");
  if (!w) return;
  const orientation = opts?.landscape ? "landscape" : "portrait";
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
    <title>${title}</title>
    <style>${PRINT_STYLES}
      @page { size: A4 ${orientation}; margin: 14mm 12mm; }
    </style></head><body>
    <div class="page">${bodyHtml}</div>
    <div class="print-bar">
      <button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
      <button class="secondary" onclick="window.close()">إغلاق</button>
    </div>
    <script>
      (async function(){
        try { if (document.fonts && document.fonts.ready) { await document.fonts.ready; } } catch(e){}
        setTimeout(function(){ window.focus(); window.print(); }, 250);
      })();
    </script>
    </body></html>`);
  w.document.close();
}
