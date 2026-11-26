// Vouchers: the category decides who the voucher is for (migration 0293, owner 2026-11-26 «(ج) … نفذها»، «إجباري في أقساط
// العملاء ومقبوضات من موردين»، «اخترت أي حاجة من التصنيف تخص الموظفين … Drop down list»). A new user opens «سند قبض جديد» /
// «سند صرف جديد», picks each category and tries to save without a party / with the wrong one. Database faked.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/voucher-party.ui.cjs
const { chromium } = require("playwright");
const OUT = process.env.OUT_DIR || __dirname;
const BASE = "http://127.0.0.1:4173";
const SB = "https://kkfiplnucefytutlwaiz.supabase.co";
const REF = "kkfiplnucefytutlwaiz";
const T = "5316fbfe-b862-4c91-b48b-1d81c8aa5a71";
const OWNER = "85c76e60-3d27-4a99-8cd7-c8f8b39d914a";
const B1 = "1329f6cc-0000-0000-0000-000000000001";
const B2 = "7a9f9e1b-0000-0000-0000-000000000002";
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
    branches: [{ id: B1, name: "معرض سكة تلة", code: "B1", tenant_id: T, is_active: true, is_system: false, platform_paused: false, low_balance_threshold: 0 },
               { id: B2, name: "معرض عبدالمنعم", code: "B2", tenant_id: T, is_active: true, is_system: false, platform_paused: false, low_balance_threshold: 0 }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [
      { id: "e1", name: "مينا عادل", branch_id: B1, is_active: true, tenant_id: T },
      { id: "e2", name: "حسن موظف عبدالمنعم", branch_id: B2, is_active: true, tenant_id: T },
      { id: "e3", name: "سيد مفصول", branch_id: B1, is_active: false, tenant_id: T }],
    role_permissions: [], user_permissions: [], permission_templates: [], vessel_access: [],
    treasury: [
      tr(1, "income", "cash", 1000, "2026-11-20"), tr(2, "expense", "cash", 200, "2026-11-21"),
      tr(3, "income", "vodafone", 500, "2026-11-22", { vessel_account_id: ACC1, transfer_to_account: "01017144488" }),
      tr(4, "income", "vodafone", 300, "2026-11-23", { vessel_account_id: ACC2, transfer_to_account: "01080778055" }),
      tr(5, "income", "paymob", 900, "2026-11-24"), tr(6, "expense", "safe", 200, "2026-11-25"),
    ],
    treasury_transfers: [], vouchers: [], voucher_categories: [
      { id: "c-in", name: "تحصيل أقساط عملاء", type: "receipt", system_key: "installment", gl_account_code: "1200", is_system: true, is_active: true, parent_id: null, tenant_id: T },
      { id: "c-rs", name: "مقبوضات من موردين", type: "receipt", system_key: null, gl_account_code: "2100", is_system: false, is_active: true, parent_id: null, tenant_id: T },
      { id: "c-ar", name: "رد سلف موظفين", type: "receipt", system_key: "advance_repayment", gl_account_code: "1450", is_system: false, is_active: true, parent_id: null, tenant_id: T },
      { id: "c-or", name: "إيرادات أخرى", type: "receipt", system_key: "other_receipt", gl_account_code: "4200", is_system: true, is_active: true, parent_id: null, tenant_id: T },
      { id: "c-sp", name: "مدفوعات موردين", type: "payment", system_key: "supplier_payment", gl_account_code: "2100", is_system: true, is_active: true, parent_id: null, tenant_id: T },
      { id: "c-sal", name: "رواتب موظفين", type: "payment", system_key: "salary", gl_account_code: "5200", is_system: true, is_active: true, parent_id: null, tenant_id: T },
      { id: "c-misc", name: "نثريات", type: "payment", system_key: "other_payment", gl_account_code: "5900", is_system: true, is_active: true, parent_id: null, tenant_id: T }],
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
      if (name === "search_branch_contacts") return json(body.p_kind === "supplier"
        ? [{ id: "s1", name: "ولاد محمود", phone: null, type: "supplier", branch_id: B1, branch_name: "معرض سكة تلة" }]
        : [{ id: "k1", name: "كريم عاطف", phone: null, type: "customer", branch_id: B1, branch_name: "معرض سكة تلة" }]);
      if (name === "create_manual_voucher") return json("v-new");
      if (name === "ledger_contact_side_balances" || name === "contact_side_balances") return json([]);
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

const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const db = makeDb();
  const { page } = await open(browser, db, OWNER);
  const t = (id) => page.getByTestId(id);
  const created = () => db.calls.filter((c) => c.rpc === "create_manual_voucher").map((c) => c.body);
  const toastText = async () => (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).join(" | ");
  async function newVoucher(kind) {
    await page.goto(`${BASE}/branch/${B1}/treasury?tab=${kind === "receipt" ? "receipts" : "payments"}`); await settle(page);
    await page.getByRole("button", { name: kind === "receipt" ? "سند قبض جديد" : "سند صرف جديد" }).first().click();
    await page.getByRole("dialog").waitFor();
    await page.waitForTimeout(400);
  }
  async function pickCategory(name) {
    await page.getByRole("dialog").getByRole("combobox").first().click();
    await page.getByRole("option", { name, exact: true }).click();
    await page.waitForTimeout(300);
  }
  async function amount(v) { await page.getByRole("dialog").locator('input[type="number"]').first().fill(String(v)); }
  async function save() { const n = created().length; await page.getByRole("dialog").getByRole("button", { name: /حفظ|سجّل|تأكيد/ }).last().click(); await page.waitForTimeout(700); return created().length > n; }
  async function partyTypeText() { return (await t("party-type").innerText().catch(() => "")).trim(); }

  // 1) receipt «تحصيل أقساط عملاء»: customer mandatory, type locked
  await newVoucher("receipt");
  await pickCategory("تحصيل أقساط عملاء"); await amount(500);
  check("1. أقساط: نوع الحساب اتقفل على «عميل»", (await partyTypeText()).includes("عميل") && await t("party-type").isDisabled());
  check("1. أقساط: مكتوب «إجباري مع التصنيف ده»", await vis(t("party-required")));
  let sent = await save();
  check("1. أقساط من غير عميل: ما اتبعتش، ورسالة واضحة", !sent && (await toastText()).includes("لازم تختار له العميل"), await toastText());
  await page.getByRole("dialog").getByRole("combobox").filter({ hasText: "اختر..." }).first().click();
  await page.getByText("كريم عاطف").first().click(); await page.waitForTimeout(300);
  sent = await save();
  let b = created().pop() || {};
  check("1. أقساط مع كريم: اتبعت بالعميل", sent && b.p_party_type === "customer" && b.p_party_id === "k1" && b.p_category_id === "c-in", JSON.stringify(b).slice(0, 160));
  await shot(page, "voucher-1-installment");

  // 2) receipt «مقبوضات من موردين»: supplier mandatory and allowed on a receipt
  await newVoucher("receipt");
  await pickCategory("مقبوضات من موردين"); await amount(300);
  check("2. مقبوضات موردين: النوع «مورد» ومقفول", (await partyTypeText()).includes("مورد") && await t("party-type").isDisabled());
  sent = await save();
  check("2. مقبوضات موردين من غير مورد: اترفض", !sent && (await toastText()).includes("لازم تختار له المورد"));
  await page.getByRole("dialog").getByRole("combobox").filter({ hasText: "اختر..." }).first().click();
  await page.getByText("ولاد محمود").first().click(); await page.waitForTimeout(300);
  sent = await save(); b = created().pop() || {};
  check("2. مقبوضات موردين مع ولاد محمود: اتبعت بالمورد", sent && b.p_party_type === "supplier" && b.p_party_id === "s1", JSON.stringify(b).slice(0, 160));

  // 3) receipt «رد سلف موظفين»: active employees dropdown
  await newVoucher("receipt");
  await pickCategory("رد سلف موظفين"); await amount(200);
  check("3. رد سلف: النوع «موظف» ومقفول", (await partyTypeText()).includes("موظف") && await t("party-type").isDisabled());
  sent = await save();
  check("3. رد سلف من غير موظف: اترفض", !sent && (await toastText()).includes("الموظفين الشغالين"));
  await t("party-pick").click(); await page.waitForTimeout(300);
  const opts = await page.locator('[data-testid^="party-opt-"]').allInnerTexts();
  check("3. القايمة فيها الشغالين بس (المفصول مش ظاهر)", opts.some((x) => x.includes("مينا عادل")) && opts.some((x) => x.includes("حسن موظف عبدالمنعم")) && !opts.some((x) => x.includes("سيد مفصول")), opts.join(" / "));
  check("3. موظف الفرع الأول، واللي من فرع تاني جنبه اسم فرعه", opts[0]?.includes("مينا عادل") && opts.some((x) => x.includes("حسن") && x.includes("معرض عبدالمنعم")));
  await shot(page, "voucher-3-employees");
  await t("party-opt-e1").click(); await page.waitForTimeout(200);
  sent = await save(); b = created().pop() || {};
  check("3. رد سلف من مينا: اتبعت بالموظف", sent && b.p_party_type === "employee" && b.p_party_id === "e1");

  // 4) receipt «إيرادات أخرى»: optional, supplier not offered
  await newVoucher("receipt");
  await pickCategory("إيرادات أخرى"); await amount(50);
  check("4. إيرادات أخرى: الجهة اختيارية والنوع مفتوح", !(await vis(t("party-required"))) && !(await t("party-type").isDisabled()));
  await t("party-type").click();
  const types = await page.getByRole("option").allInnerTexts();
  check("4. إيرادات أخرى: «مورد» مش في القايمة", !types.includes("مورد") && types.includes("عميل"), types.join(","));
  await page.keyboard.press("Escape");
  sent = await save();
  check("4. إيرادات أخرى من غير جهة: اتحفظ", sent);

  // 5) payment «مدفوعات موردين» and «رواتب موظفين»
  await newVoucher("payment");
  await pickCategory("مدفوعات موردين"); await amount(100);
  sent = await save();
  check("5. مدفوعات موردين من غير مورد (زي PV-7650): اترفض", !sent && (await toastText()).includes("لازم تختار له المورد"));
  await pickCategory("رواتب موظفين");
  check("5. لما غيرت التصنيف لرواتب: النوع بقى «موظف»", (await partyTypeText()).includes("موظف"));
  sent = await save();
  check("5. رواتب من غير موظف: اترفض", !sent && (await toastText()).includes("الموظفين الشغالين"));
  await t("party-pick").click(); await page.waitForTimeout(200); await t("party-opt-e2").click(); await page.waitForTimeout(200);
  sent = await save(); b = created().pop() || {};
  check("5. رواتب لحسن (فرع تاني): اتبعت", sent && b.p_party_type === "employee" && b.p_party_id === "e2");
  await newVoucher("payment");
  await pickCategory("نثريات"); await amount(20);
  sent = await save();
  check("5. نثريات من غير جهة: اتحفظ", sent);

  check("no page errors", !db.calls.some((c) => c.pageerror), db.calls.filter((c) => c.pageerror).map((c) => c.pageerror).join(" | "));
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
