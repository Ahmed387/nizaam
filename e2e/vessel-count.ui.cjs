// «تسوية الوعاء» (migration 0294, owner 2026-11-26 «نفذ اقتراحك في تسوية الوعاء … جرب الكلام ده كله»): a new owner counts
// each vessel, sees the shortage / surplus, must choose how it is booked (shortage: loss / employee / prior years; surplus:
// profit / prior years), approves / rejects / cancels counts in «تسويات الأوعية», a counter in approval mode only sends it,
// the owner picks the mode in settings, and a salary voucher for a month the payroll paid warns. Database faked.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/vessel-count.ui.cjs
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
    salaries: [{ id: "sal1", employee_id: "e1", month: "2026-11", status: "active", net_salary: 5000 }],
    board: null,
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
      if (name === "vessel_count_board") return json(db.board);
      if (name === "submit_vessel_count") return json(db.submitAnswer ?? { id: "n1", number: "VC00009", status: "applied", difference: -100, voucher: "PV-9001" });
      if (name === "decide_vessel_count") return json({ number: "VC00007", status: body.p_approve ? "applied" : "rejected" });
      if (name === "cancel_vessel_count") return json({ status: "cancelled" });
      if (name === "set_vessel_count_mode") return json(body.p_mode);
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
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
const VESSELS = [{ method: "cash", label: "الكاش (الدرج)", balance: 800 }, { method: "vodafone", label: "فودافون كاش", balance: 500 }, { method: "paymob", label: "PayMob", balance: 900 }];
const COUNTS = [
  { id: "p1", number: "VC00007", method: "cash", label: "الكاش (الدرج)", date: "2026-11-27", system: 800, actual: 750, difference: -50, status: "pending", treatment: null,
    employee: null, note: "عديت الدرج", reason: null, cancel_reason: null, counted_by: "محمود علاء", counted_at: "2026-11-27T09:00:00Z", decided_by: null, voucher: null },
  { id: "a1", number: "VC00006", method: "vodafone", label: "فودافون كاش", date: "2026-11-26", system: 500, actual: 800, difference: 300, status: "applied", treatment: "prior_years",
    employee: null, note: null, reason: "رصيد قديم", cancel_reason: null, counted_by: "احمد ناصر", counted_at: "2026-11-26T09:00:00Z", decided_by: "احمد ناصر", voucher: "RV-8001" },
  { id: "r1", number: "VC00005", method: "paymob", label: "PayMob", date: "2026-11-25", system: 900, actual: 1, difference: -899, status: "rejected", treatment: null,
    employee: null, note: null, reason: "العد غلط", cancel_reason: null, counted_by: "محمود علاء", counted_at: "2026-11-25T09:00:00Z", decided_by: "احمد ناصر", voucher: null },
];
(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const db = makeDb();
  db.board = { mode: "owner", is_owner: true, can_count: true, vessels: VESSELS, counts: [] };
  const { page } = await open(browser, db, OWNER);
  const t = (id) => page.getByTestId(id);
  const rpcs = (n) => db.calls.filter((c) => c.rpc === n).map((c) => c.body);
  const toastText = async () => (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).join(" | ");
  const dlg = () => page.getByRole("dialog");
  async function openCount() {
    await page.goto(`${BASE}/branch/${B1}/treasury`); await settle(page);
    await t("vessel-count-open").click(); await dlg().waitFor(); await page.waitForTimeout(300);
  }
  async function pick(label) { await t("vc-method").click(); await page.getByRole("option").filter({ hasText: label }).first().click(); await page.waitForTimeout(200); }
  const send = async () => { const n = rpcs("submit_vessel_count").length; await t("vc-submit").click({ timeout: 3000 }); await page.waitForTimeout(700); return rpcs("submit_vessel_count").length > n; };

  // 1) owner, shortage on cash
  await openCount();
  check("1. الزرار «تسوية الوعاء» ظاهر للمالك", true);
  let sent = await send();
  check("1. من غير وعاء: ما اتبعتش", !sent && (await toastText()).includes("اختار الوعاء"), await toastText());
  await pick("الكاش");
  check("1. رصيد السيستم ظاهر 800", (await t("vc-system").innerText()).includes("800"));
  await t("vc-actual").fill("700");
  check("1. الفرق «عجز 100»", (await t("vc-diff").innerText()).includes("عجز") && (await t("vc-diff").innerText()).includes("100"));
  check("1. العجز: 3 اختيارات (خسارة / موظف / السنين اللي فاتت)", await vis(t("treat-loss")) && await vis(t("treat-employee")) && await vis(t("treat-prior_years")) && !(await vis(t("treat-gain"))));
  sent = await send();
  check("1. من غير اختيار: اترفض", !sent && (await toastText()).includes("العجز هيتسجل إزاي"), await toastText());
  await t("treat-employee").click();
  sent = await send();
  check("1. «على موظف» من غير موظف: اترفض", !sent && (await toastText()).includes("اختار الموظف"));
  await t("vc-employee").click(); await page.waitForTimeout(300);
  const emps = await page.getByRole("option").allInnerTexts();
  check("1. ليستة الموظفين = الشغالين بس، وموظف الفرع التاني باسم فرعه", emps.some((x) => x.includes("مينا عادل")) && emps.some((x) => x.includes("حسن") && x.includes("عبدالمنعم")) && !emps.some((x) => x.includes("سيد مفصول")), emps.join(" / "));
  await page.getByRole("option").filter({ hasText: "مينا عادل" }).first().click(); await page.waitForTimeout(200);
  sent = await send();
  check("1. من غير سبب: اترفض", !sent && (await toastText()).includes("سبب الفرق"));
  await t("vc-reason").fill("فلوس ناقصة من الكاشير");
  await shot(page, "vessel-count-1-shortage");
  sent = await send();
  let b = rpcs("submit_vessel_count").pop() || {};
  check("1. اتبعت: كاش 700، على مينا، بالسبب", sent && b.p_method === "cash" && b.p_actual === 700 && b.p_treatment === "employee" && b.p_employee === "e1" && b.p_reason === "فلوس ناقصة من الكاشير" && b.p_date === null, JSON.stringify(b));
  check("1. رسالة النجاح فيها رقم التسوية والسند", (await toastText()).includes("VC00009") && (await toastText()).includes("PV-9001"));

  // 2) surplus: two choices, never on an employee
  await openCount(); await pick("فودافون"); await t("vc-actual").fill("650");
  check("2. الزيادة: «زيادة 150» واختيارين بس (ربح / السنين اللي فاتت)", (await t("vc-diff").innerText()).includes("زيادة") && await vis(t("treat-gain")) && await vis(t("treat-prior_years")) && !(await vis(t("treat-employee"))) && !(await vis(t("treat-loss"))));
  await t("treat-prior_years").click(); await t("vc-reason").fill("رصيد قديم");
  sent = await send(); b = rpcs("submit_vessel_count").pop() || {};
  check("2. اتبعت على السنين اللي فاتت", sent && b.p_treatment === "prior_years" && b.p_actual === 650 && b.p_employee === null);

  // 3) equal count, zero is a real amount, negative refused
  await openCount(); await pick("الكاش"); await t("vc-actual").fill("-5");
  sent = await send();
  check("3. رقم بالسالب: اترفض", !sent && (await toastText()).includes("صفر أو أكتر"));
  await t("vc-actual").fill("800");
  check("3. مطابق: «مفيش فرق» ومفيش اختيارات", (await t("vc-diff").innerText()).includes("مطابق") && !(await vis(t("treat-loss"))));
  db.submitAnswer = { id: "n2", number: "VC00010", status: "applied", difference: 0 };
  sent = await send(); b = rpcs("submit_vessel_count").pop() || {};
  check("3. مطابق اتبعت من غير معالجة", sent && b.p_treatment === null && b.p_actual === 800);
  check("3. الرسالة «الوعاء مطابق»", (await toastText()).includes("مطابق"));
  db.submitAnswer = null;

  // 4) the counts tab: pending → approve / reject, applied → cancel
  db.board = { ...db.board, counts: COUNTS };
  await page.goto(`${BASE}/branch/${B1}/treasury?tab=vessel_counts`); await settle(page);
  const tab = await page.locator("body").innerText();
  check("4. التبويب «تسويات الأوعية» فيه 1 مستنية", tab.includes("تسويات الأوعية") && tab.includes("(1 مستنية)"));
  check("4. الجدول فيه التلاتة بحالاتهم", tab.includes("VC00007") && tab.includes("مستنية موافقة المالك") && tab.includes("اتسوّت") && tab.includes("مرفوضة — العد غلط"));
  check("4. المعالجة ظاهرة (على السنين اللي فاتت + رقم السند)", tab.includes("على السنين اللي فاتت") && tab.includes("RV-8001"));
  await shot(page, "vessel-count-4-tab");
  await t("vc-decide-VC00007").click(); await dlg().waitFor();
  const dtext = await dlg().innerText();
  check("4. نافذة الموافقة: مين عدّها وملاحظته والفرق", dtext.includes("محمود علاء") && dtext.includes("عديت الدرج") && dtext.includes("عجز"));
  await t("vc-approve").click(); await page.waitForTimeout(500);
  check("4. موافقة من غير اختيار: اترفضت", rpcs("decide_vessel_count").length === 0 && (await toastText()).includes("العجز هيتسجل إزاي"));
  await t("treat-loss").click(); await t("vc-reason").fill("ضاعت");
  await t("vc-approve").click(); await page.waitForTimeout(700);
  b = rpcs("decide_vessel_count").pop() || {};
  check("4. وافق كخسارة", b.p_id === "p1" && b.p_approve === true && b.p_treatment === "loss" && b.p_reason === "ضاعت", JSON.stringify(b));
  await t("vc-decide-VC00007").click(); await dlg().waitFor();
  await t("vc-reject").click(); await page.waitForTimeout(400);
  check("4. رفض من غير سبب: اترفض", rpcs("decide_vessel_count").length === 1 && (await toastText()).includes("سبب الرفض"));
  await t("vc-reason").fill("العد غلط"); await t("vc-reject").click(); await page.waitForTimeout(700);
  b = rpcs("decide_vessel_count").pop() || {};
  check("4. اترفضت بالسبب", b.p_approve === false && b.p_reason === "العد غلط" && !b.p_treatment);
  check("4. المرفوضة مالهاش «إلغاء» والمتسوّية ليها", !(await vis(t("vc-cancel-VC00005"))) && await vis(t("vc-cancel-VC00006")));
  await t("vc-cancel-VC00006").click(); await dlg().waitFor();
  check("4. نافذة الإلغاء بتقول الوعاء هيرجع يقل 300 في يومه", (await dlg().innerText()).includes("يقل") && (await dlg().innerText()).includes("300"));
  await t("vc-cancel-go").click(); await page.waitForTimeout(400);
  check("4. إلغاء من غير سبب: اترفض", rpcs("cancel_vessel_count").length === 0);
  await t("vc-cancel-reason").fill("غلط"); await t("vc-cancel-go").click(); await page.waitForTimeout(700);
  b = rpcs("cancel_vessel_count").pop() || {};
  check("4. اتلغت", b.p_id === "a1" && b.p_reason === "غلط");

  // 5) a counter in approval mode only sends; no right → no button
  db.board = { mode: "approval", is_owner: false, can_count: true, vessels: VESSELS, counts: COUNTS };
  await openCount(); await pick("الكاش"); await t("vc-actual").fill("750");
  check("5. الموظف: مفيش اختيارات للمعالجة، والزرار «ابعت للمالك»", !(await vis(t("treat-loss"))) && (await t("vc-submit").innerText()).includes("ابعت للمالك"));
  check("5. الوعاء اللي فيه تسوية مستنية: الزرار مقفول ومكتوب السبب", await t("vc-submit").isDisabled() && (await dlg().innerText()).includes("مستنية موافقة المالك"));
  await pick("فودافون"); await t("vc-actual").fill("480");
  db.submitAnswer = { id: "n3", number: "VC00011", status: "pending", difference: -20 };
  sent = await send(); b = rpcs("submit_vessel_count").pop() || {};
  check("5. اتبعت للمالك من غير معالجة", sent && b.p_treatment === null && b.p_employee === null && b.p_date === null);
  check("5. الرسالة: اتبعتت للمالك والوعاء مش هيتغير", (await toastText()).includes("اتبعتت للمالك"));
  const tab5 = await (async () => { await page.goto(`${BASE}/branch/${B1}/treasury?tab=vessel_counts`); await settle(page); return page.locator("body").innerText(); })();
  check("5. الموظف مالوش «وافق / ارفض» ولا «إلغاء»", !(await vis(t("vc-decide-VC00007"))) && !(await vis(t("vc-cancel-VC00006"))) && tab5.includes("الموظف يعدّ والمالك يوافق"));
  db.board = { mode: "owner", is_owner: false, can_count: false, vessels: VESSELS, counts: COUNTS };
  await page.goto(`${BASE}/branch/${B1}/treasury`); await settle(page);
  check("5. من غير صلاحية / الوضع «المالك بس»: مفيش زرار", !(await vis(t("vessel-count-open"))));

  // 6) settings: owner picks the mode
  await page.goto(`${BASE}/admin/settings?tab=payments`); await settle(page);
  check("6. كارت الإعداد ظاهر للمالك", await vis(t("vessel-count-setting")));
  await t("vc-mode-approval").click(); await page.waitForTimeout(600);
  check("6. اختار «الموظف يعدّ والمالك يوافق»", rpcs("set_vessel_count_mode").pop()?.p_mode === "approval" && (await t("vc-mode-approval").innerText()).includes("✓"));
  await shot(page, "vessel-count-6-setting");

  // 7) a salary voucher for a month the payroll paid
  try {
  await page.goto(`${BASE}/branch/${B1}/treasury?tab=payments`); await settle(page);
  await page.getByRole("button", { name: "سند صرف جديد" }).first().click(); await dlg().waitFor(); await page.waitForTimeout(400);
  await dlg().getByRole("combobox").first().click(); await page.getByRole("option", { name: "رواتب موظفين", exact: true }).click(); await page.waitForTimeout(300);
  await dlg().locator('input[type="number"]').first().fill("500");
  await t("party-pick").click(); await page.waitForTimeout(200); await t("party-opt-e1").click(); await page.waitForTimeout(900);
  check("7. تنبيه «اتصرفله مرتب شهر 2026-11 … 5,000»", await vis(t("salary-dup")) && (await t("salary-dup").innerText()).includes("2026-11") && (await t("salary-dup").innerText()).includes("5,000"), await t("salary-dup").innerText().catch(() => ""));
  const n0 = rpcs("create_manual_voucher").length;
  await dlg().getByRole("button", { name: /حفظ|سجّل|تأكيد/ }).last().click(); await page.waitForTimeout(600);
  check("7. من غير «متأكد»: ما اتبعتش", rpcs("create_manual_voucher").length === n0 && (await toastText()).includes("المرتب ده اتصرف قبل كده"));
  await t("salary-dup-ok").check();
  await dlg().getByRole("button", { name: /حفظ|سجّل|تأكيد/ }).last().click(); await page.waitForTimeout(700);
  check("7. بعد «متأكد»: اتبعت", rpcs("create_manual_voucher").length === n0 + 1);
  await page.getByRole("button", { name: "سند صرف جديد" }).first().click(); await dlg().waitFor(); await page.waitForTimeout(400);
  await dlg().getByRole("combobox").first().click(); await page.getByRole("option", { name: "رواتب موظفين", exact: true }).click(); await page.waitForTimeout(300);
  await t("party-pick").click(); await page.waitForTimeout(200); await t("party-opt-e2").click(); await page.waitForTimeout(900);
  check("7. موظف ماتصرفلوش: مفيش تنبيه", !(await vis(t("salary-dup"))));
  } catch (e) { check("7. خطوة المرتب", false, String(e).split("\n")[0]); await shot(page, "vessel-count-7-fail"); }

  check("no page errors", !db.calls.some((c) => c.pageerror), db.calls.filter((c) => c.pageerror).map((c) => c.pageerror).join(" | "));
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
