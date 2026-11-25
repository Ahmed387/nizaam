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

const P2 = "b0000001-0000-4000-8000-000000000002";
const cards2 = { partner: { ...partner, id: P2, name: "الحاج ناصر" }, contributions: 800000, capital_withdrawals: 0, capital: 800000, profit: 0, profit_in: 0, profit_out: 0, advances: 0, movements: [], advances_list: [] };
const SHARES = { from: "2026-10-01", to: "2026-10-31", net_before: 300000, total: 39000, already: false,
  months: [{ month: "2026-10", from: "2026-10-01", to: "2026-10-31", net_before: 300000, pay: 39000,
    lines: [{ partner_id: P1, name: "شريك تجربة", kind: "fixed", amount: 10000 }, { partner_id: P1, name: "شريك تجربة", kind: "percent", percent: 0.1, percent_base: "after_fixed", base: 290000, amount: 29000 }] }],
  rows: [{ key: `${P1}:salary`, partner_id: P1, name: "شريك تجربة", kind: "salary_share", amount: 10000, computed: 10000, percent: 0, base: 0, branch_id: null, typed: false, needs_owner: false },
         { key: `${P1}:operating`, partner_id: P1, name: "شريك تجربة", kind: "operating_share", amount: 29000, computed: 29000, percent: 0.1, base: 290000, branch_id: null, typed: false, needs_owner: false }] };
function makeDb() {
  return {
    calls: [],
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true }],
    user_roles: [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T }],
    branch_users: [], role_permissions: [], user_permissions: [], permission_templates: [], transfer_fees: [],
    branches: [{ id: B1, name: "معرض عبدالمنعم", code: "FR-004", tenant_id: T, is_active: true, is_system: false, platform_paused: false }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [{ id: E1, name: "محمد ياسر", tenant_id: T, is_active: true, user_id: null }],
    equity_partners: [partner], partner_pay_rules: [],
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
      if (name === "partners_overview") return json([{ ...cards, movements: undefined, advances_list: undefined },
        { ...cards2, movements: undefined, advances_list: undefined }]);
      if (name === "partner_existing_capital") return json("tx-existing");
      if (name === "set_partner_pay_rule") return json("rule-1");
      if (name === "post_partner_period_shares") return json({ posted: 2 });
      if (name === "partner_period_shares_preview") return json(SHARES);
      if (name === "preview_flexible_distribution") return json({ net_profit: { net_profit: 0 }, distributable: 0, partners: [] });
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
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const db = makeDb();
  const { page } = await open(browser, db, OWNER);

  // 1. the partners tab: 5 tabs, no «نظرة عامة», each card with his % and his pay
  await page.goto(`${BASE}/admin/financial-position`); await settle(page);
  const tabs = await page.getByRole("tab").allInnerTexts();
  check("1. التابات: الشركاء / رأس المال / توزيع الأرباح / الحركات / القوائم المالية — ومفيش «نظرة عامة»",
    ["الشركاء", "رأس المال", "توزيع الأرباح", "الحركات", "القوائم المالية"].every((t) => tabs.some((x) => x.includes(t))) && !tabs.some((x) => x.includes("نظرة عامة")), tabs.join(" | "));
  check("2. كارت كل شريك بالأرقام الخمسة", await vis(page.getByText("شريك تجربة")) && await vis(page.getByText("مسحوب من رأس المال").first()));
  const sharesTxt = await page.getByTestId("partner-share").allInnerTexts();
  check("3. نصيب كل واحد من الربح على كارته (800 ألف + 800 ألف → 50% / 50%)", sharesTxt.length === 2 && sharesTxt.every((t) => t.trim() === "50%"), sharesTxt.join(","));
  check("3b. مرتبه على الكارت: «مالوش مرتب»", (await page.getByTestId("partner-pay").first().innerText()).includes("مالوش مرتب"));
  check("3c. زراير الويزارد و«حصص التشغيل» القديمة اتشالت", !(await vis(page.getByRole("button", { name: /ظبّط رأس مال|حصص التشغيل/ }))));
  await shot(page, "partners-1-list");

  // 2. withdrawal «من الربح» above his profit (unchanged money door)
  await page.getByRole("button", { name: /^سحب$/ }).first().click(); await page.waitForTimeout(600);
  await page.locator('input[type="number"]').first().fill("200000"); await page.waitForTimeout(300);
  check("4. السحب: 150,000 من الربح + 50,000 سلفة", await vis(page.getByText(/من الربح \+ .*سلفة/)));
  await page.getByRole("button", { name: /سجّل السحب/ }).click(); await page.waitForTimeout(500);
  check("5. من غير فرع: رفض ومفيش طلب للسيرفر", !db.calls.some((c) => c.rpc === "partner_money"));
  await page.getByRole("combobox").first().click(); await page.getByRole("option", { name: "معرض عبدالمنعم" }).click();
  await page.getByRole("button", { name: /سجّل السحب/ }).click(); await page.waitForTimeout(800);
  const pm = db.calls.find((c) => c.rpc === "partner_money");
  check("6. طلب واحد partner_money بالفرع المختار", !!pm && pm.body.p_amount === 200000 && pm.body.p_branch === B1, JSON.stringify(pm?.body ?? {}));

  // 3. «رأس المال»: «موجود بالفعل» shows the % before → after, then ONE call
  await page.getByRole("tab", { name: "رأس المال" }).click(); await settle(page);
  check("7. جدول رأس المال: إجمالي 1,600,000 وكل واحد 50%", await vis(page.getByText(money(1600000))));
  await page.getByRole("button", { name: /موجود بالفعل/ }).first().click(); await page.waitForTimeout(500);
  await page.locator("#ex-amount").fill("1600000"); await page.waitForTimeout(300);
  const eff = await page.getByTestId("existing-effect").innerText().catch(() => "");
  check("8. قبل الحفظ: نسبته 50% ← 75% والخزن مش هتتغير", eff.includes("50%") && eff.includes("75%") && eff.includes("الخزن"), eff.replace(/\n/g, " "));
  await shot(page, "partners-5-existing");
  await page.getByRole("dialog").getByRole("button", { name: "سجّل" }).click(); await page.waitForTimeout(700);
  const ex = db.calls.filter((c) => c.rpc === "partner_existing_capital");
  check("9. partner_existing_capital مرة واحدة: 1,600,000 من 2026-01-01", ex.length === 1 && ex[0].body.p_amount === 1600000 && ex[0].body.p_day === "2026-01-01" && ex[0].body.p_partner === P1, JSON.stringify(ex[0]?.body ?? {}));

  // 4. «توزيع الأرباح»: the owner's example, then the pay dialog, then step 1
  await page.getByRole("tab", { name: "توزيع الأرباح" }).click(); await settle(page);
  await page.getByRole("button", { name: /حدد مرتبه/ }).first().click(); await page.waitForTimeout(500);
  const d = page.getByRole("dialog");
  await d.getByLabel("الاتنين").click();
  await d.getByLabel("المرتب الثابت في الشهر").fill("10000");
  await d.getByLabel("النسبة %").fill("10");
  await d.getByLabel("لو الشهر كسب").fill("300000"); await page.waitForTimeout(300);
  const ex1 = await d.getByTestId("pay-example").innerText();
  check("10. المثال: 300,000 → شريك تجربة 169,500 والحاج ناصر 130,500", /169[,٬]?500/.test(ex1) && /130[,٬]?500/.test(ex1), ex1.replace(/\n/g, " | "));
  await d.getByLabel("لو الشهر كسب").fill("-50000"); await page.waitForTimeout(300);
  const ex2 = await d.getByTestId("pay-example").innerText();
  check("11. الشهر الخسران −50,000: المرتب الثابت بيتصرف والنسبة صفر، −30,000 على كل واحد", /10[,٬]?000/.test(ex2) && /30[,٬]?000/.test(ex2), ex2.replace(/\n/g, " | "));
  await shot(page, "partners-6-pay");
  await d.getByRole("button", { name: /احفظ من شهر/ }).click(); await page.waitForTimeout(700);
  const sr = db.calls.filter((c) => c.rpc === "set_partner_pay_rule");
  check("12. set_partner_pay_rule: 10,000 ثابت + 10% بعد الثابت، من أول الشهر", sr.length === 1 && sr[0].body.p_fixed === 10000 && sr[0].body.p_percent === 0.1
    && sr[0].body.p_percent_base === "after_fixed" && /-01$/.test(sr[0].body.p_from_month), JSON.stringify(sr[0]?.body ?? {}));
  check("13. خطوة 1: شهر بشهر — صافي قبل المرتبات والمرتبات والباقي", await vis(page.getByText("خطوة 1: سجّل مرتبات الشركاء للفترة")) && await vis(page.getByText(money(261000)).first()));
  await page.getByRole("button", { name: "سجّل مرتبات الشركاء" }).click(); await page.waitForTimeout(700);
  check("14. «سجّل مرتبات الشركاء» = post_partner_period_shares مرة واحدة", db.calls.filter((c) => c.rpc === "post_partner_period_shares").length === 1);
  check("15. خطوة 2 (التوزيع على رأس المال) جوه نفس التاب", await vis(page.getByText("خطوة 2: وزّع الباقي على رأس المال")));
  await shot(page, "partners-7-distribution");

  // 5. «القوائم المالية» inside the page; its own tabs do not move the page's tab
  await page.getByRole("tab", { name: "القوائم المالية" }).click(); await settle(page);
  check("16. تاب القوائم المالية جوه صفحة الشركاء", await vis(page.getByRole("tab", { name: /قائمة الدخل|الدخل/ }).first()) && page.url().includes("tab=statements"));

  // 6. the add form: no pay fields there any more
  await page.getByRole("tab", { name: "الشركاء" }).click(); await settle(page);
  await page.getByRole("button", { name: /شريك جديد/ }).click(); await page.waitForTimeout(500);
  check("17. فورم الشريك الجديد من غير خانات مرتب / حصة تشغيل (بقت في «توزيع الأرباح»)",
    !(await vis(page.getByRole("dialog").getByText("حصة تشغيل؟"))) && await vis(page.getByRole("dialog").getByText(/توزيع الأرباح/).first()));
  await shot(page, "partners-4-form");
  await page.keyboard.press("Escape");

  // 7. the partner page still works
  await page.goto(`${BASE}/admin/financial-position/partner/${P1}`); await settle(page);
  check("18. صفحة الشريك فيها الخمس كروت", await vis(page.getByText("رأس المال لحد النهارده")) && await vis(page.getByText("السلف").first()));
  await shot(page, "partners-3-profile");

  check("18b. مفيش رسالة خطأ ظهرت (toast) في أي خطوة", !(await vis(page.getByText(/حصل خطأ/))));
  const errs = db.calls.filter((c) => c.pageerror);
  check("19. مفيش أخطاء في الصفحة", errs.length === 0, errs.map((e) => e.pageerror).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
