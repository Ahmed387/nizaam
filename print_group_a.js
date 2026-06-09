const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const htmlPath = path.resolve('/tmp/group_a_report.html');
  const outputPath = '/mnt/documents/مجموعة_A_مشاكل_لوجيك_مالية_حرجة.pdf';

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });

  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div style="font-size:9px; width:100%; text-align:center; padding: 8px 0; color:#666;">NexaStore ERP — تقرير المشاكل المالية الحرجة</div>',
    footerTemplate: '<div style="font-size:9px; width:100%; text-align:center; padding: 8px 0; color:#666;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
  });

  await browser.close();
  console.log('PDF created at:', outputPath);
})();
