// «الحسابات المخفية» (migration 0226, owner 2026-11-15): the owner sees «الحسابات المخفية» under «الحسابات» in the sidebar and the
// page lists every hidden account with «إظهار» (calls set_contact_hidden false); a manager gets no link and the page says it is
// for the owner only; no page error (the sidebar crashed on a missing icon import before).
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/hidden-contacts.ui.cjs
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

const HIDDEN = [{ contact_id: "c1", account_no: 337, name: "أ/ منتصر صالح", contact_type: "customer", branch_name: "معرض عبدالمنعم الغربى",
  hidden_at: "2026-11-15T12:43:45Z", hidden_by_name: "احمد ناصر", reason: "تجربة", documents: 7, customer_balance: 1500, supplier_balance: 0 }];
const ROW = { phone: null, contact_person: null, email: null, address: null, notes: null, branch_id: B1, created_at: "2026-01-01", opening_balance: 0, is_migrated: false,
  customer_open: 0, customer_advance: 0, customer_overdue: 0, supplier_open: 0, supplier_advance: 0, supplier_overdue: 0, supplier_balance: 0, supplier_balance_all: 0 };
const ROWS = [
  { ...ROW, id: "c1", name: "أ/ منتصر صالح", type: "customer", customer_balance: 1500, customer_balance_all: 1500 },
  { ...ROW, id: "c2", name: "محمد حسن", type: "both", customer_balance: 0, customer_balance_all: 0 },
];
const MGR = "598491e8-589f-4ad1-88a6-62d6e9114bde";
function makeMgrDb() {
  const d = makeDb();
  d.isOwner = false;
  d.uid = MGR;
  d.profiles = [{ id: MGR, name: "د/نور ناصر", username: "nour", tenant_id: T, is_active: true }];
  d.user_roles = [{ user_id: MGR, role: "admin", tenant_id: T }];
  d.tenants[0].owner_user_id = OWNER;
  return d;
}
function makeDb() {
  return {
    calls: [], isOwner: true,
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
    if (path.startsWith("/auth/v1/user")) return json({ id: db.uid || OWNER, aud: "authenticated", app_metadata: {}, user_metadata: {} });
    if (path.startsWith("/auth/v1/")) return json({});
    if (path.startsWith("/functions/v1/eta-sync")) { db.calls.push({ fn: "eta-sync", body: req.postDataJSON() }); return json({ ok: true, sample: 10 }); }
    if (path.startsWith("/functions/v1/")) return json({ ok: true });
    if (path.startsWith("/rest/v1/rpc/")) {
      const name = path.split("/").pop(); let body = {}; try { body = req.postDataJSON() || {}; } catch {}
      db.calls.push({ rpc: name, body });
      if (name === "hidden_contacts_list") return db.isOwner ? json(HIDDEN) : route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "42501", message: "للمالك بس" }) });
      if (name === "contacts_page") return json({ rows: ROWS, total: ROWS.length, counts: { all: 2, customer: 1, supplier: 0, both: 1 },
        totals: { customers_open: 1500, customers_open_count: 1, customer_advances: 0, customer_advances_count: 0, suppliers_open: 0, suppliers_open_count: 0, supplier_advances: 0, supplier_advances_count: 0, customer_overdue: 0, supplier_overdue: 0, debit_total: 1500, debit_count: 1, credit_total: 0, credit_count: 0 },
        sides: { customer: true, supplier: true } });
      if (name === "set_contact_hidden") { HIDDEN.splice(0, HIDDEN.length); return json({ hidden: false, rows: 0, name: "أ/ منتصر صالح" }); }
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
  const uid = db.uid || OWNER;
  const sess = { access_token: jwt(uid), refresh_token: "r", token_type: "bearer", expires_in: 31536000, expires_at: 4102444800, user: { id: uid, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } };
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(sess)]);
  return { ctx, page };
}

const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
const settle = async (page) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(900); };
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  // the owner
  const db = makeDb();
  const { page } = await open(browser, db);
  // the owner's account actions in each row's «⋮» of the contacts list (owner 2026-11-28): merge, hide / show, both settlements
  await page.goto(`${BASE}/branch/${B1}/contacts`); await settle(page);
  const ownerItems = async (pg, rowName) => {
    const row = pg.locator("table[data-cr] > tbody > tr").filter({ hasText: rowName }).first();
    const ra = row.getByTestId("row-actions");
    if (!(await ra.count())) return [];
    await ra.click(); await pg.waitForTimeout(200);
    const t = await pg.locator('[data-testid="row-actions-menu"] [role=menuitem]').allInnerTexts();
    return t.map((x) => x.trim());
  };
  const it1 = await ownerItems(page, "أ/ منتصر صالح");
  check("owner: a hidden account's ⋮ has «إظهار», «دمج حساب تاني» and both settlements", ["إظهار", "دمج حساب تاني", "تسوية رصيد بدون فلوس"].every((x) => it1.some((y) => y.includes(x))) && it1.some((y) => y.includes("تسوية برصيد")), it1.join(" | "));
  check("owner: «أرشفة» last in the menu", /أرشفة/.test(it1[it1.length - 1] ?? ""), it1[it1.length - 1]);
  await page.keyboard.press("Escape");
  const it2 = await ownerItems(page, "محمد حسن");
  check("owner: a visible account's ⋮ has «إخفاء»", it2.some((y) => y.includes("إخفاء")), it2.join(" | "));
  await page.locator('[data-testid="row-actions-menu"] [role=menuitem]').filter({ hasText: "دمج حساب تاني" }).click(); await page.waitForTimeout(400);
  check("owner: «دمج حساب تاني» from the menu opens the merge dialog", (await page.getByRole("dialog").count()) >= 1 && (await page.getByTestId("row-actions-menu").count()) === 0);
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  check("owner: the list asks for the hidden accounts ONCE (not per row)", db.calls.filter((c) => c.rpc === "hidden_contacts_list").length === 1 && !db.calls.some((c) => c.rpc === "contact_is_hidden"),
    `list=${db.calls.filter((c) => c.rpc === "hidden_contacts_list").length}, per-row=${db.calls.filter((c) => c.rpc === "contact_is_hidden").length}`);
  await shot(page, "contacts-owner-menu");

  await page.goto(`${BASE}/admin/hidden-contacts`); await settle(page);
  await shot(page, "hidden-1-owner");
  const body = await page.locator("body").innerText();
  check("page title", body.includes("الحسابات المخفية"));
  check("sidebar link for the owner", (await page.getByRole("link", { name: "الحسابات المخفية" }).count()) >= 1);
  check("hidden account listed with number, branch, reason, documents", body.includes("أ/ منتصر صالح") && body.includes("337") && body.includes("تجربة") && body.includes("معرض عبدالمنعم الغربى"));
  check("balance shown as مدين", /1,500(\.00)?[\s\S]{0,20}مدين/.test(body));
  await page.getByRole("button", { name: /إظهار/ }).click(); await settle(page);
  check("«إظهار» calls set_contact_hidden(false)", db.calls.some((c) => c.rpc === "set_contact_hidden" && c.body.p_hidden === false && c.body.p_contact === "c1"));
  check("list empty after showing", (await page.locator("body").innerText()).includes("مفيش حسابات مخفية"));
  check("no page errors (owner)", !db.calls.some((c) => c.pageerror), db.calls.filter((c) => c.pageerror).map((c) => c.pageerror).join(" | "));

  // a manager (admin, not the owner)
  const db2 = makeMgrDb();
  const p2 = (await open(browser, db2)).page;
  await p2.goto(`${BASE}/branch/${B1}/contacts`); await settle(p2);
  const mgrRow = p2.locator("table[data-cr] > tbody > tr").filter({ hasText: "محمد حسن" }).first();
  let mgrItems = [];
  if (await mgrRow.getByTestId("row-actions").count()) {
    await mgrRow.getByTestId("row-actions").click(); await p2.waitForTimeout(200);
    mgrItems = await p2.locator('[data-testid="row-actions-menu"] [role=menuitem]').allInnerTexts();
    await p2.keyboard.press("Escape");
  }
  check("manager: no merge / hide / settlement items (owner only)", !mgrItems.some((y) => /دمج|إخفاء|إظهار|تسوية/.test(y)), mgrItems.join(" | "));
  await p2.goto(`${BASE}/admin/hidden-contacts`); await settle(p2);
  await shot(p2, "hidden-2-manager");
  const b2 = await p2.locator("body").innerText();
  check("manager: no sidebar link", (await p2.getByRole("link", { name: "الحسابات المخفية" }).count()) === 0);
  check("manager: page says owner only, lists nothing", b2.includes("لمالك الشركة بس") && !b2.includes("أ/ منتصر صالح"));
  check("manager: never asks for the list", !db2.calls.some((c) => c.rpc === "hidden_contacts_list" || c.rpc === "contact_is_hidden"));
  check("no page errors (manager)", !db2.calls.some((c) => c.pageerror), db2.calls.filter((c) => c.pageerror).map((c) => c.pageerror).join(" | "));

  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
