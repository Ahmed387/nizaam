// UI test of the platform-owner screens against the local build, with the database faked in the browser.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/platform-owner.ui.cjs (screenshots + results.txt next to this file).
const { chromium } = require("playwright");
const fs = require("fs");
const OUT = __dirname;
const BASE = "http://127.0.0.1:4173";
const SB = "https://kkfiplnucefytutlwaiz.supabase.co";
const REF = "kkfiplnucefytutlwaiz";

const SUPER = "6739ed29-f36f-4bec-8f72-0fba66b01232";
const T_AN = "5316fbfe-b862-4c91-b48b-1d81c8aa5a71", T2 = "22222222-2222-2222-2222-222222222222";
const B1 = "b1111111-1111-1111-1111-111111111111", B2 = "b2222222-2222-2222-2222-222222222222";

function b64url(o) { return Buffer.from(JSON.stringify(o)).toString("base64url"); }
function jwt(sub) { return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.sig`; }

function world(kind) {
  const now = new Date().toISOString();
  const s = {
    calls: [],
    users: {
      super: { id: SUPER, email: "www201820192020@gmail.com", roles: ["super_admin"], tenant: T_AN, branches: [] },
      owner: { id: "0000000a-0000-0000-0000-00000000000a", email: "owner@test.local", roles: ["owner", "admin"], tenant: T2, branches: [] },
      cashier: { id: "0000000c-0000-0000-0000-00000000000c", email: "cash@test.local", roles: ["cashier"], tenant: T2, branches: [B1] },
    },
    tenants: [
      { id: T_AN, name: "A & N", slug: "an", is_active: true, is_suspended: false, created_at: now, business_type: "أجهزة كهربائية — بيع وشراء", max_branches: 3, is_test: false, owner_user_id: "85c76e60-3d27-4a99-8cd7-c8f8b39d914a", setup_completed: true },
      { id: T2, name: "شركة اختبار مخفية", slug: "zz-test", is_active: true, is_suspended: false, created_at: now, business_type: "مطعم", max_branches: 2, is_test: true, owner_user_id: "0000000a-0000-0000-0000-00000000000a", setup_completed: true },
    ],
    branches: [
      { id: B1, name: "فرع المعادي", code: "ZZ-1", tenant_id: T2, is_active: true, is_system: false, platform_paused: kind === "cashierPaused", platform_paused_reason: null, created_at: now },
      { id: B2, name: "فرع الدقي", code: "ZZ-2", tenant_id: T2, is_active: true, is_system: false, platform_paused: false, platform_paused_reason: null, created_at: now },
    ],
    requests: kind === "super" ? [{ id: "r1", tenant_id: T2, requested_by_name: "مالك اختبار", branch_name: "فرع الهرم", note: "زحمة", limit_at_request: 2, branches_at_request: 2, status: "pending", new_limit: null, created_at: now, decided_at: null }] : [],
  };
  return s;
}

function rowsFor(s, table, me) {
  switch (table) {
    case "profiles": return [{ id: me.id, name: me.email.split("@")[0], username: me.email.split("@")[0], tenant_id: me.tenant, is_active: true }];
    case "user_roles": return me.roles.map((role) => ({ role, user_id: me.id, tenant_id: me.tenant }));
    case "branch_users": return me.branches.map((id) => ({ branch_id: id, access_level: "manage", branches: s.branches.find((b) => b.id === id) }));
    case "tenants": return me.roles.includes("super_admin") ? s.tenants : s.tenants.filter((t) => t.id === me.tenant);
    case "branches": return s.branches.filter((b) => me.roles.includes("super_admin") || b.tenant_id === me.tenant);
    case "branch_limit_requests": return s.requests;
    default: return [];
  }
}

function applyFilters(rows, url) {
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    const m = /^eq\.(.*)$/.exec(v);
    if (m) rows = rows.filter((r) => r[k] === undefined || String(r[k]) === m[1]);
  }
  return rows;
}

function rpc(s, name, body, me) {
  s.calls.push({ rpc: name, body });
  const t2 = s.tenants.find((t) => t.id === T2);
  switch (name) {
    case "super_list_users": return [{ id: "0000000a-0000-0000-0000-00000000000a", email: "owner@test.local", name: "مالك اختبار", tenant_id: T2, roles: ["owner", "admin"] }];
    case "branch_limit_status": {
      const used = s.branches.filter((b) => b.tenant_id === me.tenant && !b.is_system).length;
      const pend = s.requests.find((r) => r.tenant_id === me.tenant && r.status === "pending");
      return { limit: t2.max_branches, used, at_limit: used >= t2.max_branches, pending: pend ? { id: pend.id, branch_name: pend.branch_name, created_at: pend.created_at } : null };
    }
    case "request_branch_increase": {
      s.requests.push({ id: "r9", tenant_id: me.tenant, requested_by_name: "مالك اختبار", branch_name: body.p_branch_name, note: body.p_note, limit_at_request: 2, branches_at_request: 2, status: "pending", new_limit: null, created_at: new Date().toISOString(), decided_at: null });
      return { id: "r9" };
    }
    case "super_decide_branch_request": {
      const r = s.requests.find((x) => x.id === body.p_request);
      r.status = body.p_approve ? "approved" : "rejected"; r.new_limit = body.p_approve ? (body.p_new_limit ?? r.limit_at_request + 1) : null; r.decided_at = new Date().toISOString();
      if (body.p_approve) t2.max_branches = r.new_limit;
      return { status: r.status, new_limit: r.new_limit };
    }
    case "super_set_branch_paused": { const b = s.branches.find((x) => x.id === body.p_branch); b.platform_paused = body.p_paused; b.platform_paused_reason = body.p_reason; return null; }
    case "super_update_tenant": { Object.assign(t2, { name: body.p_name ?? t2.name, business_type: body.p_business_type ?? t2.business_type, max_branches: body.p_max_branches ?? t2.max_branches }); return null; }
    case "my_paused_branches": return s.branches.filter((b) => me.branches.includes(b.id) && b.platform_paused).map((b) => ({ id: b.id, name: b.name }));
    case "super_delete_branch": throw { code: "P0001", message: "الفرع فيه شغل (فواتير أو فلوس أو موظفين) — ينفع يتوقف بس، مش يتحذف" };
    default: return null;
  }
}

async function session(page, me) {
  const sess = { access_token: jwt(me.id), refresh_token: "r", token_type: "bearer", expires_in: 3600 * 24 * 365, expires_at: 4102444800,
    user: { id: me.id, aud: "authenticated", role: "authenticated", email: me.email, app_metadata: { tenant_id: me.tenant }, user_metadata: {} } };
  await page.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(sess)]);
}

async function open(browser, s, who) {
  const me = s.users[who];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: "ar-EG" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => s.calls.push({ pageerror: String(e).slice(0, 200) }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(`${SB}/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    const json = (d, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
    if (path.startsWith("/auth/v1/user")) return json({ id: me.id, email: me.email, aud: "authenticated", app_metadata: {}, user_metadata: {} });
    if (path.startsWith("/auth/v1/")) return json({});
    if (path.startsWith("/functions/v1/")) {
      const fn = path.split("/").pop(); const body = req.postDataJSON?.() ?? null; s.calls.push({ fn, body });
      if (fn === "bootstrap-tenant") return json({ ok: true, tenant_id: "t-new", user_id: "u-new", branches: [], partners: [], chart_of_accounts_count: 64, trial_balance: { balanced: true } });
      return json({ ok: true });
    }
    if (path.startsWith("/rest/v1/rpc/")) {
      const name = path.split("/").pop(); let body = {}; try { body = req.postDataJSON() || {}; } catch {}
      try { return json(rpc(s, name, body, me)); } catch (e) { return json({ code: e.code, message: e.message, details: null, hint: null }, 400); }
    }
    if (path.startsWith("/rest/v1/")) {
      const table = path.split("/").pop(); const method = req.method();
      if (method !== "GET" && method !== "HEAD") { let body = null; try { body = req.postDataJSON(); } catch {} s.calls.push({ table, method, body, q: url.search });
        if (table === "tenants" && method === "PATCH") { const id = (url.searchParams.get("id") || "").replace("eq.", ""); Object.assign(s.tenants.find((t) => t.id === id) || {}, body); }
        return json([]); }
      const rows = applyFilters(rowsFor(s, table, me), url);
      const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
      if (single) return rows.length ? json(rows[0]) : route.fulfill({ status: 406, contentType: "application/json", body: JSON.stringify({ code: "PGRST116", message: "0 rows" }) });
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }, body: JSON.stringify(rows) });
    }
    return json({});
  });
  await session(page, me);
  return { ctx, page };
}

const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
async function shot(page, name) { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }); }
async function settle(page) { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(700); }

(async () => {
  const browser = await chromium.launch();
  // ---------- 1. platform owner ----------
  let s = world("super");
  let { ctx, page } = await open(browser, s, "super");
  await page.goto(`${BASE}/super/tenants`); await settle(page);
  check("صفحة الشركات بتفتح لصاحب المنصة", await page.getByText("شركة اختبار مخفية").first().isVisible().catch(() => false));
  check("الشركة التجريبية عليها علامة «تجريبية»", await page.getByText("تجريبية").first().isVisible().catch(() => false));
  check("الكارت بيعرض عدد الفروع من الحد", await page.getByText(/2 من 2/).first().isVisible().catch(() => false));
  await shot(page, "1-tenants");

  // create company
  const addBtn = page.getByRole("button", { name: /شركة جديدة|إضافة شركة|أضف شركة/ }).first();
  if (await addBtn.isVisible().catch(() => false)) {
    await addBtn.click(); await page.waitForTimeout(500); await shot(page, "2-create-form");
    const dlg = page.getByRole("dialog");
    const fill = async (label, v) => { const f = dlg.getByLabel(label, { exact: typeof label === "string" }).first(); if (await f.count()) await f.fill(v); return !!(await f.count()); };
    const filled = [await fill("اسم الشركة", "صيدلية النور"), await fill(/المعرف|slug/i, "nour-pharma"), await fill("اسم المالك", "أحمد ناصر"),
      await fill("إيميل المالك", "nour.owner@test.local"), await fill(/نوع الشركة|النشاط/, "صيدلية"), await fill(/عدد الفروع|حد الفروع|الفروع المسموح/, "4")];
    check("فورم إضافة شركة فيه كل الخانات (الاسم، المعرف، المالك، الإيميل، النوع، الحد)", filled.every(Boolean), filled.join(","));
    const sug = dlg.getByRole("button", { name: /اقتراح باسورد/ });
    check("زرار «اقتراح باسورد» موجود", await sug.isVisible().catch(() => false));
    if (await sug.isVisible().catch(() => false)) await sug.click();
    const testBox = dlg.getByLabel(/شركة تجريبية/); if (await testBox.count()) await testBox.check().catch(() => testBox.click());
    await shot(page, "3-create-filled");
    await dlg.getByRole("button", { name: /إنشاء|حفظ|أضف/ }).last().click(); await page.waitForTimeout(1200);
    const call = s.calls.find((c) => c.fn === "bootstrap-tenant");
    check("الإنشاء بيبعت النوع والحد والتجريبية للسيرفر", !!call && call.body?.business_type === "صيدلية" && call.body?.max_branches === 4 && call.body?.is_test === true,
      call ? JSON.stringify({ t: call.body.business_type, m: call.body.max_branches, test: call.body.is_test, pwdLen: (call.body.admin_password || "").length }) : "مفيش طلب");
    const pwd = call?.body?.admin_password || "";
    check("الباسورد بيظهر مرة واحدة بعد الإنشاء", pwd && await page.getByText(pwd).first().isVisible().catch(() => false));
    await shot(page, "4-password-once");
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    check("بعد قفل النافذة الباسورد مش ظاهر تاني", !(pwd && await page.getByText(pwd).first().isVisible().catch(() => false)));
  } else check("زرار إضافة شركة", false, "مش لاقيه");

  // company page
  await page.goto(`${BASE}/super/tenants/${T2}`); await settle(page);
  check("صفحة الشركة بتفتح بالفروع", await page.getByText("فرع المعادي").first().isVisible().catch(() => false));
  await shot(page, "5-company-page");
  const pauseBtn = page.getByRole("button", { name: /إيقاف|وقف/ }).first();
  if (await pauseBtn.isVisible().catch(() => false)) {
    await pauseBtn.click(); await page.waitForTimeout(400);
    const dlg = page.getByRole("dialog");
    const reason = dlg.locator("textarea, input").first(); if (await reason.count()) await reason.fill("متأخر في الاشتراك");
    await shot(page, "6-pause-dialog");
    await dlg.getByRole("button", { name: /إيقاف|وقف|تأكيد/ }).last().click(); await page.waitForTimeout(900);
    const c = s.calls.find((x) => x.rpc === "super_set_branch_paused");
    check("إيقاف فرع بيبعت للسيرفر مع السبب", !!c && c.body.p_paused === true && !!c.body.p_reason, c ? JSON.stringify(c.body) : "");
    await shot(page, "7-branch-paused");
    check("الفرع بيظهر «موقوف» بعد الإيقاف", await page.getByText(/موقوف/).first().isVisible().catch(() => false));
  } else check("زرار إيقاف الفرع", false, "مش لاقيه");
  const delBtn = page.getByRole("button", { name: /حذف الفرع|مسح الفرع/ }).first();
  if (await delBtn.isVisible().catch(() => false)) {
    await delBtn.click(); await page.waitForTimeout(400);
    const conf = page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: /حذف|مسح|تأكيد/ }).last();
    if (await conf.isVisible().catch(() => false)) await conf.click();
    await page.waitForTimeout(900);
    check("حذف فرع فيه شغل بيظهر رسالة «ينفع يتوقف بس»", await page.getByText(/ينفع يتوقف بس/).first().isVisible().catch(() => false));
    await shot(page, "8-delete-refused");
  }

  // requests
  await page.goto(`${BASE}/super/branch-requests`); await settle(page);
  check("صفحة الطلبات فيها الطلب المستني", await page.getByText("فرع الهرم").first().isVisible().catch(() => false));
  await shot(page, "9-requests");
  await page.getByRole("button", { name: /موافقة — يبقى 3 فروع/ }).click().catch(() => {}); await page.waitForTimeout(900);
  const d = s.calls.find((x) => x.rpc === "super_decide_branch_request");
  check("الموافقة بتزود فرع واحد", !!d && d.body.p_approve === true && d.body.p_new_limit === null);
  check("الطلب بيتنقل للطلبات القديمة", await page.getByText(/اتوافق \(الحد 3\)/).first().isVisible().catch(() => false));
  await shot(page, "10-approved");
  const sErr = s.calls.filter((c) => c.pageerror); if (sErr.length) check("مفيش أخطاء في الصفحة (صاحب المنصة)", false, sErr.map((e) => e.pageerror).join(" | "));
  await ctx.close();

  // ---------- 2. company owner at the limit ----------
  s = world("owner");
  ({ ctx, page } = await open(browser, s, "owner"));
  await page.goto(`${BASE}/admin/branches`); await settle(page);
  check("صاحب الشركة شايف «2 من 2»", await page.getByText(/2 من 2/).first().isVisible().catch(() => false));
  check("رسالة «تواصل مع صاحب المنصة» ظاهرة عند الحد", await page.getByText(/تواصل مع صاحب المنصة/).first().isVisible().catch(() => false));
  await shot(page, "11-owner-limit");
  const nameBox = page.getByLabel(/اسم الفرع/).last();
  if (await nameBox.count()) {
    await nameBox.fill("فرع الهرم");
    await page.getByRole("button", { name: /ابعت الطلب|إرسال الطلب|اطلب/ }).first().click(); await page.waitForTimeout(1000);
    const c = s.calls.find((x) => x.rpc === "request_branch_increase");
    check("صاحب الشركة بعت طلب فرع زيادة", !!c && c.body.p_branch_name === "فرع الهرم");
    check("بعد الطلب بيظهر إنه مستني الرد", await page.getByText(/مستني|مستنى/).first().isVisible().catch(() => false));
    await shot(page, "12-owner-requested");
  } else check("فورم طلب فرع زيادة", false, "مش لاقي خانة اسم الفرع");
  const oErr = s.calls.filter((c) => c.pageerror); if (oErr.length) check("مفيش أخطاء في الصفحة (المالك)", false, oErr.map((e) => e.pageerror).join(" | "));
  await ctx.close();

  // ---------- 3. cashier of a paused branch ----------
  s = world("cashierPaused");
  ({ ctx, page } = await open(browser, s, "cashier"));
  await page.goto(`${BASE}/`); await settle(page); await page.waitForTimeout(1500);
  check("الكاشير اتحول لصفحة الفرع الموقوف", page.url().includes("/branch-paused"), page.url().replace(BASE, ""));
  check("الصفحة بتكتب اسم الفرع", await page.getByText(/فرع المعادي موقوف مؤقتاً/).first().isVisible().catch(() => false));
  await shot(page, "13-cashier-paused");
  const cErr = s.calls.filter((c) => c.pageerror); if (cErr.length) check("مفيش أخطاء في الصفحة (الكاشير)", false, cErr.map((e) => e.pageerror).join(" | "));
  await ctx.close();

  await browser.close();
  fs.writeFileSync(`${OUT}/results.txt`, results.join("\n"));
  console.log(results.join("\n"));
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
