// UI test of the Excel filters on the branch till («حركات الخزنة», owner 2026-10-26): arrows over EVERY movement
// (not the 50 of a page), the bar's period / wallet linked to the «التاريخ» / «طريقة الدفع» columns, the in / out
// footer of every filtered row, remembered filters; and a page-mode table (فواتير الشراء) whose PDF / Excel get only
// what the arrows leave. Database faked in the browser.
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

const METHODS = ["cash", "cash", "instapay", "vodafone", "bank"];
const CATS = ["تحصيل من عميل", "سداد مورد", "مصروفات تشغيل", "إيداع"];
/** 130 till movements of one branch (three pages of 50), Sep–Oct 2026 */
function makeTreasury() {
  return Array.from({ length: 130 }, (_, i) => {
    const day = `2026-${i < 80 ? "10" : "09"}-${String((i % 28) + 1).padStart(2, "0")}`;
    return {
      id: uuid("e0000001", i + 1), tenant_id: T, branch_id: B1, type: i % 3 === 0 ? "expense" : "income",
      category: CATS[i % 4], amount: (i + 1) * 100, payment_method: METHODS[i % 5], description: `حركة ${i + 1}`,
      reference_id: null, reference_number: `TR-${String(i + 1).padStart(4, "0")}`, transaction_date: day,
      created_at: `${day}T10:00:00+00:00`, is_fee: false,
    };
  });
}
/** 75 purchase invoices for the page-mode table */
function makeShipments() {
  const sup = ["شركة النور", "مؤسسة الأمل", "الحاج سيد"];
  return Array.from({ length: 75 }, (_, i) => ({
    id: uuid("f0000001", i + 1), tenant_id: T, branch_id: B1, shipment_number: `SH-${String(i + 1).padStart(4, "0")}`,
    contact_id: uuid("c0000002", (i % 3) + 1), contacts: { name: sup[i % 3] }, total_cost: (i + 1) * 1000, status: "active",
    invoice_date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T08:00:00+00:00`, created_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T08:00:00+00:00`,
    arrival_date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, received_by: null, notes: null, shipment_items: [],
  }));
}

function makeDb() {
  return {
    calls: [],
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true }],
    user_roles: [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T }],
    branch_users: [],
    branches: [{ id: B1, name: "معرض سكة تلة", code: "B1", tenant_id: T, is_active: true, is_system: false, platform_paused: false, low_balance_threshold: 0 }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [], role_permissions: [], user_permissions: [], permission_templates: [],
    treasury: makeTreasury(), treasury_transfers: [], vouchers: [], invoices: [],
    shipments: makeShipments(),
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
      db.calls.push({ rpc: name, n: Array.isArray(body.p_ids) ? body.p_ids.length : undefined });
      if (name === "get_branch_wallet_balances") return json([{ cash_balance: 1000, vodafone_balance: 0, instapay_balance: 0, bank_balance: 0, other_balance: 0, total_balance: 1000 }]);
      if (name === "treasury_balance_after") return json((body.p_ids || []).map((id, i) => ({ id, balance_after: 100000 - i })));
      if (name === "treasury_row_links") return json((body.p_ids || []).map((id) => ({ id, account_name: Number(id.slice(-3)) % 2 ? "جارحي" : "اسامة الراعى الصالح", src_type: null })));
      return json(null);
    }
    if (path.startsWith("/rest/v1/")) {
      const table = path.split("/").pop(); const method = req.method();
      if (method !== "GET" && method !== "HEAD") { db.calls.push({ table, method }); return json([]); }
      db.calls.push({ table, get: url.search.slice(0, 160) });
      let rows = filt(db[table] ?? [], url);
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
let DB = null;
const check = (name, ok, extra = "") => { results.push(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); if (DB) DB.step = name; };
const vis = (loc) => loc.first().isVisible().catch(() => false);
const settle = async (page) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(900); };
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
const fmt = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

(async () => {
  const browser = await chromium.launch();
  const db = makeDb();
  DB = db;
  const { ctx, page } = await open(browser, db, OWNER);
  await page.goto(`${BASE}/branch/${B1}/treasury`); await settle(page);
  const table = page.locator("table").filter({ has: page.getByRole("columnheader", { name: /اسم الحساب/ }) }).first();
  const rowsOf = () => table.locator(":scope > tbody > tr:not([hidden])");
  const arrow = (label) => page.getByRole("button", { name: new RegExp(`^فلتر وترتيب عمود ${label}`) });
  const dialog = page.getByRole("dialog");
  check("الصفحة الأولى 50 من 130 حركة", (await rowsOf().count()) === 50 && await vis(page.getByText(/من أصل 130 حركة/)), String(await rowsOf().count()));

  // ---- «التصنيف»: the values of every page, with their counts
  await arrow("التصنيف").click();
  await dialog.getByText("سداد مورد").waitFor({ timeout: 10000 });
  const t = await dialog.locator("label", { hasText: "سداد مورد" }).innerText();
  const supplierPays = db.treasury.filter((r) => r.category === "سداد مورد");
  check(`قيم التصنيف من كل الحركات (سداد مورد ${supplierPays.length})`, t.includes(`(${supplierPays.length})`), t);
  await dialog.getByText("تحديد الكل").click();
  await dialog.locator("label", { hasText: "سداد مورد" }).click();
  await dialog.getByRole("button", { name: "تطبيق" }).click(); await settle(page);
  check(`فلتر التصنيف على كل الحركات: ${supplierPays.length}`, await vis(page.getByText(new RegExp(`من أصل ${supplierPays.length} حركة`))));
  const inSum = supplierPays.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0);
  const footer = await table.locator("tfoot").first().innerText();
  check("«داخل في كل الصفحات» = مجموع كل اللي فاضل", footer.includes("كل الصفحات") && footer.replace(/[^\d,]/g, " ").includes(fmt(inSum)), footer.replace(/\s+/g, " ").slice(0, 160));

  // ---- the bar's wallet IS the «طريقة الدفع» column: انستاباي on top lights the arrow
  const methodField = page.getByText("الوعاء / طريقة الدفع", { exact: true }).first().locator("xpath=..").getByRole("combobox");
  await methodField.click(); await page.getByRole("option", { name: "انستاباي" }).click(); await settle(page);
  const both = supplierPays.filter((r) => r.payment_method === "instapay");
  const lab = await arrow("طريقة الدفع").first().getAttribute("aria-label");
  check(`انستاباي من فوق: سهم «طريقة الدفع» منوّر، سداد مورد AND انستاباي = ${both.length}`, (lab || "").includes("عليه فلتر") && await vis(page.getByText(new RegExp(`من أصل ${both.length} حركة`))), lab || "");
  check("الشريحة: «طريقة الدفع: انستاباي»", await vis(page.getByText(/طريقة الدفع: انستاباي/)));

  // ---- the bar's period IS the «التاريخ» column
  await page.getByText("من تاريخ", { exact: true }).first().locator("xpath=..").locator("input").fill("2026-10-01"); await settle(page);
  check("«من تاريخ» من فوق = شريحة على عمود التاريخ", await vis(page.getByText(/التاريخ: من 1 أكتوبر 2026/)));
  await shot(page, "treasury-excel");

  // ---- remembered
  await page.reload(); await settle(page);
  const both10 = both.filter((r) => r.transaction_date >= "2026-10-01");
  check(`بعد إعادة الفتح الفلاتر زي ما سبتها (${both10.length})`, await vis(page.getByText(/التصنيف: سداد مورد/)) && await vis(page.getByText(new RegExp(`من أصل ${both10.length} حركة`))));
  await page.getByRole("button", { name: "مسح الفلاتر" }).first().click(); await settle(page);
  await shot(page, "treasury-after-clear");
  check("مسح الفلاتر: رجعت 130", await vis(page.getByText(/من أصل 130 حركة/)), (await page.getByText(/من أصل \d+ حركة/).first().innerText().catch(() => "?")));

  // ---- page-mode table: purchases PDF / Excel get only what the arrows leave (onView)
  await page.goto(`${BASE}/branch/${B1}/shipments`); await settle(page);
  const st = page.locator("table").filter({ has: page.getByRole("columnheader", { name: /المورد|اسم المورد/ }) }).first();
  const sRows = () => st.locator(":scope > tbody > tr:not([hidden])");
  const before = await sRows().count();
  const supArrow = page.getByRole("button", { name: /^فلتر وترتيب عمود (المورد|اسم المورد)/ }).first();
  if (await vis(supArrow)) {
    await supArrow.click();
    await dialog.getByText("تحديد الكل").waitFor();
    await dialog.getByText("تحديد الكل").click();
    await dialog.locator("label", { hasText: "شركة النور" }).click();
    await dialog.getByRole("button", { name: "تطبيق" }).click(); await settle(page);
    const after = await sRows().count();
    check(`فواتير الشراء (فلتر في الصفحة): ${before} ← ${after} لمورد واحد`, after === 25, `${before} → ${after}`);
  } else check("فواتير الشراء: سهم المورد", false, "مش ظاهر");

  const errs = db.calls.filter((c) => c.pageerror);
  check("مفيش أخطاء في الصفحة", !errs.length, errs.map((x) => x.pageerror).join(" | "));
  await ctx.close(); await browser.close();
  console.log(results.join("\n"));
})();
