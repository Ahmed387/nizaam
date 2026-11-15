// «القوائم المالية» (migration 0227, owner 2026-11-15): one page, one filter, a tab per statement + «تحليل القوائم المالية»;
// the old statement addresses open their tab; the analysis shows the ratios with verdicts, income side by side, the balance at
// both ends; the balance sheet uses the accounts' balances for customers / suppliers and balances; no page error.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/financial-statements.ui.cjs
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

// October 2026 (dry-run of 0227 = profit_statement_core to the piaster)
const TOT = { sales: 9145432.10, returns: 276858.96, net_sales: 8868573.14, cogs: 8752027.38, gross_profit: 116545.76, expenses: 54661.85,
  operating_profit: 61883.91, other_income: 1035, count_diff: 0, net_profit: 62918.91, revenue_total: 8869608.14, expense_total: 8806689.23 };
const PROFIT = { from: "2026-10-01", to: "2026-10-31", total: TOT, branches: [], accounts: [] };
const BS = { as_of: "2026-10-31", net_income: 538589.29, receivables: 8597468.16, payables: 9223677.05, accounts: [
  { code: "1100", name: "الخزينة", type: "asset", amount: 300000 }, { code: "1110", name: "البنك", type: "asset", amount: 1318512.54 },
  { code: "1300", name: "المخزون", type: "asset", amount: 5585156.29 }, { code: "1450", name: "سلف الموظفين", type: "asset", amount: 100 },
  { code: "3800", name: "الأرباح المحتجزة", type: "equity", amount: 1193142.22 }, { code: "3950", name: "رصيد افتتاحي", type: "equity", amount: 4845828.43 } ] };
const END = { cash: 1618512.54, receivables: 8597468.16, inventory: 5585156.29, other_current: 100, fixed_net: 0, other_assets: 0, payables: 9223677.05, other_liabilities: 0, equity_accounts: 6038970.65, profit_to_date: 538589.29 };
const START = { cash: 1422602.40, receivables: 7842556.85, inventory: 6462233.36, other_current: 100, fixed_net: 0, other_assets: 0, payables: 9212887.74, other_liabilities: 0, equity_accounts: 6038934.49, profit_to_date: 475670.38 };
const ANALYSIS = { cur: { from: "2026-10-01", to: "2026-10-31" }, cmp: { from: "2026-09-01", to: "2026-09-30" },
  pl: { cur: { sales: 9145432.10, returns: 276858.96, cogs: 8752027.38, expenses: 54661.85, other_income: 1035, count_diff: 0 },
        cmp: { sales: 8000000, returns: 100000, cogs: 7700000, expenses: 60000, other_income: 0, count_diff: 0 } },
  bal: { cur_end: END, cur_start: START, cmp_end: START, cmp_start: { ...START, cash: 1546978.39 } },
  months: [{ month: "2026-09", net_sales: 7900000, cogs: 7700000, net_profit: 140000 }, { month: "2026-10", net_sales: 8868573.14, cogs: 8752027.38, net_profit: 62918.91 }] };
const EQUITY = { rows: [{ key: "opening", label: "رصيد افتتاحي", opening: 4845828.43, increase: 0, decrease: 0, profit: 0, closing: 4845828.43, details: [] }],
  total: { opening: 6514605, increase: 0, decrease: 0, profit: 62918.91, closing: 6577523.94 }, balance_sheet: { assets: 15801236.99, liabilities: 9223677.05, equity: 6577559.94 } };
const COGS = { opening: 6462233.36, purchases: 7874950.31, closing: 5585156.29, cogs: 8752027.38, cogs_books: 8752027.38 };
const HIDDEN = [{ contact_id: "c1", account_no: 337, name: "أ/ منتصر صالح", contact_type: "customer", branch_name: "معرض عبدالمنعم الغربى",
  hidden_at: "2026-11-15T12:43:45Z", hidden_by_name: "احمد ناصر", reason: "تجربة", documents: 7, customer_balance: 1500, supplier_balance: 0 }];
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
  page.on("pageerror", (e) => db.calls.push({ pageerror: String(e).slice(0, 200) + " @ " + page.url().replace(BASE, "") + " :: " + String(e.stack || "").split("\n").slice(1, 3).join(" ").slice(0, 300) }));
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
      if (name === "profit_statement") return json(PROFIT);
      if (name === "balance_sheet") return json(BS);
      if (name === "financial_analysis") return json(ANALYSIS);
      if (name === "equity_changes") return json(EQUITY);
      if (name === "cogs_statement") return json(COGS);
      if (name === "partners_overview") return json([]);
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
  const db = makeDb();
  const { page } = await open(browser, db);
  const body = async () => page.locator("body").innerText();

  await page.goto(`${BASE}/admin/financial-statements`); await settle(page);
  let t = await body();
  check("page title + sidebar entry", t.includes("القوائم المالية") && (await page.getByRole("link", { name: "القوائم المالية" }).count()) >= 1);
  check("six tabs", ["قائمة الدخل", "المركز المالي", "التدفقات النقدية", "التغيرات في حقوق الملكية", "تكلفة البضاعة المباعة", "تحليل القوائم المالية"].every((x) => t.includes(x)));
  check("income tab: net profit 62,918.91", t.includes("62,918.91"));
  check("income asks the books with the shared period", db.calls.some((c) => c.rpc === "profit_statement" && c.body.p_from && c.body.p_branch === null));
  await shot(page, "fs-1-income");

  await page.getByRole("tab", { name: "المركز المالي" }).click(); await settle(page);
  t = await body();
  check("balance: customers / suppliers = the accounts' balances", t.includes("8,597,468.16") && t.includes("9,223,677.05"));
  check("balance balances", t.includes("متوازنة ✓"), t.includes("غير متوازنة") ? "not balanced" : "");
  check("balance asks balance_sheet at «إلى»", db.calls.some((c) => c.rpc === "balance_sheet"));
  await shot(page, "fs-2-balance");

  await page.getByRole("tab", { name: "تحليل القوائم المالية" }).click(); await settle(page);
  t = await body();
  check("analysis: compare with the period before by default", t.includes("قارن بـ") && db.calls.some((c) => c.rpc === "financial_analysis" && c.body.p_cmp_to < c.body.p_from));
  check("analysis: summary + ratio groups", t.includes("إيه اللي محتاج انتباه") && ["الربحية", "السيولة", "النشاط", "المديونية"].every((x) => t.includes(x)));
  check("analysis: gross margin 1.3% «محتاج انتباه»", /هامش مجمل الربح[\s\S]{0,60}1\.3%/.test(t) && t.includes("محتاج انتباه"));
  check("analysis: income side by side with % of sales", t.includes("% من المبيعات") && t.includes("8,868,573.14"));
  check("analysis: balance at both ends", t.includes("% من الأصول") && t.includes("إجمالي الأصول"));
  await shot(page, "fs-3-analysis");
  // custom comparison
  await page.locator("select").filter({ hasText: "الفترة اللي قبلها" }).selectOption("custom"); await page.waitForTimeout(300);
  const dates = page.locator('input[type="date"]');
  await dates.nth(2).fill("2026-06-01"); await dates.nth(3).fill("2026-06-30"); await settle(page);
  check("analysis: custom comparison period sent", db.calls.some((c) => c.rpc === "financial_analysis" && c.body.p_cmp_from === "2026-06-01" && c.body.p_cmp_to === "2026-06-30"));

  await page.getByRole("tab", { name: "تكلفة البضاعة المباعة" }).click(); await settle(page);
  check("cogs tab", (await body()).includes("مطابقة لتكلفة البضاعة في قائمة الدخل"));
  await page.getByRole("tab", { name: "التغيرات في حقوق الملكية" }).click(); await settle(page);
  check("equity tab", (await body()).includes("رصيد افتتاحي"));

  // a branch in the filter reaches the tabs
  const br = page.locator("select").filter({ hasText: "كل الفروع (الشركة)" });
  await br.selectOption({ index: 1 }); await settle(page);
  check("equity says it is company-wide when a branch is chosen", (await body()).includes("للشركة كلها"));
  await page.getByRole("tab", { name: "قائمة الدخل" }).click(); await settle(page);
  check("branch sent to the income statement", db.calls.some((c) => c.rpc === "profit_statement" && c.body.p_branch === B1));

  // old addresses open their tab
  for (const [path, tabName] of [["income-statement", "قائمة الدخل"], ["balance-sheet", "المركز المالي"], ["cash-flow", "التدفقات النقدية"], ["equity-changes", "التغيرات في حقوق الملكية"], ["cogs-statement", "تكلفة البضاعة المباعة"]]) {
    await page.goto(`${BASE}/admin/accounting/${path}`); await settle(page);
    const sel = await page.getByRole("tab", { name: tabName }).getAttribute("aria-selected");
    check(`old /admin/accounting/${path} → tab «${tabName}»`, page.url().includes("/admin/financial-statements") && sel === "true");
  }
  // the hub card has ONE button
  await page.goto(`${BASE}/admin/financial-position`); await settle(page);
  t = await body();
  check("«الذمة المالية»: one «القوائم المالية» button, no separate statement buttons", t.includes("القوائم المالية") && !t.includes("قائمة المركز المالي"));

  check("no page errors", !db.calls.some((c) => c.pageerror), db.calls.filter((c) => c.pageerror).map((c) => c.pageerror).join(" | "));
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
