// Mobile cards (owner 2026-11-16): below 768 px a `mobileCards` table shows its rows as cards with «title … value»,
// a row hidden by the Excel filter stays hidden, a hidden column stays hidden; on desktop the table is unchanged.
// Run: npx vite --host 127.0.0.1 --port 4174 & then: node e2e/mobile-cards.ui.cjs
const { chromium } = require("playwright");
const OUT = process.env.OUT_DIR || __dirname;
const URL = "http://127.0.0.1:4174/e2e/harness/mobile-cards.html";
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errors = [];
  for (const [w, h, name] of [[390, 844, "phone"], [1280, 800, "desktop"]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(URL);
    await page.waitForSelector("table[data-mcard] tbody tr");
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => {
      const t = document.querySelector("table[data-mcard]");
      const tr = t.tBodies[0].rows[0];
      const td = tr.cells[2];
      return {
        tableDisplay: getComputedStyle(t).display, trDisplay: getComputedStyle(tr).display, tdDisplay: getComputedStyle(td).display,
        label: td.getAttribute("data-label"), before: getComputedStyle(td, "::before").content,
        tableW: t.getBoundingClientRect().width, vw: innerWidth, docW: document.documentElement.scrollWidth,
        ptDisplay: getComputedStyle(document.querySelector("#pt")).display,
        ptLabel: document.querySelector("#pt tbody td:nth-child(2)").getAttribute("data-label"),
      };
    });
    if (name === "phone") {
      ok(info.tableDisplay === "block" && info.trDisplay === "block" && info.tdDisplay === "flex", "phone: rows are cards");
      ok(info.label === "اسم الحساب" && info.before.includes("اسم الحساب"), "phone: each value shows its column title");
      ok(info.docW <= info.vw + 1, `phone: no sideways scroll (page ${info.docW} / screen ${info.vw})`);
      ok(info.ptDisplay === "block" && info.ptLabel === "الصنف", "phone: PermTable cards too");
      // a row hidden by the Excel filter stays hidden
      await page.evaluate(() => { const tr = document.querySelector("table[data-mcard] tbody tr:nth-child(2)"); tr.hidden = true; });
      ok(await page.evaluate(() => getComputedStyle(document.querySelector("table[data-mcard] tbody tr:nth-child(2)")).display) === "none", "phone: a filtered-out row stays hidden");
      // a column hidden by «الأعمدة» / permissions (unlayered !important) stays hidden
      await page.evaluate(() => { const s = document.createElement("style"); s.textContent = `table[data-mcard] > * > tr > :nth-child(3) { display: none !important; }`; document.head.appendChild(s); });
      ok(await page.evaluate(() => getComputedStyle(document.querySelector("table[data-mcard] tbody tr").cells[2]).display) === "none", "phone: a hidden column stays hidden");
      await page.evaluate(() => document.querySelector("table[data-mcard] tbody tr:nth-child(2)").hidden = false);
    } else {
      ok(info.tableDisplay === "table" && info.trDisplay === "table-row" && info.tdDisplay === "table-cell", "desktop: ordinary table");
      ok(info.ptDisplay === "table", "desktop: PermTable unchanged");
    }
    await page.screenshot({ path: `${OUT}/mcard-${name}.png`, fullPage: true });
    await page.close();
  }
  ok(errors.length === 0, `no page errors ${errors.join(" | ")}`);
  await browser.close();
  console.log(fails ? `${fails} FAILED` : "ALL OK");
  process.exit(fails ? 1 : 0);
})();
