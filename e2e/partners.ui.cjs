// UI test of the new partners screens (migration 0137, owner «صفحة الشركاء غيرها كلها»): the partners tab with each
// partner's five numbers, the withdrawal dialog (200,000 «من الربح» with 150,000 profit → 150,000 + 50,000 advance) and its
// ONE partner_money call, the partner page whose cards filter the movements, and the add form («موظف وشريك», % salary of a
// branch, operating share) → save_partner with fractions. Database faked in the browser. Run:
//   npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/partners.ui.cjs
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

const partner = { id: P1, name: "شريك تجربة", role_kind: "partner", employee_id: null, capital_share: 1, operating_share: 0, is_active: true,
  salary_mode: "none", salary_amount: 0, salary_percent: 0, salary_base: "company", salary_branch_id: null, salary_when: "before",
  start_date: "2026-01-01", notes: null, initial_capital: 0 };
const mv = (id, type, amount, date, extra = {}) => ({ id, type, amount, date, created_at: `${date}T10:00:00Z`, description: null, branch_id: B1,
  method: "cash", void: false, cancel_reason: null, distribution_id: null, treasury_id: `t-${id}`, editable: false, cancellable: true, ...extra });
const cards = { partner, contributions: 1000000, capital_withdrawals: 200000, capital: 800000, profit: 150000, profit_in: 150000, profit_out: 0, advances: 0,
  movements: [mv("m1", "contribution", 1000000, "2026-09-15"), mv("m2", "capital_withdrawal", 200000, "2026-10-01"),
              mv("m3", "profit_share", 150000, "2026-10-31", { distribution_id: "d1", cancellable: false, branch_id: null, method: null, treasury_id: null })],
  advances_list: [] };

function makeDb() {
  return {
    calls: [],
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true }],
    user_roles: [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T }],
    branch_users: [], role_permissions: [], user_permissions: [], permission_templates: [], transfer_fees: [],
    branches: [{ id: B1, name: "معرض عبدالمنعم", code: "FR-004", tenant_id: T, is_active: true, is_system: false, platform_paused: false }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [{ id: E1, name: "محمد ياسر", tenant_id: T, is_active: true, user_id: null }],
    equity_partners: [partner],
  };
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
      if (name === "partners_overview") return json([{ ...cards, movements: undefined, advances_list: undefined }]);
      if (name === "partner_cards") return json(cards);
      if (name === "partner_money") return json({ treasury_id: "t9", capital: 0, profit: 150000, advance: 50000 });
      if (name === "save_partner") return json("b0000001-0000-4000-8000-000000000002");
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
const vis = (loc) => loc.first().isVisible().catch(() => false);
const settle = async (page) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(900); };
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
const money = (n) => new RegExp(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "[,٬]?"));

(async () => {
  const browser = await chromium.launch();
  const db = makeDb();
  const { page } = await open(browser, db, OWNER);

  // 1. the partners tab
  await page.goto(`${BASE}/admin/financial-position?tab=partners`); await settle(page);
  check("1. كارت الشريك ظاهر باسمه", await vis(page.getByText("شريك تجربة")));
  check("2. الأرقام الخمسة على الكارت (المساهمات، مسحوب من رأس المال، رأس المال، صافي الربح، السلف)",
    await vis(page.getByText("مسحوب من رأس المال")) && await vis(page.getByText("صافي الربح").first()) && await vis(page.getByText(/800[,٬]?000|٨٠٠/)));
  check("3. زراير «شريك جديد» و«حصص التشغيل والمرتبات»", await vis(page.getByRole("button", { name: /شريك جديد/ })) && await vis(page.getByRole("button", { name: /حصص التشغيل والمرتبات/ })));
  await shot(page, "partners-1-list");

  // 2. withdrawal «من الربح» above his profit
  await page.getByRole("button", { name: /^سحب$/ }).first().click(); await page.waitForTimeout(600);
  await page.locator('input[type="number"]').first().fill("200000"); await page.waitForTimeout(300);
  check("4. الشاشة بتقول: 150,000 من الربح + 50,000 سلفة", await vis(page.getByText(/من الربح \+ .*سلفة/)));
  await shot(page, "partners-2-withdraw");
  await page.getByRole("button", { name: /سجّل السحب/ }).click(); await page.waitForTimeout(500);
  check("5. من غير فرع: رفض ومفيش طلب للسيرفر", !db.calls.some((c) => c.rpc === "partner_money"));
  await page.getByRole("combobox").first().click(); await page.getByRole("option", { name: "معرض عبدالمنعم" }).click();
  await page.getByRole("button", { name: /سجّل السحب/ }).click(); await page.waitForTimeout(800);
  const pm = db.calls.find((c) => c.rpc === "partner_money");
  check("6. طلب واحد partner_money: سحب 200,000 من الربح من الفرع المختار نقدي",
    !!pm && pm.body.p_kind === "withdrawal" && pm.body.p_amount === 200000 && pm.body.p_source === "profit" && pm.body.p_branch === B1 && pm.body.p_method === "cash",
    JSON.stringify(pm?.body ?? {}));

  // 3. the partner page: cards filter the movements
  await page.goto(`${BASE}/admin/financial-position/partner/${P1}`); await settle(page);
  check("7. صفحة الشريك فيها الخمس كروت", await vis(page.getByText("رأس المال لحد النهارده")) && await vis(page.getByText("المسحوبات من رأس المال")) && await vis(page.getByText("السلف").first()));
  check("8. كل الحركات ظاهرة (3)", await vis(page.getByText("نصيبه من توزيع الأرباح")) && await vis(page.getByText("مساهمة في رأس المال")));
  await page.getByText("رأس المال لحد النهارده").first().click(); await page.waitForTimeout(500);
  check("9. دوسة على «رأس المال» بتعرض حركات رأس المال بس", await vis(page.getByText("حركات رأس المال")) && !(await vis(page.getByText("نصيبه من توزيع الأرباح"))));
  await shot(page, "partners-3-profile");

  // 4. the add form: employee and partner, % of a branch, operating share 10%
  await page.goto(`${BASE}/admin/financial-position?tab=partners`); await settle(page);
  await page.getByRole("button", { name: /شريك جديد/ }).click(); await page.waitForTimeout(600);
  await page.getByText("موظف وشريك").first().click();
  await page.getByRole("combobox").first().click(); await page.getByRole("option", { name: "محمد ياسر" }).click();
  await page.getByText("نسبة من صافي الربح").click();
  await page.getByPlaceholder("مثلاً 5").fill("5");
  await page.getByRole("dialog").getByRole("combobox").nth(1).click(); await page.getByRole("option", { name: "فرع واحد" }).click();
  await page.getByRole("dialog").getByRole("combobox").nth(2).click(); await page.getByRole("option", { name: "معرض عبدالمنعم" }).click();
  await page.getByRole("switch").click(); await page.getByPlaceholder("مثلاً 10").fill("10");
  await shot(page, "partners-4-form");
  await page.getByRole("button", { name: /ضيف الشريك/ }).click(); await page.waitForTimeout(800);
  const sp = db.calls.find((c) => c.rpc === "save_partner");
  const p = sp?.body?.p ?? {};
  check("10. save_partner: موظف وشريك، 5% من ربح الفرع، حصة تشغيل 10% (كسور)",
    p.role_kind === "employee_partner" && p.employee_id === E1 && p.salary_mode === "percent" && p.salary_percent === 0.05 && p.salary_base === "branch"
      && p.salary_branch_id === B1 && p.operating_share === 0.1, JSON.stringify(p));

  const errs = db.calls.filter((c) => c.pageerror);
  check("11. مفيش أخطاء في الصفحة", errs.length === 0, errs.map((e) => e.pageerror).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
