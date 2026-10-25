// UI test of branch levels / per-branch template / partners tab / monitoring accounts (migration 0122) against the local build, database faked in the browser.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/permissions.ui.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const OUT = process.env.OUT_DIR || __dirname;
const BASE = "http://127.0.0.1:4173";
const SB = "https://kkfiplnucefytutlwaiz.supabase.co";
const REF = "kkfiplnucefytutlwaiz";
const T = "5316fbfe-b862-4c91-b48b-1d81c8aa5a71";
const OWNER = "85c76e60-3d27-4a99-8cd7-c8f8b39d914a", CASH = "a3174891-0000-0000-0000-000000000001", MGR = "a3174891-0000-0000-0000-000000000002";
const PART = "06e224b7-0000-0000-0000-000000000003";
const B1 = "1329f6cc-0000-0000-0000-000000000001", B2 = "1329f6cc-0000-0000-0000-000000000002";

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.sig`;

function makeDb() {
  return {
    calls: [],
    profiles: [
      { id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true },
      { id: CASH, name: "mohayassr07", username: "mohayassr07", tenant_id: T, is_active: true },
      { id: MGR, name: "مدير الفرع", username: "mgr", tenant_id: T, is_active: true },
      { id: PART, name: "الحاج ناصر عبدالكريم ايوب", username: "nasser", tenant_id: T, is_active: true },
    ],
    user_roles: [
      { user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T },
      { user_id: CASH, role: "cashier", tenant_id: T }, { user_id: MGR, role: "branch_manager", tenant_id: T },
      { user_id: PART, role: "partner", tenant_id: T }, { user_id: PART, role: "viewer", tenant_id: T },
    ],
    branch_users: [
      { user_id: CASH, branch_id: B1, access_level: "manage", tenant_id: T },
      { user_id: CASH, branch_id: B2, access_level: "manage", tenant_id: T },
      { user_id: MGR, branch_id: B1, access_level: "manage", tenant_id: T },
    ],
    branches: [
      { id: B1, name: "معرض سكة تلة", code: "B1", tenant_id: T, is_active: true, is_system: false, platform_paused: false },
      { id: B2, name: "معرض عبدالمنعم الغربى", code: "B2", tenant_id: T, is_active: true, is_system: false, platform_paused: false },
    ],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [{ id: "e-cash", user_id: CASH, tenant_id: T, is_active: true }],
    role_permissions: [],
    user_permissions: [{ user_id: CASH, tenant_id: T, permission_key: "part.dashboard.gross_profit_today.view", allowed: false }],
    permission_templates: [],
    products: [{ id: "p1", name: "غسالة تجربة", sku: "SKU-1", branch_id: B1, tenant_id: T, quantity: 3, low_stock_alert: 1, cost_price: 100, selling_price: 150, market_price: 160, created_at: "2026-10-01T10:00:00Z" }],
  };
}

function filt(rows, url) {
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
    const m = /^eq\.(.*)$/.exec(v);
    if (m) rows = rows.filter((r) => r[k] === undefined || String(r[k]) === m[1]);
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
      if (name === "save_user_permissions") {
        db.user_permissions = db.user_permissions.filter((r) => r.user_id !== body.p_user)
          .concat(body.p_rows.map((r) => ({ user_id: body.p_user, tenant_id: T, permission_key: r.key, allowed: r.allowed, branch_id: r.branch ?? null })));
        return json(body.p_rows.length);
      }
      if (name === "branch_limit_status") return json({ limit: 3, used: 2, at_limit: false, pending: null });
      return json(null);
    }
    if (path.startsWith("/rest/v1/")) {
      const table = path.split("/").pop(); const method = req.method();
      if (method !== "GET" && method !== "HEAD") { let body = null; try { body = req.postDataJSON(); } catch {} db.calls.push({ table, method, body }); return json([]); }
      let rows = filt(db[table] ?? [], url);
      // the real API embeds the branch in branch_users («branches(*)»)
      if (table === "branch_users" && (url.searchParams.get("select") || "").includes("branches(")) rows = rows.map((r) => ({ ...r, branches: db.branches.find((b) => b.id === r.branch_id) }));
      const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
      if (single) return rows.length ? json(rows[0]) : route.fulfill({ status: 406, contentType: "application/json", body: JSON.stringify({ code: "PGRST116", message: "0 rows" }) });
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }, body: JSON.stringify(rows) });
    }
    return json({});
  });
  const sess = { access_token: jwt(me), refresh_token: "r", token_type: "bearer", expires_in: 31536000, expires_at: 4102444800, user: { id: me, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } };
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(sess)]);
  return { ctx, page };
}

const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
const vis = (loc) => loc.first().isVisible().catch(() => false);
const settle = async (page) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(800); };
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });

(async () => {
  const browser = await chromium.launch();
  const db = makeDb();
  db.permission_templates = [{ id: "tpl-1", tenant_id: T, name: "مندوب مبيعات", base_role: "cashier", perms: { "treasury.view": false } }];
  const { ctx, page } = await open(browser, db, OWNER);
  await page.goto(`${BASE}/admin/settings?tab=user-permissions&user=${CASH}`); await settle(page);
  check("تابين: الموظفين والشركاء", await vis(page.getByRole("tab", { name: /^الموظفين \(/ })) && await vis(page.getByRole("tab", { name: /^الشركاء \(1\)/ })));
  check("الشريك مش في تاب الموظفين", !(await vis(page.getByRole("button", { name: /الحاج ناصر/ }))));
  const g1 = page.getByRole("radiogroup", { name: /شغله في معرض سكة تلة/ });
  check("كل فرع ليه: إدارة كاملة / إدارة جزئية / عرض فقط", await vis(g1.getByRole("radio", { name: "إدارة كاملة" })) && await vis(g1.getByRole("radio", { name: "عرض فقط" })));
  await g1.getByRole("radio", { name: "إدارة كاملة" }).click();
  const g2 = page.getByRole("radiogroup", { name: /شغله في معرض عبدالمنعم الغربى/ });
  await g2.getByRole("radio", { name: "إدارة جزئية" }).click();
  await page.getByRole("combobox", { name: /القالب في معرض عبدالمنعم الغربى/ }).click();
  await page.getByRole("option", { name: "مندوب مبيعات" }).click();
  await page.waitForTimeout(300);
  await shot(page, "branch-levels");
  check("شريط الفرع بيقول شغله في كل فرع", await vis(page.getByRole("tab", { name: /سكة تلة · إدارة كاملة/ })) && await vis(page.getByRole("tab", { name: /عبدالمنعم الغربى · مندوب مبيعات/ })));
  await page.getByRole("tab", { name: /عبدالمنعم الغربى · مندوب مبيعات/ }).click(); await page.waitForTimeout(300);
  check("بتظبط عبدالمنعم على قالب «مندوب مبيعات»", await vis(page.getByText(/على قالب «مندوب مبيعات»/)));
  await page.getByRole("button", { name: "حفظ", exact: true }).click(); await page.waitForTimeout(1200);
  const ups = db.calls.filter((c) => c.table === "branch_users" && c.method === "PATCH").map((c) => c.body);
  check("الحفظ: سكة تلة full_access، وعبدالمنعم branch_template", ups.some((b) => b.full_access === true) && ups.some((b) => b.branch_template === "tpl-1" && b.full_access === false), JSON.stringify(ups));
  await page.getByRole("tab", { name: /^الشركاء/ }).click(); await page.getByRole("button", { name: /الحاج ناصر/ }).click(); await settle(page);
  await page.getByRole("tab", { name: /^العمليات/ }).click(); await page.waitForTimeout(300);
  const lockedBtn = page.getByRole("button", { name: /الشريك عرض بس/ }).first();
  check("الشريك: أزرار التعديل مقفولة ومكتوب «الشريك عرض بس»", await vis(lockedBtn) && await lockedBtn.isDisabled());
  await shot(page, "partner-locked");
  await page.getByRole("tab", { name: /^الموظفين/ }).click(); await page.waitForTimeout(200);
  await page.getByRole("button", { name: /حساب مراقبة جديد/ }).click(); await page.waitForTimeout(300);
  check("«حساب مراقبة جديد» جوه شاشة الموظفين", await vis(page.getByLabel("الإيميل")));
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/admin/settings?tab=viewers`); await settle(page);
  check("الرابط القديم «حسابات المراقبة» بيفتح الموظفين", await vis(page.getByRole("tab", { name: /^الشركاء/ })) && !(await vis(page.getByRole("button", { name: "حسابات المراقبة" }))));
  const errs = db.calls.filter((c) => c.pageerror); if (errs.length) check("مفيش أخطاء في الصفحة", false, errs.map((x) => x.pageerror).join(" | "));
  await ctx.close(); await browser.close();
  console.log(results.join("\n"));
})();
