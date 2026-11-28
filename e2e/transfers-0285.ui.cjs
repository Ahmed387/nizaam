// «التحويل بين الفروع» (migrations 0285 / 0286, owner 2026-11-25): who may send / receive (per person per branch),
// the owner's approval above his limit, edit / cancel by the sender before it is received, the receiver picks the vessel,
// the fee typed by the person (none / fixed / percent) with a hint, goods edit / cancel, the owner's approval page,
// the limits card in settings and «مسح السجل كله» on «سجل المستندات». Database faked in the browser.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/transfers-0285.ui.cjs
const { chromium } = require("playwright");
const OUT = process.env.OUT_DIR || __dirname;
const BASE = "http://127.0.0.1:4173";
const SB = "https://kkfiplnucefytutlwaiz.supabase.co";
const REF = "kkfiplnucefytutlwaiz";
const T = "5316fbfe-b862-4c91-b48b-1d81c8aa5a71";
const OWNER = "85c76e60-3d27-4a99-8cd7-c8f8b39d914a";
const MGR = "9aa41d69-13ef-41d8-a6ca-b6c722c95c62";
const CASHIER = "11111111-0000-4000-8000-000000000001";
const B1 = "1329f6cc-0000-0000-0000-000000000001", B2 = "7a9f9e1b-0000-0000-0000-000000000002";
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.sig`;
const uuid = (p, i) => `${p}-0000-4000-8000-${String(i).padStart(12, "0")}`;
const tt = (i, o) => ({ id: uuid("dddddddd", i), tenant_id: T, from_branch_id: B1, to_branch_id: B2, amount: 1000, reason: "تجربة", payment_method: "instapay",
  fee_amount: 0, fee_mode: "none", fee_value: 0, reference_number: null, transferred_by: MGR, created_at: `2026-11-2${i % 5}T10:00:00Z`, transfer_date: "2026-11-25",
  acknowledged_at: null, rejected_at: null, approval_status: null, cancelled_at: null, cancel_reason: null, received_amount: null, returned_amount: null,
  received_method: null, edit_note: null, ...o });
const st = (i, o) => ({ id: uuid("eeeeeeee", i), tenant_id: T, from_branch_id: B1, to_branch_id: B2, product_id: uuid("ffffffff", 1), quantity: 2, status: "pending",
  group_id: uuid("cccccccc", 1), reason: "تجربة", transferred_by: MGR, created_at: "2026-11-25T10:00:00Z", transfer_date: "2026-11-25", received_quantity: null,
  hidden_for_branches: [], rejection_reason: null, confirmed_at: null, ...o });
function makeDb() {
  return {
    calls: [],
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an", tenant_id: T, is_active: true },
               { id: MGR, name: "محمود علاء", username: "ma", tenant_id: T, is_active: true },
               { id: CASHIER, name: "محمد ياسر", username: "my", tenant_id: T, is_active: true }],
    user_roles: [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T },
                 { user_id: MGR, role: "branch_manager", tenant_id: T }, { user_id: CASHIER, role: "cashier", tenant_id: T }],
    branch_users: [{ user_id: MGR, branch_id: B1, access_level: "manage", tenant_id: T }, { user_id: MGR, branch_id: B2, access_level: "manage", tenant_id: T },
                   { user_id: CASHIER, branch_id: B1, access_level: "manage", tenant_id: T }],
    branches: [{ id: B1, name: "معرض سكة تلة", code: "B1", tenant_id: T, is_active: true, is_system: false, platform_paused: false, low_balance_threshold: 0 },
               { id: B2, name: "معرض عبدالمنعم", code: "B2", tenant_id: T, is_active: true, is_system: false, platform_paused: false, low_balance_threshold: 0 }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [], role_permissions: [], user_permissions: [], permission_templates: [], vessel_access: [], vessel_accounts: [],
    transfer_fees: [
      { tenant_id: T, payment_method: "instapay", label: "انستاباي", kind: "wallet", fee_type: "fixed", fee_value: 0, is_enabled: true, show_in_payments: true },
      { tenant_id: T, payment_method: "vodafone", label: "فودافون كاش", kind: "wallet", fee_type: "fixed", fee_value: 0, is_enabled: true, show_in_payments: true }],
    treasury: [], vouchers: [], voucher_categories: [],
    treasury_transfers: [
      tt(1, { amount: 1000 }),
      tt(2, { amount: 5000, approval_status: "waiting" }),
      tt(3, { from_branch_id: B2, to_branch_id: B1, amount: 700, payment_method: "instapay", transferred_by: OWNER }),
      tt(4, { amount: 300, cancelled_at: "2026-11-24T10:00:00Z", cancel_reason: "غلط" }),
      tt(5, { amount: 200, acknowledged_at: "2026-11-24T11:00:00Z", received_amount: 200, returned_amount: 0 }),
    ],
    stock_transfers: [
      st(1, {}),
      st(2, { product_id: uuid("ffffffff", 2) }),
      st(3, { status: "awaiting_approval", group_id: uuid("cccccccc", 2), quantity: 5 }),
      st(4, { from_branch_id: B2, to_branch_id: B1, group_id: uuid("cccccccc", 3), transferred_by: OWNER }),
    ],
    products: [{ id: uuid("ffffffff", 1), name: "غسالة فريش", branch_id: B1, quantity: 10, tenant_id: T, sku: "1", selling_price: 100, cost_price: 50 },
               { id: uuid("ffffffff", 2), name: "مروحة توشيبا", branch_id: B1, quantity: 10, tenant_id: T, sku: "2", selling_price: 100, cost_price: 50 }],
    approval_requests: [{ id: uuid("aaaaaaaa", 1), tenant_id: T, branch_id: B1, entity_type: "treasury_transfer", entity_id: uuid("dddddddd", 2),
      entity_label: "تحويل فلوس 5,000.00 ج.م انستاباي من معرض سكة تلة لـ معرض عبدالمنعم", action: "update", payload: { kind: "money_transfer", amount: 5000, limit: 1000 },
      reason: "كبير", status: "pending", requested_by: MGR, requested_by_name: "محمود علاء", created_at: "2026-11-25T10:00:00Z" }],
    document_events: [],
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
  // these checks click a row's own buttons: keep them in the row (the «⋮» menu itself is tested in column-resize / roles-buttons)
  await ctx.addInitScript(() => { const on = () => document.documentElement?.setAttribute("data-no-row-menu", ""); on(); document.addEventListener("readystatechange", on); });
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
      if (name === "get_transfer_approval_limits") return json({ money: 1000, goods: 500 });
      if (["edit_money_transfer", "cancel_money_transfer", "receive_treasury_transfer", "transfer_treasury_atomic", "edit_stock_transfer",
           "cancel_stock_transfer", "cancel_stock_transfer_group", "set_transfer_approval_limits", "purge_document_log"].includes(name)) return json({ ok: true });
      if (name === "stock_transfer_values") return json([]);
      if (name === "document_log_page") return json({ rows: [], total: 0 });
      if (name === "get_branch_wallet_balances") return json([{ cash_balance: 1000, vodafone_balance: 500, instapay_balance: 50000, bank_balance: 0, other_balance: 0, total_balance: 51500 }]);
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
      if (table === "treasury_transfers" || table === "stock_transfers") {
        const or = url.searchParams.get("or");
        if (or) { const ids = [...or.matchAll(/(from|to)_branch_id\.eq\.([0-9a-f-]+)/g)].map((m) => [m[1], m[2]]); rows = rows.filter((r) => ids.some(([k, v]) => r[`${k}_branch_id`] === v)); }
        rows = rows.map((r) => ({ ...r, from_branch: { name: db.branches.find((b) => b.id === r.from_branch_id)?.name }, to_branch: { name: db.branches.find((b) => b.id === r.to_branch_id)?.name },
          products: db.products.find((p) => p.id === r.product_id) }));
      }
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
  const rpc = (db, n) => db.calls.filter((c) => c.rpc === n);
  process.on("uncaughtException", (e) => { console.log(results.join("\n")); console.log("CRASH", String(e).slice(0, 300)); process.exit(1); });
  process.on("unhandledRejection", (e) => { console.log(results.join("\n")); console.log("CRASH", String(e).slice(0, 300)); process.exit(1); });

  // ── A) the branch manager (sender) on his till ──
  const db = makeDb();
  const a = await open(browser, db, MGR);
  const page = a.page;
  await page.goto(`${BASE}/branch/${B1}/treasury?tab=transfers`); await settle(page);
  const row = (amt) => page.locator("tr", { hasText: amt });
  check("1. المرسل: «تعديل» و«إلغاء» على تحويل لسه ما اتستلمش", await vis(row("1,000").getByRole("button", { name: "تعديل" })) && await vis(row("1,000").getByRole("button", { name: "إلغاء" })));
  check("2. «مستني موافقة المالك» على التحويل الكبير وفيه تعديل / إلغاء", await vis(row("5,000").getByText(/مستني موافقة المالك/)) && await vis(row("5,000").getByRole("button", { name: "إلغاء" })));
  check("3. الملغي: «اتلغى — غلط» ومفيش زراير", await vis(row("300").getByText(/اتلغى — غلط/)) && !(await vis(row("300").getByRole("button", { name: "تعديل" }))));
  check("4. اللي اتستلم: مفيش تعديل", !(await vis(row("200").getByRole("button", { name: "تعديل" }))));
  check("5. الوارد لفرعه: «تأكيد» و«رفض»", await vis(row("700").getByRole("button", { name: "تأكيد" })) && await vis(row("700").getByRole("button", { name: "رفض" })));
  await page.screenshot({ path: `${OUT}/t0285-1-transfers.png`, fullPage: true });

  await row("1,000").getByRole("button", { name: "تعديل" }).click(); await page.waitForTimeout(400);
  let dlg = page.getByRole("dialog");
  await dlg.locator('input[type="number"]').first().fill("800");
  await dlg.getByRole("button", { name: "رقم ثابت" }).click();
  await dlg.getByLabel("مبلغ العمولة").fill("15");
  const hint = await dlg.getByTestId("fee-hint").innerText();
  check("6. التعديل: العمولة رقم ثابت 15 والتنبيه بيقول هيطلع 815 والعمولة بتفضل مصروف لو اترفض", /815/.test(hint) && /العمولة بتفضل مصروف/.test(hint), hint);
  await dlg.getByRole("textbox").last().fill("غلطت في المبلغ");
  await dlg.getByRole("button", { name: "حفظ التعديل" }).click(); await page.waitForTimeout(600);
  const ed = rpc(db, "edit_money_transfer");
  check("7. edit_money_transfer: 800 + fixed 15 + السبب", ed.length === 1 && ed[0].body.p_amount === 800 && ed[0].body.p_fee_mode === "fixed" && ed[0].body.p_fee_value === 15 && ed[0].body.p_reason === "غلطت في المبلغ", JSON.stringify(ed[0]?.body));

  await row("1,000").getByRole("button", { name: "إلغاء" }).click(); await page.waitForTimeout(400);
  dlg = page.getByRole("dialog");
  check("8. الإلغاء بيقول الفلوس بترجع في يوم التحويل", /بيرجعوا لخزنتك في يوم التحويل/.test(await dlg.innerText()));
  await dlg.getByRole("textbox").fill("مش محتاجه");
  await dlg.getByRole("button", { name: "تأكيد الإلغاء" }).click(); await page.waitForTimeout(600);
  check("9. cancel_money_transfer بالسبب", rpc(db, "cancel_money_transfer")[0]?.body?.p_reason === "مش محتاجه");

  await row("700").getByRole("button", { name: "تأكيد" }).click(); await page.waitForTimeout(400);
  dlg = page.getByRole("dialog");
  check("10. الاستلام بيسأل «وصلت على أنهي وعاء؟»", await vis(dlg.getByText("وصلت على أنهي وعاء؟")));
  await dlg.getByRole("combobox", { name: "وصلت على أنهي وعاء" }).click(); await page.waitForTimeout(300);
  await page.getByRole("option", { name: /نقدي|كاش/ }).first().click(); await page.waitForTimeout(300);
  check("11. اختار كاش: بيقول «هتدخل خزنتك على» كاش", /هتدخل خزنتك على/.test(await dlg.innerText()));
  await dlg.getByRole("button", { name: "تأكيد الاستلام" }).click(); await page.waitForTimeout(600);
  const rc = rpc(db, "receive_treasury_transfer");
  check("12. receive_treasury_transfer بالمبلغ كله و p_method = cash", rc.length === 1 && rc[0].body.p_received === 700 && rc[0].body.p_method === "cash", JSON.stringify(rc[0]?.body));

  // new transfer above the limit with a percent fee
  await page.getByRole("button", { name: "تحويل لفرع" }).click(); await page.waitForTimeout(500);
  dlg = page.getByRole("dialog");
  await dlg.locator("select").first().selectOption(B2);
  await dlg.locator('input[type="number"]').first().fill("1500");
  check("13. فوق الحد (1,000): «هيروح لصاحب الشركة يوافق الأول»", await vis(dlg.getByTestId("needs-approval")));
  await dlg.getByRole("combobox").nth(1).click(); await page.waitForTimeout(300);
  await page.getByRole("option", { name: /انستاباي/ }).first().click(); await page.waitForTimeout(400);
  await dlg.getByRole("button", { name: "نسبة %" }).click();
  await dlg.getByLabel("نسبة العمولة").fill("1");
  const h2 = await dlg.getByTestId("fee-hint").innerText();
  check("14. نسبة 1% من 1,500 = 15 والتنبيه بيقول هيطلع 1,515", /1,515/.test(h2), h2);
  for (const ph of ["حسابنا اللي اتحول منه", "الحساب اللي اتحول إليه"]) {
    const inp = dlg.getByPlaceholder(ph);
    if (await vis(inp)) await inp.first().fill("01018232539");
  }
  await page.screenshot({ path: `${OUT}/t0285-2-send.png` });
  await dlg.getByRole("button", { name: "تحويل", exact: true }).click(); await page.waitForTimeout(700);
  const sd = rpc(db, "transfer_treasury_atomic");
  if (!sd.length) console.log("toast:", await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => []));
  check("15. transfer_treasury_atomic: percent 1 + fee 15", sd.length === 1 && sd[0].body.p_fee_mode === "percent" && sd[0].body.p_fee_value === 1 && sd[0].body.p_fee_amount === 15, JSON.stringify(sd[0]?.body));

  // goods
  await page.goto(`${BASE}/branch/${B1}/transfers`); await settle(page);
  await page.getByRole("tab", { name: /صادرة/ }).click(); await page.waitForTimeout(500);
  check("16. البضاعة الصادرة: «تعديل الكمية» و«إلغاء» و«إلغاء التحويل كله»", await vis(page.getByRole("button", { name: "تعديل الكمية" })) && await vis(page.getByRole("button", { name: "إلغاء التحويل كله" })));
  check("17. «مستني موافقة المالك» على تحويل البضاعة الكبير", await vis(page.getByText(/مستني موافقة المالك/)));
  await page.getByRole("button", { name: "تعديل الكمية" }).first().click(); await page.waitForTimeout(400);
  dlg = page.getByRole("dialog");
  await dlg.locator('input[type="number"]').fill("1");
  check("18. تعديل 2 ← 1: «هيرجع 1 لمخزنك»", /هيرجع 1 لمخزنك/.test(await dlg.innerText()));
  await dlg.getByRole("textbox").last().fill("واحدة بس");
  await dlg.getByRole("button", { name: "حفظ" }).click(); await page.waitForTimeout(600);
  const es = rpc(db, "edit_stock_transfer");
  check("19. edit_stock_transfer بالكمية 1", es.length === 1 && es[0].body.p_quantity === 1);
  await page.getByRole("button", { name: "إلغاء التحويل كله" }).click(); await page.waitForTimeout(400);
  dlg = page.getByRole("dialog");
  await dlg.getByRole("textbox").fill("غلط");
  await dlg.getByRole("button", { name: "تأكيد الإلغاء" }).click(); await page.waitForTimeout(600);
  check("20. cancel_stock_transfer_group اتنادى", rpc(db, "cancel_stock_transfer_group").length === 1);
  await page.getByRole("tab", { name: /واردة/ }).click(); await page.waitForTimeout(400);
  check("21. الوارد: المدير يقدر يستلم", await vis(page.getByRole("button", { name: "استلام" })));
  await page.screenshot({ path: `${OUT}/t0285-3-goods.png`, fullPage: true });
  await a.ctx.close();

  // ── B) the cashier: no send, no receive ──
  const dbc = makeDb();
  const c = await open(browser, dbc, CASHIER);
  await c.page.goto(`${BASE}/branch/${B1}/treasury?tab=transfers`); await settle(c.page);
  check("22. الكاشير: مفيش «تحويل لفرع» ولا «تأكيد» ولا «تعديل»", !(await vis(c.page.getByRole("button", { name: "تحويل لفرع" }))) && !(await vis(c.page.getByRole("button", { name: "تأكيد" }))) && !(await vis(c.page.getByRole("button", { name: "تعديل" }))));
  await c.ctx.close();

  // ── C) the owner ──
  const dbo = makeDb();
  const o = await open(browser, dbo, OWNER);
  await o.page.goto(`${BASE}/admin/approvals-hub?tab=approvals`); await settle(o.page);
  const ot = await o.page.locator("main").innerText();
  check("23. طلبات الموافقة: «موافقة على تحويل» + «تحويل فلوس بين الفروع»", /موافقة على تحويل/.test(ot) && /تحويل فلوس بين الفروع/.test(ot));
  await o.page.getByRole("button", { name: "موافقة" }).first().click(); await o.page.waitForTimeout(400);
  check("24. نافذة الموافقة بتقول الفلوس بتتخصم النهارده لو وافقت", /بتتخصم من الفرع المرسل النهارده/.test(await o.page.getByTestId("transfer-approval-effect").innerText()));
  await o.page.keyboard.press("Escape");
  await o.page.goto(`${BASE}/admin/settings`); await settle(o.page);
  await o.page.getByText("الفلوس والخزائن").first().click({ timeout: 8000 }); await settle(o.page);
  await o.page.getByText("طرق الدفع والعمولات").first().click({ timeout: 8000 }); await settle(o.page);
  const card = o.page.getByTestId("transfer-limits");
  check("25. كارت «موافقة المالك على التحويلات» فيه الحدين", await vis(card) && (await card.locator("input").first().inputValue()) === "1000");
  check("26. الإعدادات مبقاش فيها «نوع العمولة»", !(await vis(o.page.getByText("نوع العمولة"))));
  await card.locator("input").first().fill("2000");
  await card.getByRole("button", { name: "حفظ" }).click(); await o.page.waitForTimeout(500);
  const sl = rpc(dbo, "set_transfer_approval_limits");
  check("27. set_transfer_approval_limits(2000, 500)", sl.length === 1 && sl[0].body.p_money === 2000 && sl[0].body.p_goods === 500);
  await o.page.screenshot({ path: `${OUT}/t0285-4-settings.png`, fullPage: true });
  await o.page.goto(`${BASE}/admin/reports-hub?tab=doc-log`); await settle(o.page);
  const pb = o.page.getByRole("button", { name: "مسح السجل كله" });
  check("28. «سجل المستندات»: زرار «مسح السجل كله» للمالك", await vis(pb));
  if (await vis(pb)) {
    await pb.click(); await o.page.waitForTimeout(300);
    const d = o.page.getByRole("dialog");
    const btn = d.getByRole("button", { name: "مسح نهائي" });
    const disabledBefore = await btn.isDisabled();
    await d.getByLabel("كلمة التأكيد").fill("مسح");
    await btn.click(); await o.page.waitForTimeout(500);
    check("29. مقفول لحد ما يكتب «مسح» وبعدها purge_document_log", disabledBefore && rpc(dbo, "purge_document_log")[0]?.body?.p_confirm === "مسح");
  } else check("29. purge", false);
  await o.ctx.close();

  const errs = [...db.calls, ...dbc.calls, ...dbo.calls].filter((x) => x.pageerror);
  check("30. مفيش أخطاء في الصفحات", errs.length === 0, errs.map((e) => e.pageerror).join(" | ").slice(0, 500));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
