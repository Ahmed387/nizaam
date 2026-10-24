// UI test of the permissions redesign (migration 0114) against the local build, database faked in the browser.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/permissions.ui.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const OUT = process.env.OUT_DIR || __dirname;
const BASE = "http://127.0.0.1:4173";
const SB = "https://kkfiplnucefytutlwaiz.supabase.co";
const REF = "kkfiplnucefytutlwaiz";
const T = "5316fbfe-b862-4c91-b48b-1d81c8aa5a71";
const OWNER = "85c76e60-3d27-4a99-8cd7-c8f8b39d914a", CASH = "a3174891-0000-0000-0000-000000000001", MGR = "a3174891-0000-0000-0000-000000000002";
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
    ],
    user_roles: [
      { user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T },
      { user_id: CASH, role: "cashier", tenant_id: T }, { user_id: MGR, role: "branch_manager", tenant_id: T },
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
  // 1) owner — the new employees screen, per branch
  let db = makeDb();
  let { ctx, page } = await open(browser, db, OWNER);
  await page.goto(`${BASE}/admin/settings?tab=user-permissions`); await settle(page);
  check("تاب «الموظفين» هو أول تاب في المستخدمين والصلاحيات", await vis(page.getByRole("button", { name: "الموظفين" })));
  check("تاب «القوالب (الأدوار)» موجود", await vis(page.getByRole("button", { name: "القوالب (الأدوار)" })));
  check("قايمة الموظفين فيها الكاشير ومدير الفرع ومن غير المالك", await vis(page.getByRole("button", { name: /mohayassr07/ })) && await vis(page.getByRole("button", { name: /مدير الفرع/ })) && !(await vis(page.getByRole("button", { name: /^احمد ناصر/ }))));
  await page.getByRole("button", { name: /mohayassr07/ }).click(); await page.waitForTimeout(800);
  check("فتح الموظف: حساب الدخول + الاستثناء المحفوظ «ممنوع استثناءً 1»", await vis(page.getByText("حساب الدخول: mohayassr07")) && await vis(page.getByText(/ممنوع استثناءً 1/)));
  check("مفيش معاينة تانية (اتشالت بطلبك)", !(await vis(page.getByText(/معاينة/))));
  check("فوق: «الفرع: كل الفروع / سكة تلة / عبدالمنعم الغربى»", await vis(page.getByRole("tab", { name: /كل الفروع/ })) && await vis(page.getByRole("tab", { name: /عبدالمنعم/ })));
  await shot(page, "p1-employee");
  await page.getByRole("tab", { name: /عبدالمنعم/ }).click(); await page.waitForTimeout(300);
  check("بيقول إنك بتظبط فرع عبدالمنعم الغربى بس", await vis(page.getByText(/بتظبط فرع «معرض عبدالمنعم الغربى» بس/)));
  await page.getByRole("switch", { name: "إخفاء الرئيسية" }).click(); await page.waitForTimeout(300);
  check("عداد التغييرات على الفرع «· 1 متعدّل»", await vis(page.getByRole("tab", { name: /عبدالمنعم الغربى · 1 متعدّل/ })));
  await shot(page, "p2-branch");
  await page.getByRole("button", { name: "حفظ", exact: true }).click(); await page.waitForTimeout(800);
  const save = db.calls.find((c) => c.rpc === "save_user_permissions");
  check("الحفظ: الرئيسية مقفولة في عبدالمنعم الغربى بس", !!save && save.body.p_rows.some((r) => r.key === "dashboard.view" && r.allowed === false && r.branch === B2), save ? JSON.stringify(save.body.p_rows) : "مفيش");

  // 2) owner — «افتح الصفحة وظبطها» in سكة تلة
  await page.getByRole("tab", { name: /سكة تلة/ }).click(); await page.waitForTimeout(300);
  await page.getByRole("link", { name: /افتح الصفحة وظبطها/ }).first().click(); await settle(page); await page.waitForTimeout(800);
  check("فتح رئيسية سكة تلة نفسها بأزرار الإظهار والإخفاء", page.url().includes(`/branch/${B1}/dashboard`) && await vis(page.getByText(/بتظبط اللي يظهر لـ mohayassr07/)), page.url().replace(BASE, ""));
  check("الاختيار «الفرع ده بس» متعلم", (await page.getByRole("radio", { name: "الفرع ده بس" }).getAttribute("aria-checked").catch(() => null)) === "true");
  check("الكارت المخفي من قبل عليه «مخفي عن mohayassr07»", await vis(page.getByText("مخفي عن mohayassr07")));
  await page.getByRole("button", { name: /إخفاء مبيعات الشهر عن mohayassr07/ }).click(); await page.waitForTimeout(300);
  await shot(page, "p3-customize");
  await page.getByRole("button", { name: "شوفها بعينه" }).click(); await page.waitForTimeout(400);
  check("«شوفها بعينه» بتشيل الأزرار", !(await vis(page.getByRole("button", { name: /إخفاء مبيعات اليوم عن/ }))));
  await shot(page, "p4-as-him");
  await page.getByRole("button", { name: "رجّع الأزرار" }).click();
  await page.getByRole("button", { name: "حفظ وخروج" }).click(); await page.waitForTimeout(1200);
  const save2 = db.calls.filter((c) => c.rpc === "save_user_permissions").pop();
  check("حفظ وخروج: «مبيعات الشهر» مخفية في سكة تلة بس، والرئيسية لسه مقفولة في عبدالمنعم", !!save2
    && save2.body.p_rows.some((r) => r.key === "part.dashboard.sales_month.view" && r.allowed === false && r.branch === B1)
    && save2.body.p_rows.some((r) => r.key === "dashboard.view" && r.branch === B2), save2 ? JSON.stringify(save2.body.p_rows) : "");
  check("رجع لصفحة صلاحيات نفس الموظف", page.url().includes(`user=${CASH}`), page.url().replace(BASE, ""));

  // 2b) any page: cards, tabs and table columns tag themselves (reports of the branch manager)
  await page.goto(`${BASE}/branch/${B1}/reports?perm_for=${MGR}`); await settle(page); await page.waitForTimeout(800);
  check("التقارير: زرار على كارت «صافي الربح»", await vis(page.getByRole("button", { name: /إخفاء صافي الربح عن مدير الفرع/ })));
  check("التقارير: زرار على كل تاب", await vis(page.getByRole("button", { name: /إخفاء تاب أكثر مبيعاً عن مدير الفرع/ })));
  await page.getByRole("tab", { name: /أكثر مبيعاً/ }).click(); await page.waitForTimeout(400);
  check("التقارير: عين على كل عمود في الجدول", await vis(page.getByRole("button", { name: /إخفاء عمود الإيراد عن مدير الفرع/ })));
  await shot(page, "p5-reports");
  const e1 = db.calls.filter((c) => c.pageerror); if (e1.length) check("مفيش أخطاء في الصفحة", false, e1.map((x) => x.pageerror).join(" | "));
  await ctx.close();

  // 3) the cashier himself — what he sees in each branch
  ({ ctx, page } = await open(browser, db, CASH));
  await page.goto(`${BASE}/branch/${B1}/dashboard`); await settle(page); await page.waitForTimeout(800);
  check("سكة تلة: الكاشير مش شايف «مبيعات الشهر» ولا «مجمل ربح اليوم»", !(await vis(page.getByText("مبيعات الشهر"))) && !(await vis(page.getByText("مجمل ربح اليوم"))));
  check("سكة تلة: لسه شايف «مبيعات اليوم»", await vis(page.getByText("مبيعات اليوم")));
  check("قايمته الجانبية بالأقسام (عام / العمليات)", await vis(page.getByText("عــام")) && await vis(page.getByText("العمليـات")));
  await shot(page, "p6-cashier-b1");
  await page.goto(`${BASE}/branch/${B2}/dashboard`); await settle(page); await page.waitForTimeout(800);
  check("عبدالمنعم الغربى: الرئيسية مقفولة عليه (بيرجع لرئيسية فرع مسموحله)", !page.url().includes(`/branch/${B2}/dashboard`), page.url().replace(BASE, ""));
  await shot(page, "p7-cashier-b2");
  const e2 = db.calls.filter((c) => c.pageerror); if (e2.length) check("مفيش أخطاء عند الكاشير", false, e2.map((x) => x.pageerror).join(" | "));
  await ctx.close();

  // 4) templates screen
  db = makeDb();
  ({ ctx, page } = await open(browser, db, OWNER));
  await page.goto(`${BASE}/admin/settings?tab=permissions`); await settle(page);
  check("شاشة القوالب فيها الأدوار التمانية", await vis(page.getByRole("button", { name: /مدير فرع/ })) && await vis(page.getByRole("button", { name: /سواق/ })));
  check("زرار «قالب جديد»", await vis(page.getByRole("button", { name: /قالب جديد/ })));
  await shot(page, "p8-templates");
  await ctx.close();

  await browser.close();
  fs.writeFileSync(`${OUT}/permissions-results.txt`, results.join("\n"));
  console.log(results.join("\n"));
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
