// UI test of «الفواتير الإلكترونية الواردة» (/admin/eta-invoices, migrations 0220–0222): cards, state chips, the
// «في السيستم» column (recorded with its purchase / missing / supplier not linked / credit note), the lines dialog,
// the link dialog (calls eta_set_match with the chosen purchase), «مش فاتورة شراء», the suppliers tab (a suggestion
// links the ETA supplier: eta_link_issuer), and the settings wizard page. Database faked in the browser with the
// shapes the real RPCs returned on 2026-11-15.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/eta-invoices.ui.cjs
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
  last_sync_at: "2026-11-15T06:07:02Z", synced_until: "2026-11-15T06:07:02Z", connection_error: null, connection_ok_at: "2026-11-14T23:48:51Z", connection_checked_at: "2026-11-14T23:48:51Z" };

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
  const { page } = await open(browser, db);
  await page.goto(`${BASE}/admin/eta-invoices`); await settle(page);
  await shot(page, "eta-1-list");
  const body = await page.locator("body").innerText();
  check("page title", body.includes("الفواتير الإلكترونية الواردة"));
  check("receiving status line", body.includes("الاستقبال شغّال"));
  check("card: valid count = 5", /الفواتير الصحيحة[\s\S]{0,40}5/.test(body));
  check("recorded row shows its purchase", body.includes("PO24941") && body.includes("متسجلة عندنا"));
  check("missing row", body.includes("مش متسجلة عندنا"));
  check("unlinked supplier row", body.includes("المورد مش مربوط"));
  check("credit note row", body.includes("إشعار — راجعه"));
  check("ignored row", body.includes("مش فاتورة شراء"));
  check("new badge", body.includes("جديد"));
  check("mark-all-seen button with count", body.includes("علّم الكل اتشاف (1)"));

  // state chip filter
  await page.getByRole("button", { name: /^مش متسجلة عندنا \(/ }).click(); await page.waitForTimeout(300);
  const rowsMissing = await page.locator("tbody tr").count();
  check("chip «مش متسجلة عندنا» filters to 1 row", rowsMissing === 1, `rows=${rowsMissing}`);
  await page.getByRole("button", { name: /^الكل \(/ }).click(); await page.waitForTimeout(300);

  // lines dialog
  await page.locator("tbody tr").first().getByTitle("بنود الفاتورة").click(); await settle(page);
  const dlg = await page.locator("[role=dialog]").innerText();
  check("lines dialog shows the item, qty and VAT", dlg.includes("غسالة حوض واحد 5ك شطورة") && dlg.includes("2,762.28") && dlg.includes("1,933.60"));
  await shot(page, "eta-2-lines");
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  // link dialog on the missing فريش invoice
  const missingRow = page.locator("tbody tr", { hasText: "9405743485" });
  await missingRow.getByTitle("اربطها بفاتورة شراء").click(); await settle(page);
  const ldlg = await page.locator("[role=dialog]").innerText();
  check("link dialog lists candidates, the taken one is marked", ldlg.includes("PO25010") && ldlg.includes("مربوطة بفاتورة تانية"));
  await shot(page, "eta-3-link");
  await page.locator("[role=dialog]").getByRole("button", { name: "اربط" }).first().click(); await settle(page);
  const setCall = db.calls.find((c) => c.rpc === "eta_set_match" && c.body.p_action === "link");
  check("link calls eta_set_match with the purchase", !!setCall && setCall.body.p_shipment === "s9" && setCall.body.p_doc === "d2");

  // «مش فاتورة شراء»
  await page.locator("tbody tr", { hasText: "INV/2026/12243" }).getByTitle("مش فاتورة شراء (مصروف)").click(); await settle(page);
  check("ignore calls eta_set_match ignore", db.calls.some((c) => c.rpc === "eta_set_match" && c.body.p_action === "ignore" && c.body.p_doc === "d3"));

  // suppliers tab
  await page.getByRole("tab", { name: /الموردين/ }).click(); await settle(page);
  const tab2 = await page.locator("body").innerText();
  check("suppliers tab shows linked account and suggestion", tab2.includes("شركة فريش (بوتاجاز") && tab2.includes("شركة قنوات"));
  await shot(page, "eta-4-suppliers");
  await page.getByRole("button", { name: /شركة قنوات/ }).click(); await settle(page);
  const link = db.calls.find((c) => c.rpc === "eta_link_issuer");
  check("suggestion links the supplier", !!link && link.body.p_issuer_id === "315171634" && link.body.p_contacts.includes("c-qanawat"));

  // settings wizard
  await page.goto(`${BASE}/admin/settings?tab=eta`); await settle(page);
  const w = await page.locator("body").innerText();
  check("wizard: 5 steps", ["الخطوة 1", "الخطوة 2", "الخطوة 3", "الخطوة 4", "الخطوة 5"].every((s) => w.includes(s)));
  check("wizard: connection ok shown", w.includes("الاتصال نجح"));
  await shot(page, "eta-5-wizard");
  await page.getByRole("button", { name: "اختبر الاتصال" }).click(); await settle(page);
  check("wizard: test calls eta-sync mode test", db.calls.some((c) => c.fn === "eta-sync" && c.body.mode === "test"));

  const errs = db.calls.filter((c) => c.pageerror);
  check("no page errors", errs.length === 0, errs.map((e) => e.pageerror).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
