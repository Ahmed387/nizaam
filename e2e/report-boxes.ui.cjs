// «ظبّط رأس مال الشركاء» (migration 0275, owner «نفذ» 2026-11-19): the owner opens the 4-step wizard from the partners tab,
// sees the books' first day and the net worth, types each partner's capital (above the net worth is refused), adds a cash
// contribution, reviews before → after (preview call, nothing saved) and saves with ONE call. Database faked in the browser.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/partner-capital.ui.cjs
const { chromium } = require("playwright");
const OUT = process.env.OUT_DIR || __dirname;
const BASE = "http://127.0.0.1:4173";
const SB = "https://kkfiplnucefytutlwaiz.supabase.co";
const REF = "kkfiplnucefytutlwaiz";
const T = "5316fbfe-b862-4c91-b48b-1d81c8aa5a71";
const OWNER = "85c76e60-3d27-4a99-8cd7-c8f8b39d914a";
const B1 = "7a9f9e1b-d6ae-47c0-9965-bf23d0d31213";
const P1 = "b0000001-0000-4000-8000-000000000001";
const E1 = "e0000001-0000-4000-8000-000000000009";

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.sig`;



// Every box of «الربحية» has its OWN «ظاهر / مخفي» switch in «افتح الصفحة وظبطها» (owner 2026-11-25: the margin card,
// «أعلى 10» and «أقل 10» each alone, the report text, the filters, both tables). Database faked in the browser.
// Run: build + vite preview :4173, then node e2e/report-boxes.ui.cjs
const MGR = "c0000001-0000-4000-8000-000000000003";
const inv = (id, no) => ({ id, invoice_number: no, branch_id: B1, created_at: "2026-11-20T10:00:00Z", invoice_date: "2026-11-20T10:00:00Z", status: "active", cashier_id: MGR, is_migrated: false, migration_batch_id: null });
const item = (pid, name, qty, price, cost, invoice) => ({ tenant_id: T, product_id: pid, product_name: name, brand: null, model: null, color: null, product_type: null, capacity: null, size: null,
  quantity: qty, returned_quantity: 0, original_unit_cost: cost, selling_price: price, unit_cost_at_sale: cost, line_discount: 0, invoice });
function makeDb() {
  return { calls: [],
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true },
               { id: MGR, name: "محمد طه", username: "mt", tenant_id: T, is_active: true }],
    user_roles: [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T }, { user_id: MGR, role: "branch_manager", tenant_id: T }],
    branch_users: [{ user_id: MGR, branch_id: B1, tenant_id: T }], role_permissions: [], user_permissions: [], permission_templates: [], transfer_fees: [],
    branches: [{ id: B1, name: "معرض عبدالمنعم", code: "FR-004", tenant_id: T, is_active: true, is_system: false, platform_paused: false }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    categories: [], products: [],
    invoice_items: [item("p1", "تكييف هاير", 1, 38700, 30000, inv("i1", "IN1")), item("p2", "قطعة 4 مخرج", 1, 60, 120, inv("i2", "IN2"))] };
}
function filt(rows, url) {
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(k) || k.includes(".")) continue;
    const m = /^(eq|neq|is|in)\.(.*)$/.exec(v); if (!m) continue;
    const [, op, raw] = m;
    rows = rows.filter((r) => {
      const x = r[k];
      if (op === "eq") return x === undefined || String(x) === raw;
      if (op === "neq") return String(x) !== raw;
      if (op === "is") return raw === "null" ? x == null : String(x) === raw;
      return raw.replace(/[()"]/g, "").split(",").includes(String(x));
    });
  }
  return rows;
}

async function open(browser, db, me) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar-EG" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => db.calls.push({ pageerror: String(e).slice(0, 300) }));
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
      if (name === "ledger_position") return json({ customers: {}, suppliers: {}, cross_branch: {} });   // the page's other cards
      return json(null);
    }
    if (path.startsWith("/rest/v1/")) {
      const table = path.split("/").pop(); const method = req.method();
      if (method !== "GET" && method !== "HEAD") { db.calls.push({ table, method }); return json([]); }
      const rows = filt(db[table] ?? [], url);
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
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const db = makeDb();
  const { page } = await open(browser, db, OWNER);
  await page.goto(`${BASE}/admin/reports-hub?tab=profitability&perm_for=${MGR}`); await settle(page);
  await page.getByRole("button", { name: "أظهر الكل" }).click(); await page.waitForTimeout(600);
  await page.getByRole("button", { name: "تشغيل" }).click({ timeout: 8000 }); await settle(page);
  const chips = await page.locator("[data-perm-part] > button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label") || ""));
  const has = (t) => chips.some((c) => c.includes(t));
  await page.screenshot({ path: `${OUT}/report-boxes-1.png`, fullPage: true });
  for (const t of ["أعلى/أقل هامش", "أعلى 10 منتجات بالهامش", "أقل 10 منتجات بالهامش", "شرح التقرير", "فلاتر تقرير الربحية", "الربحية حسب المنتج", "الربحية حسب الفاتورة"])
    check(`زرار لوحده: ${t}`, has(t));
  check("الكروت التلاتة اللي كانت شغالة لسه ليها زرار", has("المبيعات (Revenue)") && has("صافي الربح"), chips.length + " زرار");
  // hide «أقل 10» alone: «أعلى 10» stays visible
  await page.locator('[data-perm-part] > button[aria-label*="أقل 10 منتجات بالهامش"]').first().click(); await page.waitForTimeout(500);
  const low = page.locator('[data-perm-part]:has(> button[aria-label*="أقل 10 منتجات بالهامش"])').first();
  const lowHidden = (await low.locator("> button").getAttribute("aria-pressed")) === "false";
  const top = page.locator('[data-perm-part]:has(> button[aria-label*="أعلى 10 منتجات بالهامش"])').first();
  const topHidden = (await top.locator("> button").getAttribute("aria-pressed")) === "false";
  check("إخفاء «أقل 10» بس — «أعلى 10» فاضل ظاهر", lowHidden && !topHidden);
  await page.screenshot({ path: `${OUT}/report-boxes.png`, fullPage: true });
  const errs = db.calls.filter((c) => c.pageerror);
  check("مفيش أخطاء في الصفحة", errs.length === 0, errs.map((e) => e.pageerror).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
