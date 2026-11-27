// UI test of column resizing like the ETA portal video (owner 2026-11-27 «اعمل زيها بالظبط … على كل جداول السيستم»):
// nothing shows at rest, a thin line + ↔ near a border (grabbable from both sides), live resize, the other columns keep
// their widths, one line + «…» with the full text on hover, minimum 36 px, kept after reload, double-click resets.
// The layer is ONE component (ColumnResizeLayer) on every table: DataTable, PermTable / ui/table and hand-written tables.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/column-resize.ui.cjs
const { chromium } = require("playwright");
const OUT = process.env.OUT_DIR || __dirname;
const BASE = "http://127.0.0.1:4173";
const SB = "https://kkfiplnucefytutlwaiz.supabase.co";
const REF = "kkfiplnucefytutlwaiz";
const T = "5316fbfe-b862-4c91-b48b-1d81c8aa5a71";
const OWNER = "85c76e60-3d27-4a99-8cd7-c8f8b39d914a";
const B1 = "f2b47364-0000-4000-8000-000000000001";

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.sig`;

const base = { status: "Valid", status_reason: "", seen_at: "2026-11-14T23:51:05Z", has_detail: false, cancel_requested: false, reject_requested: false, match_note: null, total_discount: 0 };
const DOCS = [
  { ...base, id: "d1", eta_uuid: "AAAAAAAAAAAA01", internal_id: "9405720531", type_name: "I", issuer_id: "200301950", issuer_name: "شركة فريش اليكتريك للأجهزة المنزلية",
    date_issued: "2026-11-04T10:00:00Z", date_received: "2026-11-04T10:01:00Z", net_amount: 13811.4, vat: 1933.6, total: 15745, public_url: "https://invoicing.eta.gov.eg/documents/x", linked: true,
    match_mode: "auto", match: { shipment_id: "s1", number: "PO24941", branch_id: B1, branch: "مكتب ومخزن شلبى", contact: "شركة فريش", date: "2026-11-09", total: 15745, status: "active", diff: 0, days: 5 } },
  { ...base, id: "d2", eta_uuid: "AAAAAAAAAAAA02", internal_id: "9405743485", type_name: "I", issuer_id: "200301950", issuer_name: "شركة فريش اليكتريك للأجهزة المنزلية",
    date_issued: "2026-11-14T09:39:41Z", date_received: "2026-11-14T09:40:15Z", net_amount: 80909.67, vat: 11327.35, total: 92237.02, public_url: null, linked: true, match_mode: null, match: null, seen_at: null },
  { ...base, id: "d3", eta_uuid: "AAAAAAAAAAAA03", internal_id: "INV/2026/12243", type_name: "I", issuer_id: "729238687", issuer_name: "شركة صادكو للتجارة والتوكيلات",
    date_issued: "2026-11-12T00:00:00Z", date_received: "2026-11-12T09:43:05Z", net_amount: 292982.4, vat: 41017.54, total: 333999.94, public_url: null, linked: false, match_mode: null, match: null },
  { ...base, id: "d4", eta_uuid: "AAAAAAAAAAAA04", internal_id: "10147065", type_name: "C", issuer_id: "431184372", issuer_name: "اليكترولكس مصر للاجهزه المنزليه",
    date_issued: "2026-10-26T00:00:00Z", date_received: "2026-10-26T09:00:00Z", net_amount: 6078.95, vat: 851.05, total: 6930, public_url: null, linked: false, match_mode: null, match: null },
  { ...base, id: "d5", eta_uuid: "AAAAAAAAAAAA05", internal_id: "18521460210262", type_name: "I", issuer_id: "205010725", issuer_name: "Vodafone Egypt Telecommunications",
    date_issued: "2026-10-28T00:00:00Z", date_received: "2026-10-28T09:00:00Z", net_amount: 1671.89, vat: 234.06, total: 1905.95, public_url: null, linked: false, match_mode: "ignored", match_note: "مش فاتورة شراء", match: null },
];
const ISSUERS = [
  { issuer_id: "729238687", issuer_name: "شركة صادكو للتجارة والتوكيلات", count: 9, total: 3208639.98, matched: 0, ignored: 0, open: 9, links: [], suggest: [] },
  { issuer_id: "315171634", issuer_name: "قنوات للتجاره والتوزيع", count: 4, total: 2517035.09, matched: 0, ignored: 0, open: 4, links: [], suggest: [{ id: "c-qanawat", name: "شركة قنوات" }] },
  { issuer_id: "200301950", issuer_name: "شركة فريش اليكتريك للأجهزة المنزلية", count: 17, total: 775802.06, matched: 10, ignored: 0, open: 7,
    links: [{ id: "c-fresh", name: "شركة فريش (بوتاجاز / الغسالات الهاف و الاوتوماتيك/الشاشات)" }], suggest: [{ id: "c-fresh-ac", name: "شركة فريش (تكييف)" }] },
];
const DETAIL = { document: { invoiceLines: [{ description: "غسالة حوض واحد 5ك شطورة", internalCode: "000000000500001928", itemCode: "6221103003994", quantity: 5, unitType: "EA",
  unitValue: { amountEGP: 2762.28 }, discount: { amount: 0 }, itemsDiscount: 0, netTotal: 13811.4, total: 15745, taxableItems: [{ amount: 1933.6, rate: 14 }] }] } };
const SETTINGS = { env: "prod", unseen: 1, enabled: true, is_owner: true, client_id: "3dfe848b-xxxx", documents: 35, has_secret: true, last_error: null,
  last_sync_at: new Date(Date.now() - 18 * 60_000).toISOString(), synced_until: "2026-11-15T06:07:02Z", connection_error: null,
  next_sync_at: new Date(Date.now() + 42 * 60_000).toISOString(), manual_ready_at: null, connection_ok_at: "2026-11-14T23:48:51Z", connection_checked_at: "2026-11-14T23:48:51Z" };

function makeDb() {
  return {
    calls: [],
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true }],
    user_roles: [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T }],
    branch_users: [],
    branches: [{ id: B1, name: "مكتب ومخزن شلبى", code: "FR-005", tenant_id: T, is_active: true, is_system: false, platform_paused: false, low_balance_threshold: 0 }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [], role_permissions: [], user_permissions: [], permission_templates: [], notifications: [],
  };
}

function filt(rows, url) {
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(k) || k.includes(".")) continue;
    const m = /^(eq|neq|is|in)\.(.*)$/.exec(v);
    if (!m) continue;
    const [, op, raw] = m;
    rows = rows.filter((r) => {
      const x = r[k];
      if (op === "eq") return x === undefined || String(x) === raw;
      if (op === "neq") return String(x) !== raw;
      if (op === "is") return raw === "null" ? x === null || x === undefined : String(x) === raw;
      return raw.replace(/[()"]/g, "").split(",").includes(String(x));
    });
  }
  return rows;
}

async function open(browser, db) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar-EG" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => db.calls.push({ pageerror: String(e).slice(0, 300) }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(`${SB}/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    const json = (d, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
    if (path.startsWith("/auth/v1/user")) return json({ id: OWNER, aud: "authenticated", app_metadata: {}, user_metadata: {} });
    if (path.startsWith("/auth/v1/")) return json({});
    if (path.startsWith("/functions/v1/eta-sync")) { db.calls.push({ fn: "eta-sync", body: req.postDataJSON() }); return json({ ok: true, sample: 10 }); }
    if (path.startsWith("/functions/v1/")) return json({ ok: true });
    if (path.startsWith("/rest/v1/rpc/")) {
      const name = path.split("/").pop(); let body = {}; try { body = req.postDataJSON() || {}; } catch {}
      db.calls.push({ rpc: name, body });
      if (name === "eta_settings_get") return json(SETTINGS);
      if (name === "eta_sync_now") {
        // the pull finishes "on the server": the next read sees a new last pull, one more document, and the 2-minute wait
        setTimeout(() => { SETTINGS.last_sync_at = new Date().toISOString(); SETTINGS.documents = 36; }, 1500);
        SETTINGS.manual_ready_at = new Date(Date.now() + 120_000).toISOString();
        return json({ ok: true });
      }
      if (name === "eta_documents_list") return json(DOCS);
      if (name === "eta_issuers") return json(ISSUERS);
      if (name === "eta_document_detail") return json({ eta_uuid: "x", detail: DETAIL, detail_at: "2026-11-15T06:00:00Z" });
      if (name === "eta_shipment_candidates") return json([
        { shipment_id: "s9", number: "PO25010", branch: "مكتب ومخزن شلبى", contact: "شركة فريش", date: "2026-11-15", total: 92237, diff: -0.02, taken: false },
        { shipment_id: "s8", number: "PO24990", branch: "مكتب ومخزن شلبى", contact: "شركة فريش", date: "2026-11-13", total: 90000, diff: -2237.02, taken: true },
      ]);
      if (name === "eta_set_match" || name === "eta_link_issuer" || name === "eta_mark_seen") return json(name === "eta_link_issuer" ? { matched: 2 } : null);
      return json(null);
    }
    if (path.startsWith("/rest/v1/")) {
      const table = path.split("/").pop(); const method = req.method();
      if (method !== "GET" && method !== "HEAD") return json([]);
      const rows = filt(db[table] ?? [], url);
      const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
      if (single) return rows.length ? json(rows[0]) : route.fulfill({ status: 406, contentType: "application/json", body: JSON.stringify({ code: "PGRST116", message: "0 rows" }) });
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }, body: JSON.stringify(rows) });
    }
    return json({});
  });
  const sess = { access_token: jwt(OWNER), refresh_token: "r", token_type: "bearer", expires_in: 31536000, expires_at: 4102444800, user: { id: OWNER, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } };
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(sess)]);
  return { ctx, page };
}


const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
const settle = async (page) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(900); };
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });

// widths of the first table's titles, by title text
const widths = (page) => page.evaluate(() => {
  const t = document.querySelector("table[data-cr]");
  const out = {};
  t.querySelectorAll(":scope > thead > tr:last-child > th").forEach((th, i) => {
    const label = (th.querySelector("[data-perm-label]")?.textContent ?? th.textContent ?? "").replace(/\s+/g, " ").trim() || `#${i}`;
    out[label] = Math.round(th.getBoundingClientRect().width);
  });
  out.__table = Math.round(t.getBoundingClientRect().width);
  return out;
});
const th = (page, label) => page.locator("table[data-cr] thead th").filter({ hasText: label }).first();

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const db = makeDb();
  const { page } = await open(browser, db);
  await page.goto(`${BASE}/admin/eta-invoices`); await settle(page);
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("colw:")).forEach((k) => localStorage.removeItem(k)));
  await page.reload(); await settle(page);

  // 1. at rest nothing shows; every title has its grip(s)
  const grips = await page.evaluate(() => {
    const t = document.querySelector("table[data-cr]");
    const ths = t.querySelectorAll(":scope > thead > tr:last-child > th");
    const lines = Array.from(t.querySelectorAll('[data-cr-grip] > span')).map((s) => getComputedStyle(s).opacity);
    return { ths: ths.length, ends: t.querySelectorAll('[data-cr-grip="end"]').length, starts: t.querySelectorAll('[data-cr-grip="start"]').length, lines };
  });
  check("1. كل عنوان ليه مقبض في آخره، وكل حد بين عمودين يتمسك من الناحيتين", grips.ends === grips.ths && grips.starts === grips.ths - 1, JSON.stringify({ ...grips, lines: undefined }));
  check("1a. وهو واقف: مفيش خطوط ظاهرة", grips.lines.every((o) => Number(o) === 0));

  // 2. near the border: a thin line + ↔ cursor
  const sup = th(page, "المورد");
  const supEnd = sup.locator('[data-cr-grip="end"]');
  await supEnd.hover(); await page.waitForTimeout(150);
  const hov = await supEnd.evaluate((g) => ({ cursor: getComputedStyle(g).cursor, op: Number(getComputedStyle(g.firstElementChild).opacity), w: g.firstElementChild.getBoundingClientRect().width, h: g.firstElementChild.getBoundingClientRect().height, thH: g.closest("th").getBoundingClientRect().height }));
  check("2. لما تقرب من الحد: خط رفيع بطول العنوان والسهم ↔", hov.cursor === "col-resize" && hov.op > 0.5 && hov.w <= 3 && Math.abs(hov.h - hov.thH) <= 2, JSON.stringify(hov));
  await shot(page, "resize-1-hover");

  // 3. drag: live, only that column changes, the rest move, the table gets shorter
  const before = await widths(page);
  const box = await supEnd.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 4 });
  const mid = await widths(page);
  const lineMid = await supEnd.evaluate((g) => Number(getComputedStyle(g.firstElementChild).opacity));
  check("3. وإنت بتسحب: العمود بيتغير لحظة بلحظة والخط فاضل منور", mid["المورد"] < before["المورد"] - 40 && lineMid > 0.5, `${before["المورد"]} → ${mid["المورد"]}`);
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up(); await page.waitForTimeout(200);
  const after = await widths(page);
  const others = Object.keys(before).filter((k) => k !== "المورد" && k !== "__table");
  const moved = others.filter((k) => Math.abs(after[k] - before[k]) > 2);
  check("3a. باقي الأعمدة مقاسها زي ما هو (بتتزق بس)", moved.length === 0, moved.map((k) => `${k}: ${before[k]}→${after[k]}`).join(", "));
  check("3b. الجدول قصر بنفس الفرق (± بكسل لكل عمود من التقريب)", Math.abs((before.__table - after.__table) - (before["المورد"] - after["المورد"])) <= others.length + 1, `${before.__table} → ${after.__table}`);
  const cutOthers = await page.evaluate(() => {
    const t = document.querySelector("table[data-cr]");
    const heads = Array.from(t.querySelectorAll(":scope > thead > tr:last-child > th")).map((x) => x.textContent.trim());
    const out = [];
    ["الإجمالي", "قبل الضريبة", "الضريبة", "التاريخ"].forEach((lab) => {
      const i = heads.findIndex((h) => h.includes(lab) && !(lab === "الضريبة" && h.includes("قبل")));
      t.querySelectorAll(`:scope > tbody > tr > td:nth-child(${i + 1})`).forEach((td) => { if (td.scrollWidth > td.clientWidth + 1) out.push(`${lab}: ${td.innerText}`); });
    });
    return out;
  });
  check("3c. الأعمدة اللي ما اتلمستش مفيهاش أرقام مقصوصة", cutOthers.length === 0, cutOthers.join(" | "));
  const lineAfter = await supEnd.evaluate((g) => Number(getComputedStyle(g.firstElementChild).opacity));

  // 4. one line + «…», full text on hover
  const cut = await page.evaluate(() => {
    const t = document.querySelector("table[data-cr]");
    const idx = Array.from(t.querySelectorAll(":scope > thead > tr:last-child > th")).findIndex((x) => x.textContent.includes("المورد"));
    const td = t.querySelector(`:scope > tbody > tr > td:nth-child(${idx + 1})`);
    const div = td.querySelector("div");
    return { ws: getComputedStyle(td).whiteSpace, to: getComputedStyle(div).textOverflow, cut: div.scrollWidth > div.clientWidth, h: Math.round(td.getBoundingClientRect().height) };
  });
  check("4. العمود الضيق: سطر واحد ويتقص بـ«…»", cut.ws === "nowrap" && cut.to === "ellipsis" && cut.cut, JSON.stringify(cut));
  const tdSup = page.locator("table[data-cr] tbody tr").first().locator("td").nth(2);
  await tdSup.hover(); await page.waitForTimeout(150);
  const tip = await tdSup.getAttribute("title");
  check("4a. الوقوف على الخانة المقصوصة بيظهر الكلام كله", !!tip && tip.includes("فريش"), tip ?? "");
  await shot(page, "resize-2-narrow");

  // 5. the same border from the other side (the start of «الإجمالي») resizes «المورد»
  const totStart = th(page, "الإجمالي").locator('[data-cr-grip="start"]');
  const b2 = await totStart.boundingBox();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2); await page.mouse.down();
  await page.mouse.move(b2.x + b2.width / 2 - 100, b2.y + b2.height / 2, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
  const after2 = await widths(page);
  check("5. تمسك نفس الحد من ناحية «الإجمالي»: «المورد» بيوسع و«الإجمالي» زي ما هو", after2["المورد"] > after["المورد"] + 80 && Math.abs(after2["الإجمالي"] - after["الإجمالي"]) <= 2,
    `المورد ${after["المورد"]}→${after2["المورد"]}, الإجمالي ${after["الإجمالي"]}→${after2["الإجمالي"]}`);

  // 6. small columns: down to the minimum, never 0
  const dateEnd = th(page, "التاريخ").locator('[data-cr-grip="end"]');
  await dateEnd.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
  const b3 = await dateEnd.boundingBox();
  await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2); await page.mouse.down();
  await page.mouse.move(b3.x + 600, b3.y + b3.height / 2, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
  const after3 = await widths(page);
  check("6. أقل عرض 36 بكسل (العنوان يتقص)", after3["التاريخ"] >= 34 && after3["التاريخ"] <= 40, String(after3["التاريخ"]));

  // 7. kept after reload; double-click puts the column back
  await page.reload(); await settle(page);
  const again = await widths(page);
  check("7. المقاسات فاضلة بعد الريفرش", Math.abs(again["المورد"] - after2["المورد"]) <= 2 && Math.abs(again["التاريخ"] - after3["التاريخ"]) <= 2);
  await th(page, "التاريخ").locator('[data-cr-grip="end"]').scrollIntoViewIfNeeded();
  await th(page, "التاريخ").locator('[data-cr-grip="end"]').dblclick(); await page.waitForTimeout(250);
  const reset = await widths(page);
  check("7a. دبل كليك على الخط يرجّع العمود لمقاسه", reset["التاريخ"] > 60, String(reset["التاريخ"]));
  check("7b. الخط مطفي بعد ما سبت السحب", lineAfter >= 0 && (await th(page, "المورد").locator('[data-cr-grip="end"] > span').evaluate((s) => Number(getComputedStyle(s).opacity))) === 0);

  // 8. the other tables of the page get it too (suppliers tab)
  await page.getByRole("tab", { name: /الموردين/ }).click(); await settle(page);
  const t2 = await page.evaluate(() => Array.from(document.querySelectorAll("table[data-cr]")).filter((t) => t.offsetParent).map((t) => ({
    ths: t.querySelectorAll(":scope > thead > tr:last-child > th").length, ends: t.querySelectorAll('[data-cr-grip="end"]').length })));
  check("8. جدول الموردين كمان فيه المقابض", t2.length >= 1 && t2.every((x) => x.ends === x.ths), JSON.stringify(t2));

  // 8a. a table with no Excel filter (the invoice lines, `noFilter`) is resizable too
  await page.goto(`${BASE}/admin/eta-invoices/d1`); await settle(page); await page.waitForTimeout(800);
  const t3 = await page.evaluate(() => Array.from(document.querySelectorAll("table")).filter((t) => t.offsetParent).map((t) => ({
    ths: t.querySelectorAll(":scope > thead > tr:last-child > th").length, ends: t.querySelectorAll('[data-cr-grip="end"]').length, off: t.closest("[data-no-resize]") ? 1 : 0 })));
  check("8a. جدول أصناف الفاتورة (من غير فلاتر) كمان بيتوسع", t3.length >= 1 && t3.every((x) => x.ends === x.ths && !x.off), JSON.stringify(t3));

  const errs = db.calls.filter((c) => c.pageerror);
  check("9. مفيش أخطاء في الصفحة", errs.length === 0, errs.map((e) => e.pageerror).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
