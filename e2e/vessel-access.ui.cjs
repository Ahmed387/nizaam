// UI test of the Excel filters on the branch till («حركات الخزنة», owner 2026-10-26): arrows over EVERY movement
// (not the 50 of a page), the bar's period / wallet linked to the «التاريخ» / «طريقة الدفع» columns (the wallet's own
// arrow still lists every wallet, as in Excel), the in / out footer of every filtered row, remembered filters; the
// receipt vouchers tab (wallet / category on top = the arrows, cards follow); the main till (opens on the last 30
// days = the «التاريخ» arrow; wallet / branch on top = the arrows); and a page-mode table (فواتير الشراء) whose
// PDF / Excel get only what the arrows leave. Database faked in the browser.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/treasury-excel.ui.cjs
const { chromium } = require("playwright");
const OUT = process.env.OUT_DIR || __dirname;
const BASE = "http://127.0.0.1:4173";
const SB = "https://kkfiplnucefytutlwaiz.supabase.co";
const REF = "kkfiplnucefytutlwaiz";
const T = "5316fbfe-b862-4c91-b48b-1d81c8aa5a71";
const OWNER = "85c76e60-3d27-4a99-8cd7-c8f8b39d914a";
const B1 = "1329f6cc-0000-0000-0000-000000000001";

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.sig`;
const uuid = (p, i) => `${p}-0000-4000-8000-${String(i).padStart(12, "0")}`;

// «الأوعية لكل شخص» (migration 0281, owner 2026-11-25): the owner sets, for one person, each vessel to «يشوف ويستخدم» /
// «يشوف بس مايدفعش» / «مخفي خالص» and each vodafone number alone; that person's till then has no instapay card and his
// receipt voucher offers cash only (vodafone: view only, instapay: hidden). Database faked in the browser.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/vessel-access.ui.cjs
const MGR = "9aa41d69-13ef-41d8-a6ca-b6c722c95c62";
const ACC1 = "4830d903-00ed-4a79-b64a-fec7cc465bb2", ACC2 = "c7925658-c4c8-4244-b69c-1808c2001fdc";
function makeDb(rulesFor) {
  return {
    calls: [],
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true },
               { id: MGR, name: "محمود علاء", username: "ma", tenant_id: T, is_active: true }],
    user_roles: [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T }, { user_id: MGR, role: "branch_manager", tenant_id: T }],
    branch_users: [{ user_id: MGR, branch_id: B1, access_level: "manage", tenant_id: T }],
    branches: [{ id: B1, name: "معرض سكة تلة", code: "B1", tenant_id: T, is_active: true, is_system: false, platform_paused: false, low_balance_threshold: 0 }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [], role_permissions: [], user_permissions: [], permission_templates: [],
    treasury: [], treasury_transfers: [], vouchers: [], voucher_categories: [{ id: "vc1", name: "تحصيل نقدي", type: "receipt", is_system: false, is_active: true, tenant_id: T }],
    transfer_fees: [],
    vessel_accounts: [
      { id: ACC1, payment_method: "vodafone", holder_name: "رقم الفرع", account_number: "01017144488", is_active: true, sort_order: 0, employee_id: null, notes: null, daily_limit: null, monthly_limit: null, tenant_id: T },
      { id: ACC2, payment_method: "vodafone", holder_name: "رقم المالك", account_number: "01080778055", is_active: true, sort_order: 1, employee_id: null, notes: null, daily_limit: null, monthly_limit: null, tenant_id: T }],
    vessel_access: rulesFor ? rulesFor.map((r) => ({ ...r, user_id: MGR, tenant_id: T })) : [],
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
      if (name === "get_branch_wallet_balances") return json([{ cash_balance: 1000, vodafone_balance: 500, instapay_balance: 0, bank_balance: 0, other_balance: 0, total_balance: 1500 }]);
      if (name === "treasury_balance_after") return json((body.p_ids || []).map((id, i) => ({ id, balance_after: 100000 - i })));
      if (name === "treasury_row_links") return json((body.p_ids || []).map((id) => ({ id, account_name: Number(id.slice(-3)) % 2 ? "جارحي" : "اسامة الراعى الصالح", src_type: null })));
      return json(null);
    }
    if (path.startsWith("/rest/v1/")) {
      const table = path.split("/").pop(); const method = req.method();
      if (method !== "GET" && method !== "HEAD") { db.calls.push({ table, method }); return json([]); }
      db.calls.push({ table, get: url.search.slice(0, 160) });
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
const settle = async (page) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1000); };

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  // A) the owner sets محمود علاء
  const db = makeDb(null);
  const { page, ctx } = await open(browser, db, OWNER);
  await page.goto(`${BASE}/admin/settings`); await settle(page);
  await page.getByText("الفلوس والخزائن").first().click({ timeout: 8000 }); await settle(page);
  await page.getByText("طرق الدفع والعمولات").first().click({ timeout: 8000 }); await settle(page);
  check("1. «الأوعية لكل شخص» ظاهر للمالك", await vis(page.getByText("الأوعية لكل شخص")));
  await page.locator("#va-person").selectOption(MGR); await settle(page);
  const card = (m) => page.getByTestId(`vessel-${m}`);
  check("2. كل الأوعية «يشوف ويستخدم» من الأول", (await card("cash").getByRole("radio", { name: "يشوف ويستخدم" }).getAttribute("aria-checked")) === "true");
  await card("instapay").getByRole("radio", { name: "يشوف بس مايدفعش" }).click();
  await card("vodafone").getByRole("radio", { name: "مخفي خالص" }).click();
  await card("vodafone").getByRole("button", { name: /كل رقم لوحده/ }).click();
  const branchNo = card("vodafone").getByRole("radiogroup", { name: /01017144488/ });
  check("3. الأرقام بتظهر و«زي الوعاء (مخفي خالص)» مختار", (await branchNo.getByRole("radio", { name: /زي الوعاء/ }).getAttribute("aria-checked")) === "true"
    && await vis(branchNo.getByText("زي الوعاء (مخفي خالص)")));
  await branchNo.getByRole("radio", { name: "يشوف ويستخدم" }).click();
  await page.screenshot({ path: `${OUT}/vessel-1-settings.png`, fullPage: true });
  await page.getByRole("button", { name: "احفظ" }).last().click(); await page.waitForTimeout(700);
  const sv = db.calls.filter((c) => c.rpc === "set_vessel_access");
  const rows = sv[0]?.body?.p_rows ?? [];
  check("4. set_vessel_access مرة واحدة: إنستاباي يشوف بس، فودافون مخفي، ورقم الفرع يستخدم (اللي زي الوعاء مش بيتبعت)",
    sv.length === 1 && sv[0].body.p_user === MGR && JSON.stringify(rows) === JSON.stringify([
      { method: "instapay", account_id: null, level: "view" }, { method: "vodafone", account_id: null, level: "hidden" },
      { method: "vodafone", account_id: ACC1, level: "use" }]), JSON.stringify(rows));
  await ctx.close();

  // B) محمود علاء himself: instapay hidden, vodafone view only
  const db2 = makeDb([{ method: "instapay", account_id: null, level: "hidden" }, { method: "vodafone", account_id: null, level: "view" }]);
  const s2 = await open(browser, db2, MGR);
  await s2.page.goto(`${BASE}/branch/${B1}/treasury`); await settle(s2.page);
  const txt = await s2.page.locator("main").innerText().catch(() => "");
  check("5. خزنته: مفيش كارت «حركة انستاباي» (مخفي خالص)", !/حركة انستاباي/.test(txt));
  check("6. «حركة فودافون كاش» ظاهر (يشوف بس)", /حركة فودافون كاش/.test(txt));
  await s2.page.screenshot({ path: `${OUT}/vessel-2-till.png`, fullPage: false });
  await s2.page.goto(`${BASE}/branch/${B1}/treasury?tab=receipts`); await settle(s2.page);
  const btn = s2.page.getByRole("button", { name: /سند قبض/ }).first();
  if (await vis(btn)) {
    await btn.click(); await settle(s2.page);
    const dlg = s2.page.getByRole("dialog");
    const dtxt = await dlg.innerText().catch(() => "");
    check("7. سند القبض: نقدي بس في طرق الدفع — من غير فودافون (يشوف بس) ولا إنستاباي (مخفي)", /نقدي/.test(dtxt) && !/فودافون/.test(dtxt) && !/انستاباي|إنستاباي/.test(dtxt), dtxt.slice(0, 200).replace(/\n/g, " "));
    await s2.page.screenshot({ path: `${OUT}/vessel-3-voucher.png`, fullPage: false });
  } else check("7. زرار سند قبض موجود", false);
  const errs = [...db.calls, ...db2.calls].filter((c) => c.pageerror);
  check("8. مفيش أخطاء في الصفحات", errs.length === 0, errs.map((e) => e.pageerror).join(" | ").slice(0, 400));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
