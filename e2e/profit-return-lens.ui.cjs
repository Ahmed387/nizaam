// UI test of the return lens on the branch dashboard (migration 0133, owner «نفذ» 2026-10-28): a sale counts at its
// full quantity on its day, a return on ITS day (refund off the sales, its cost back off the cost).
// Today: one sale of 1,000 (cost 600, one piece of it came back later — still counted in full today) and one return
// today of an OLD invoice (300 refunded, cost 200 back). Sales today = 1,000 − 300 = 700; profit = 400 − 100 = 300.
// Was (invoice lens): sales 500 (the returned piece removed from today's invoice), the old invoice's return nowhere.
// Old header of the file this was copied from: UI test of «تعديل المرتجع» (owner 2026-10-28, migration 0131): the button on the return view, the edit screen
// pre-filled with the old lines (date + invoice locked), «قبل ← بعد», the required reason, and the ONE call to
// edit_sale_return. The button is for everyone (permission «returns.update», 0132): a cashier sees it; once the owner
// switches it off for him it is gone and the edit link sends him back. Database faked in the browser. Run:
//   npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/return-edit.ui.cjs
const { chromium } = require("playwright");
const OUT = process.env.OUT_DIR || __dirname;
const BASE = "http://127.0.0.1:4173";
const SB = "https://kkfiplnucefytutlwaiz.supabase.co";
const REF = "kkfiplnucefytutlwaiz";
const T = "5316fbfe-b862-4c91-b48b-1d81c8aa5a71";
const OWNER = "85c76e60-3d27-4a99-8cd7-c8f8b39d914a";
const CASHIER = "a3174891-df98-4baa-a806-8c4c94d29eca"; // a cashier of the branch
const B1 = "1329f6cc-0000-0000-0000-000000000001";
const R1 = "e0000001-0000-4000-8000-000000000001";
const INV = "a0000001-0000-4000-8000-000000000001";
const C1 = "c0000001-0000-4000-8000-000000000001";
const KAN = "f0000001-0000-4000-8000-000000000001";
const WASH = "f0000001-0000-4000-8000-000000000002";

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.sig`;


const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
function makeDb() {
  return {
    calls: [],
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true }],
    user_roles: [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T }],
    branch_users: [],
    branches: [{ id: B1, name: "معرض سكة تلة", code: "B1", tenant_id: T, is_active: true, is_system: false, platform_paused: false, monthly_sales_target: 0 }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [], role_permissions: [], user_permissions: [], permission_templates: [], products: [], contacts: [], invoice_payments: [],
    invoices: [{ id: INV, tenant_id: T, branch_id: B1, invoice_number: "IN09001", total: 1000, vat_amount: 0, discount_amount: 0, is_migrated: false,
      migration_batch_id: null, status: "active", invoice_date: `${TODAY}T10:00:00+03:00`, created_at: `${TODAY}T10:00:00+03:00`, payment_method: "cash",
      contact_id: null, contacts: null,
      invoice_items: [{ quantity: 2, total: 1000, returned_quantity: 1, net_quantity: 1, selling_price: 500, line_discount: 0, unit_cost_at_sale: 300, cost_price: 300, product_name: "مروحة" }] }],
    sale_return_lines: [{ branch_id: B1, return_id: "r1", return_number: "SR09001", return_day: TODAY, invoice_id: "old", invoice_number: "IN08000",
      invoice_day: "2026-03-02", archive_invoice: false, product_id: "p", product_name: "كنكة", quantity: 1, refund: 300, unit_cost: 200, cost: 200 }],
  };
}

function filt(rows, url) {
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(k) || k.includes(".")) continue;
    const m = /^(eq|neq|gte|lte|gt|lt|is|in)\.(.*)$/.exec(v);
    if (!m) continue;
    const [, op, raw] = m;
    rows = rows.filter((r) => {
      const x = r[k];
      if (op === "eq") return x === undefined || String(x) === raw;
      if (op === "neq") return String(x) !== raw;
      if (op === "is") return raw === "null" ? x === null || x === undefined : String(x) === raw;
      if (op === "in") return raw.replace(/[()"]/g, "").split(",").includes(String(x));
      const a = String(x ?? ""), b = raw;
      return op === "gte" ? a >= b : op === "lte" ? a <= b : op === "gt" ? a > b : a < b;
    });
  }
  return rows;
}

async function open(browser, db, me) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar-EG" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => db.calls.push({ pageerror: String(e).slice(0, 300) }));
  page.on("dialog", (d) => d.accept());
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(`${SB}/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    const json = (d, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
    if (path.startsWith("/auth/v1/user")) return json({ id: me, aud: "authenticated", app_metadata: {}, user_metadata: {} });
    if (path.startsWith("/auth/v1/")) return json({});
    if (path.startsWith("/functions/v1/")) return json({ ok: true });
    if (path.startsWith("/rest/v1/rpc/")) {
      const name = path.split("/").pop(); let body = {}; try { body = req.postDataJSON() || {}; } catch {}
      db.calls.push({ rpc: name, body });
      if (name === "sale_return_lines") return json(db.sale_return_lines.filter((l) => l.return_day >= body.p_from && l.return_day <= body.p_to));
      return json(null);
    }
    if (path.startsWith("/rest/v1/")) {
      const table = path.split("/").pop(); const method = req.method();
      if (method !== "GET" && method !== "HEAD") { db.calls.push({ table, method }); return json([]); }
      let rows = filt(db[table] ?? [], url);
      const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
      if (single) return rows.length ? json(rows[0]) : route.fulfill({ status: 406, contentType: "application/json", body: JSON.stringify({ code: "PGRST116", message: "0 rows" }) });
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}`, "access-control-allow-origin": "*", "access-control-expose-headers": "Content-Range" }, body: JSON.stringify(rows) });
    }
    return json({});
  });
  const sess = { access_token: jwt(me), refresh_token: "r", token_type: "bearer", expires_in: 31536000, expires_at: 4102444800, user: { id: me, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } };
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(sess)]);
  return { ctx, page };
}

const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
const settle = async (page) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1200); };

(async () => {
  const browser = await chromium.launch();
  const db = makeDb();
  const { ctx, page } = await open(browser, db, OWNER);
  await page.goto(`${BASE}/branch/${B1}/dashboard`); await settle(page);
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const asked = db.calls.filter((c) => c.rpc === "sale_return_lines");
  check("1. اللوحة طلبت مرتجعات الفترة بتاريخها", asked.length === 1 && asked[0].body.p_branch === B1 && asked[0].body.p_to === TODAY, JSON.stringify(asked[0]?.body ?? {}));
  check("2. مبيعات اليوم = 1,000 − 300 = 700", /مبيعات اليوم[^]{0,40}?700/.test(body), (body.match(/مبيعات اليوم[^]{0,40}/) ?? [""])[0]);
  check("2b. مجمل ربح اليوم = (1,000 − 600) − (300 − 200) = 300", /مجمل ربح اليوم[^]{0,40}?300/.test(body), (body.match(/مجمل ربح اليوم[^]{0,40}/) ?? [""])[0]);
  check("3. مفيش أخطاء في الصفحة", !db.calls.some((c) => c.pageerror), db.calls.filter((c) => c.pageerror).map((c) => c.pageerror).join(" | "));
  await page.screenshot({ path: `${OUT}/profit-lens-dashboard.png`, fullPage: true });
  await ctx.close();
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
