// «تحميل الفاتورة الإلكترونية PDF» (owner 2026-11-27 «عاوز اقدر احددها واجمعها في PDF واحد وانزلها او احدد اللي انا
// عاوزه وانزله مرة واحده … نفس ال PDF اللي علي المنصة»): a row button downloads one invoice, ticking invoices gives
// ONE merged PDF or a ZIP with a file each, the invoice page has its own button; failures are listed. The portal is faked
// (eta-sync mode 'pdf' answers real PDFs made here).
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: LANG=C.UTF-8 node e2e/eta-pdf.ui.cjs
// (a browser started without a UTF-8 locale names every Arabic download «download»)
const { PDFDocument } = require("@cantoo/pdf-lib");
const fs = require("fs");
const zlib = require("zlib");
// the portal's PDFs are encrypted (RC4 128, empty open password) — the fake portal serves files encrypted the same way
const FIX = { 1: fs.readFileSync(`${__dirname}/../src/test/fixtures/eta-rc4-1page.pdf`), 3: fs.readFileSync(`${__dirname}/../src/test/fixtures/eta-rc4-3pages.pdf`) };
async function pdfOf(pages) { return FIX[pages === 3 ? 3 : 1]; }
const PAGES = { AAAAAAAAAAAA01: 1, AAAAAAAAAAAA02: 3, AAAAAAAAAAAA03: 1, AAAAAAAAAAAA05: 1 };
const readable = (doc) => {
  let t = "";
  for (const [, o] of doc.context.enumerateIndirectObjects()) if (o.contents) { try { t += zlib.inflateSync(Buffer.from(o.contents)).toString("latin1"); } catch {} }
  return t;
};
const hex = (w) => Buffer.from(w).toString("hex").toUpperCase();
const FAIL = { AAAAAAAAAAAA04: "المنظومة مش لاقية ملف الفاتورة دي" };
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar-EG", acceptDownloads: true });
  // these checks click a row's own buttons: keep them in the row (the «⋮» menu itself is tested in column-resize / roles-buttons)
  await ctx.addInitScript(() => { const on = () => document.documentElement?.setAttribute("data-no-row-menu", ""); on(); document.addEventListener("readystatechange", on); });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => db.calls.push({ pageerror: String(e).slice(0, 300) }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(`${SB}/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    const json = (d, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
    if (path.startsWith("/auth/v1/user")) return json({ id: OWNER, aud: "authenticated", app_metadata: {}, user_metadata: {} });
    if (path.startsWith("/auth/v1/")) return json({});
    if (path.startsWith("/functions/v1/eta-sync")) {
      const b = req.postDataJSON(); db.calls.push({ fn: "eta-sync", body: b });
      if (b?.mode === "pdf") return json({ ok: true, files: await Promise.all(b.uuids.map(async (u) => FAIL[u]
        ? { uuid: u, ok: false, error: FAIL[u] }
        : { uuid: u, ok: true, pdf: Buffer.from(await pdfOf(PAGES[u] ?? 1, u)).toString("base64") })) });
      return json({ ok: true, sample: 10 });
    }
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
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const db = makeDb();
  // three more invoices so a full pick needs two calls (5 per call)
  for (const n of [6, 7, 8]) DOCS.push({ ...DOCS[0], id: `d${n}`, eta_uuid: `AAAAAAAAAAAA0${n}`, internal_id: `X-${n}`, seen_at: "2026-11-15T06:00:00Z" });
  const { page } = await open(browser, db);
  const t = (id) => page.getByTestId(id);
  const pdfCalls = () => db.calls.filter((c) => c.fn === "eta-sync" && c.body?.mode === "pdf").map((c) => c.body);
  const grab = async (fn) => {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), fn()]);
    const file = await dl.path();
    return { name: dl.suggestedFilename(), bytes: fs.readFileSync(file) };
  };
  await page.goto(`${BASE}/admin/eta-invoices`); await settle(page);

  // 1) one invoice from its row
  let d = await grab(() => page.locator("tbody tr").filter({ hasText: "9405720531" }).getByTestId("eta-pdf-row").click());
  check("1. زرار الصف: اتحمّل PDF زي ما المنظومة بعتته بالظبط", d.bytes.equals(FIX[1]), d.name);
  check("1. اسم الملف: نوعها + تاريخها + المورد + رقمها", d.name.startsWith("فاتورة ") && d.name.includes("شركة فريش") && d.name.endsWith("9405720531.pdf"), d.name);
  check("1. طلب واحد للمنظومة بالعربي", pdfCalls().length === 1 && pdfCalls()[0].uuids.join() === "AAAAAAAAAAAA01" && pdfCalls()[0].lang === "ar");
  await page.waitForTimeout(400);
  check("1. فاتورة واحدة: مفيش نافذة فاضلة مفتوحة", !(await t("eta-pdf-progress").isVisible().catch(() => false)));

  // 2) tick three → one merged PDF, in English
  check("2. مفيش شريط تحديد قبل ما تحدد", !(await t("eta-pdf-bar").isVisible().catch(() => false)));
  for (const id of ["d1", "d2", "d3"]) await t(`eta-pick-${id}`).click();
  check("2. الشريط: اتحدد 3 فاتورة", (await t("eta-pdf-bar").innerText()).includes("3"));
  await t("eta-pdf-lang").click(); await page.getByRole("option", { name: "English" }).click();
  await shot(page, "eta-pdf-2-bar");
  d = await grab(() => t("eta-pdf-merged").click());
  const merged = await PDFDocument.load(d.bytes);
  check("2. PDF واحد مجمّع فيه كل الصفحات (1+3+1 = 5)", merged.getPageCount() === 5, `pages=${merged.getPageCount()}`);
  const mt = readable(merged);
  check("2. المجمّع مفكوك ومقروء (مش كلام ملخبط) ومش مقفول بباسورد", mt.includes(hex("INVOICE 1")) && mt.includes(hex("PAGE 3")) && !d.bytes.includes(Buffer.from("/Encrypt")));
  check("2. اسمه «فواتير إلكترونية 3 فاتورة …pdf»", /^فواتير إلكترونية 3 فاتورة \d{4}-\d\d-\d\d\.pdf$/.test(d.name), d.name);
  check("2. اتطلب بالإنجليزي، والترتيب زي الجدول", pdfCalls().at(-1).lang === "en" && pdfCalls().at(-1).uuids.length === 3);
  await page.waitForTimeout(300);
  check("2. النتيجة: اتحمّل 3", (await t("eta-pdf-result").innerText()).includes("اتحمّل 3"));
  await t("eta-pdf-close").click();

  // 3) pick everything shown (8, one fails) → ZIP, two calls of ≤ 5
  await t("eta-pick-all").click();
  const n0 = pdfCalls().length;
  d = await grab(() => t("eta-pdf-zip").click());
  const zipText = d.bytes.toString("latin1");
  const entries = (zipText.match(/PK\x01\x02/g) || []).length;
  check("3. ZIP: ملف لكل فاتورة اتحمّلت (7 من 8)", d.name.endsWith(".zip") && entries === 7, `${d.name} entries=${entries}`);
  check("3. اسم كل ملف جوه الـ ZIP بالعربي (UTF-8)", d.bytes.includes(Buffer.from("9405720531.pdf")) && d.bytes.includes(Buffer.from("شركة فريش")));
  const calls = pdfCalls().slice(n0);
  check("3. اتطلبوا على دفعتين (5 + 3)", calls.length === 2 && calls[0].uuids.length === 5 && calls[1].uuids.length === 3, calls.map((c) => c.uuids.length).join("+"));
  await page.waitForTimeout(300);
  const res = await t("eta-pdf-result").innerText();
  check("3. الفاتورة اللي ماتحملتش مكتوبة بسببها", res.includes("1 فاتورة المنظومة مدّتهاش") && res.includes("10147065") && res.includes("مش لاقية"), res);
  await shot(page, "eta-pdf-3-result");
  await t("eta-pdf-close").click();
  await t("eta-pdf-clear").click();
  check("3. «إلغاء التحديد» بيشيل الشريط", !(await t("eta-pdf-bar").isVisible().catch(() => false)));
  check("3. اللغة فاضلة English بعد ما اخترتها", (await page.evaluate(() => localStorage.getItem("eta_pdf_lang"))) === "en");

  // 4) only failures: no file, a clear message
  await t("eta-pick-d4").click();
  await t("eta-pdf-merged").click(); await t("eta-pdf-result").waitFor({ timeout: 15000 });
  check("4. فاتورة المنظومة مدّتهاش: «مفيش ولا فاتورة اتحمّلت»", (await t("eta-pdf-result").innerText()).includes("مفيش ولا فاتورة اتحمّلت"));
  await t("eta-pdf-close").click(); await t("eta-pdf-clear").click();

  // 5) the invoice page
  await page.goto(`${BASE}/admin/eta-invoices/d2`); await settle(page);
  d = await grab(() => t("eta-pdf-one").click());
  check("5. صفحة الفاتورة: «حمّل الـ PDF من المنظومة» بينزل ملفها", d.bytes.slice(0, 4).toString() === "%PDF" && d.name.endsWith("9405743485.pdf") && d.bytes.equals(FIX[3]), d.name);

  const errs = db.calls.filter((c) => c.pageerror);
  check("no page errors", errs.length === 0, errs.map((e) => e.pageerror).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
