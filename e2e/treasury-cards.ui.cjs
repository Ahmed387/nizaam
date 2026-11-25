// 0287 (owner 2026-11-26): the branch till's cards open their movements. Balance = every row from the first day;
// income / expense = that type; net = the period; one card per vessel by its own name (PayMob / الخزينة, no more
// «وسائل أخرى») with a hint on the whole card; «حسابات الأوعية» closed per vessel until opened (an arrow), a number row
// opens its movements; a banner «بتعرض: …» with «اعرض الكل»; the search box finds a wallet number. Database faked.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/treasury-cards.ui.cjs
const { chromium } = require("playwright");
const OUT = process.env.OUT_DIR || __dirname;
const BASE = "http://127.0.0.1:4173";
const SB = "https://kkfiplnucefytutlwaiz.supabase.co";
const REF = "kkfiplnucefytutlwaiz";
const T = "5316fbfe-b862-4c91-b48b-1d81c8aa5a71";
const OWNER = "85c76e60-3d27-4a99-8cd7-c8f8b39d914a";
const B1 = "1329f6cc-0000-0000-0000-000000000001";
const ACC1 = "4830d903-00ed-4a79-b64a-fec7cc465bb2", ACC2 = "c7925658-c4c8-4244-b69c-1808c2001fdc";
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.sig`;
const uuid = (i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`;
const tr = (i, type, method, amount, date, extra = {}) => ({ id: uuid(i), branch_id: B1, tenant_id: T, type, category: type === "income" ? "sale" : "expense",
  amount, description: `حركة ${i}`, payment_method: method, transaction_date: date, created_at: `${date}T10:00:00Z`, reference_number: `R${i}`,
  vessel_account_id: null, transfer_to_account: null, transfer_from_account: null, is_fee: false, reference_id: null, created_by: OWNER, ...extra });
function makeDb() {
  return {
    calls: [],
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true }],
    user_roles: [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T }],
    branch_users: [],
    branches: [{ id: B1, name: "معرض سكة تلة", code: "B1", tenant_id: T, is_active: true, is_system: false, platform_paused: false, low_balance_threshold: 0 }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [], role_permissions: [], user_permissions: [], permission_templates: [], vessel_access: [],
    treasury: [
      tr(1, "income", "cash", 1000, "2026-11-20"), tr(2, "expense", "cash", 200, "2026-11-21"),
      tr(3, "income", "vodafone", 500, "2026-11-22", { vessel_account_id: ACC1, transfer_to_account: "01017144488" }),
      tr(4, "income", "vodafone", 300, "2026-11-23", { vessel_account_id: ACC2, transfer_to_account: "01080778055" }),
      tr(5, "income", "paymob", 900, "2026-11-24"), tr(6, "expense", "safe", 200, "2026-11-25"),
    ],
    treasury_transfers: [], vouchers: [], voucher_categories: [],
    transfer_fees: [
      { payment_method: "paymob", label: "PayMob", kind: "wallet", is_enabled: true, show_in_payments: false, fee_type: "fixed", fee_value: 0 },
      { payment_method: "safe", label: "الخزينة", kind: "wallet", is_enabled: true, show_in_payments: false, fee_type: "fixed", fee_value: 0 },
      { payment_method: "company_offers", label: "خصومات / عروض الشركات", kind: "virtual", is_enabled: true, show_in_payments: false, fee_type: "fixed", fee_value: 0 },
    ],
    vessel_accounts: [
      { id: ACC1, payment_method: "vodafone", holder_name: "رقم الفرع", account_number: "01017144488", is_active: true, sort_order: 0, employee_id: null, notes: null, daily_limit: null, monthly_limit: null, tenant_id: T },
      { id: ACC2, payment_method: "vodafone", holder_name: "رقم المالك", account_number: "01080778055", is_active: true, sort_order: 1, employee_id: null, notes: null, daily_limit: null, monthly_limit: null, tenant_id: T }],
    vab: [
      { payment_method: "vodafone", vessel_account_id: ACC1, holder_name: "رقم الفرع", account_number: "01017144488", is_active: true, balance: 500, movements: 1 },
      { payment_method: "vodafone", vessel_account_id: ACC2, holder_name: "رقم المالك", account_number: "01080778055", is_active: true, balance: 300, movements: 1 },
    ],
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar-EG", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => db.calls.push({ pageerror: `${String(e).slice(0, 200)} @ ${db.step ?? ""} ${String(e.stack ?? "").split("\n").slice(0, 6).join(" | ").slice(0, 600)}` }));
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
      if (name === "set_vessel_access") return json(3);
      if (name === "get_branch_wallet_balances") return json([{ cash_balance: 1000, vodafone_balance: 500, instapay_balance: 0, bank_balance: 0, other_balance: 700, total_balance: 2200 }]);
      if (name === "vessel_account_balances") return json(db.vab);
      if (name === "vessel_account_usage" || name === "vessel_accounts_usage") return json([]);
      if (name === "treasury_balance_after") return json((body.p_ids || []).map((id, i) => ({ id, balance_after: 100000 - i })));
      if (name === "treasury_row_links") return json((body.p_ids || []).map((id) => ({ id, account_name: Number(id.slice(-3)) % 2 ? "جارحي" : "اسامة الراعى الصالح", src_type: null })));
      return json(null);
    }
    if (path.startsWith("/rest/v1/")) {
      const table = path.split("/").pop(); const method = req.method();
      if (method !== "GET" && method !== "HEAD") { db.calls.push({ table, method }); return json([]); }
      db.calls.push({ table, get: decodeURIComponent(url.search) });
      let rows = filt(db[table] ?? [], url);
      if (table === "branch_users" && (url.searchParams.get("select") || "").includes("branches(")) rows = rows.map((r) => ({ ...r, branches: db.branches.find((b) => b.id === r.branch_id) }));
      if (table === "treasury") rows = [...rows].sort((a, b) => (a.transaction_date < b.transaction_date ? 1 : a.transaction_date > b.transaction_date ? -1 : a.id < b.id ? 1 : -1));
      if (table === "shipments") rows = [...rows].sort((a, b) => (a.invoice_date < b.invoice_date ? 1 : a.invoice_date > b.invoice_date ? -1 : a.id < b.id ? -1 : 1));
      const total = rows.length;
      const off = Number(url.searchParams.get("offset") ?? 0), lim = url.searchParams.get("limit");
      if (lim !== null) rows = rows.slice(off, off + Number(lim));
      const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
      if (single) return rows.length ? json(rows[0]) : route.fulfill({ status: 406, contentType: "application/json", body: JSON.stringify({ code: "PGRST116", message: "0 rows" }) });
      const end = rows.length ? off + rows.length - 1 : 0;
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": `${off}-${end}/${total}`, "access-control-allow-origin": "*", "access-control-expose-headers": "Content-Range" }, body: method === "HEAD" ? "" : JSON.stringify(rows) });
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
/** the last read of the movements table (the paginated one: select=* with a count) */
const lastTableGet = (db) => [...db.calls].reverse().find((c) => c.table === "treasury" && c.get && /select=\*/.test(c.get))?.get ?? "";
const tableGets = (db, from) => db.calls.slice(from).filter((c) => c.table === "treasury" && c.get).map((c) => c.get);
const tableText = (page) => page.locator("table").first().innerText().catch(() => "");
const banner = (page) => page.getByTestId("treasury-detail-banner");

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const db = makeDb();
  const { page, ctx } = await open(browser, db, OWNER);
  await page.goto(`${BASE}/branch/${B1}/treasury`); await settle(page);
  const main = await page.locator("main").innerText().catch(() => "");
  check("1. مفيش كارت «وسائل أخرى»", !/وسائل أخرى/.test(main));
  check("2. كارت لكل وعاء باسمه: PayMob و الخزينة", await vis(page.getByTestId("card-channel-paymob")) && await vis(page.getByTestId("card-channel-safe")));
  const pmTitle = await page.getByTestId("card-channel-paymob").getAttribute("title");
  check("3. الكارت كله عليه شرح لما تقف عليه", /«PayMob» وعاء اتعمل من الإعدادات/.test(pmTitle ?? "") && /اضغط تشوف حركاته/.test(pmTitle ?? ""), pmTitle);
  check("4. «طريقة الدفع» في الجدول بتقول PayMob و الخزينة مش «كاش»", /PayMob/.test(await tableText(page)) && /الخزينة/.test(await tableText(page)));
  await page.screenshot({ path: `${OUT}/cards-1-till.png`, fullPage: true });

  // vessel accounts: closed by default, an arrow opens one
  const rowAcc1 = page.getByTestId(`vessel-row-${ACC1}`);
  check("5. حسابات الأوعية مقفولة من الأول", await vis(page.getByTestId("vessel-toggle-vodafone")) && !(await vis(rowAcc1)));
  await page.getByTestId("vessel-toggle-vodafone").click(); await page.waitForTimeout(300);
  check("6. السهم بيفتح الوعاء ويبان الأرقام", await vis(rowAcc1) && (await page.getByTestId("vessel-toggle-vodafone").getAttribute("aria-expanded")) === "true");

  // cards
  let n = db.calls.length;
  await page.getByTestId("card-income").click(); await settle(page);
  check("7. كارت الدخل → حركات الدخل بس + بانر", tableGets(db, n).some((g) => /type=eq\.income/.test(g)) && /اللي دخل الخزنة بس/.test(await banner(page).innerText().catch(() => "")));
  check("8. الجدول مبيعرضش خرج", !/حركة 2\b/.test(await tableText(page)) && /حركة 5/.test(await tableText(page)));
  n = db.calls.length;
  await page.getByTestId("card-expense").click(); await settle(page);
  check("9. كارت الخرج → حركات الخرج بس", tableGets(db, n).some((g) => /type=eq\.expense/.test(g)) && /حركة 6/.test(await tableText(page)) && !/حركة 5/.test(await tableText(page)));
  n = db.calls.length;
  await page.getByTestId("card-net").click(); await settle(page);
  check("10. كارت الصافي → كل الحركات من غير فلتر نوع", !/type=eq/.test(lastTableGet(db)) && /كل حركات الفترة/.test(await banner(page).innerText().catch(() => "")));
  n = db.calls.length;
  await page.getByTestId("card-channel-paymob").click(); await settle(page);
  const t11 = await tableText(page);
  check("11. كارت PayMob → حركات PayMob بس", /payment_method=eq\.paymob/.test(lastTableGet(db)) && /حركة 5/.test(t11) && !/حركة 1\b/.test(t11)
    && /حركات «PayMob»/.test(await banner(page).innerText().catch(() => "")));
  check("12. الصفحة نزلت على جدول الحركات", await page.evaluate(() => { const r = document.getElementById("treasury-movements")?.getBoundingClientRect(); return !!r && r.top < 400 && r.top > -200; }));
  await page.screenshot({ path: `${OUT}/cards-2-paymob.png`, fullPage: false });
  await page.getByTestId("card-channel-safe").click(); await settle(page);
  check("13. كارت الخزينة → حركات الخزينة بس", /payment_method=eq\.safe/.test(lastTableGet(db)) && /حركة 6/.test(await tableText(page)));
  await page.getByTestId("card-channel-cash").click(); await settle(page);
  check("14. كارت الكاش → حركات الكاش بس", /payment_method=eq\.cash/.test(lastTableGet(db)) && /حركة 1\b/.test(await tableText(page)) && !/حركة 5/.test(await tableText(page)));
  await page.getByTestId("card-channel-vodafone").click(); await settle(page);
  check("15. كارت فودافون → حركات فودافون بس", /payment_method=eq\.vodafone/.test(lastTableGet(db)) && /حركة 3/.test(await tableText(page)));
  await page.getByTestId("card-balance").click(); await settle(page);
  const g16 = lastTableGet(db);
  check("16. كارت الرصيد → كل حركات الخزنة من أول يوم (من غير فترة ولا وعاء)", !/transaction_date=gte/.test(g16) && !/payment_method=eq/.test(g16) && !/type=eq/.test(g16)
    && /من أول يوم/.test(await banner(page).innerText().catch(() => "")));
  check("17. الوعاء اللي اتفتح لسه مفتوح بعد الضغطات", await vis(rowAcc1));

  // a number row
  await rowAcc1.click(); await settle(page);
  const g18 = lastTableGet(db);
  check("18. رقم الفرع → حركاته بس", g18.includes(`vessel_account_id=eq.${ACC1}`) && /payment_method=eq\.vodafone/.test(g18) && /حركة 3/.test(await tableText(page)) && !/حركة 4/.test(await tableText(page)),
    g18.slice(0, 200));
  check("19. البانر بيقول اسم الرقم", /رقم الفرع 01017144488/.test(await banner(page).innerText().catch(() => "")));
  await page.screenshot({ path: `${OUT}/cards-3-account.png`, fullPage: false });

  // «اعرض الكل»
  await banner(page).getByRole("button", { name: "اعرض الكل" }).click(); await settle(page);
  const g20 = lastTableGet(db);
  check("20. «اعرض الكل» بيشيل البانر والفلاتر", !(await vis(banner(page))) && !/vessel_account_id/.test(g20) && !/payment_method=eq/.test(g20) && /حركة 6/.test(await tableText(page)));

  // search box on the details
  await page.getByTestId("card-channel-vodafone").click(); await settle(page);
  const search = page.getByPlaceholder(/رقم المحفظة/).first();
  check("21. بوكس السيرش ظاهر في التفاصيل", await vis(search));
  await search.fill("01080778055");
  const applyBtn = page.getByRole("button", { name: /^(طبّق|تطبيق|ابحث|بحث)$/ }).first();
  if (await vis(applyBtn)) await applyBtn.click(); else await search.press("Enter");
  await settle(page);
  const g22 = lastTableGet(db);
  check("22. السيرش برقم المحفظة بيدور في الرقم المحوّل عليه/منه", /transfer_to_account\.ilike\.%01080778055%/.test(g22) && /transfer_from_account/.test(g22), g22.slice(0, 300));

  // from another tab
  await page.goto(`${BASE}/branch/${B1}/treasury?tab=receipts`); await settle(page);
  check("23. بعد الريلود: الأوعية مقفولة تاني", !(await vis(page.getByTestId(`vessel-row-${ACC1}`))));
  await page.getByTestId("card-channel-paymob").click(); await settle(page); await page.waitForTimeout(600);
  check("24. من تبويب سندات القبض: الكارت بيرجعك على حركات الخزنة ومفلترة", /tab=movements/.test(page.url()) && /حركات «PayMob»/.test(await banner(page).innerText().catch(() => ""))
    && /payment_method=eq\.paymob/.test(lastTableGet(db)), page.url());
  await page.getByTestId("vessel-toggle-vodafone").click(); await page.waitForTimeout(200);
  await page.getByTestId("vessel-toggle-vodafone").click(); await page.waitForTimeout(200);
  check("25. السهم بيقفل الوعاء تاني", !(await vis(page.getByTestId(`vessel-row-${ACC1}`))));
  // the (i) of a card opens its explanation, not the details
  const before = page.url();
  await page.getByTestId("card-channel-safe").getByRole("button", { name: /شرح/ }).first().hover(); await page.waitForTimeout(400);
  check("26. علامة الشرح جوا الكارت بتفتح الشرح", await vis(page.getByText(/«الخزينة» وعاء اتعمل من الإعدادات/)));
  const errs = db.calls.filter((c) => c.pageerror);
  check("27. مفيش أخطاء في الصفحة", errs.length === 0, errs.map((e) => e.pageerror).join(" | ").slice(0, 400));
  console.log(results.join("\n"));
  await ctx.close(); await browser.close();
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
