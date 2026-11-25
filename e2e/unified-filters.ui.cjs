// UI test of the UNIFIED filter (owner 2026-11-18) — harness copied from the Excel filters test (owner 2026-10-26): arrows on every column over the WHOLE list
// (not the 50 rows of a page), linked to the filter bar on top, totals row, cards, remembered filters.
// Database faked in the browser. Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then:
//   node e2e/invoices-excel.ui.cjs
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

const CUSTOMERS = [
  { id: uuid("c0000001", 1), name: "اسامة الراعى الصالح", phone: "01000000001" },
  { id: uuid("c0000001", 2), name: "جارحي", phone: "01000000002" },
  null, // walk-in («نقدي»)
  { id: uuid("c0000001", 3), name: "المخزن الرئيسي", phone: "01000000003" },
];

/** 120 sales of one branch over October / September 2026 (three pages of 50) */
function makeInvoices() {
  const out = [];
  for (let i = 0; i < 120; i++) {
    const c = CUSTOMERS[i % 4];
    const total = (((i * 37) % 90) + 1) * 500;
    const month = i < 70 ? "10" : "09";
    const day = String((i % 28) + 1).padStart(2, "0");
    const status = i === 7 || i === 55 || i === 101 ? "cancelled" : "active";
    // every 4th fully paid at the sale («نقدي»), every 3rd half paid later, the rest open
    const paid = i % 4 === 0 ? total : i % 3 === 0 ? total / 2 : 0;
    const cash = i % 4 === 0 ? total : 0, instapay = i % 3 === 0 && i % 4 !== 0 ? total / 2 : 0;
    out.push({
      id: uuid("a0000001", i + 1), tenant_id: T, branch_id: B1, invoice_number: `IN0${5000 + i}`,
      contact_id: c ? c.id : null, contacts: c ? { name: c.name } : null,
      total, status, invoice_date: `2026-${month}-${day}T08:00:00+00:00`, created_at: `2026-${month}-${day}T08:00:00+00:00`,
      recipient_name: i < 6 ? (i % 2 ? "ا/محمود علاء ضيف" : "احمد ناصر") : i % 5 === 0 ? "محمد" : null,
      invoice_items: [{ product_name: i < 6 && i % 2 ? "سخان اوليمبيك 50 لتر" : "ثلاجة توشيبا 16 قدم" }], payment_method: "cash", notes: i % 6 === 0 ? "تسليم المخزن" : null,
      settle: {
        class: i % 4 === 0 ? "cash" : "credit", state: paid >= total ? "paid" : paid > 0 ? "partial" : "unpaid",
        at_sale: i % 4 === 0 ? total : 0, later_money: instapay, from_account: 0, from_return: 0,
        cash, instapay, wallet: 0, bank: 0, paid, remaining: total - paid,
      },
      __paid: paid,
    });
  }
  return out;
}


const CONTACT = "c0000001-0000-4000-8000-000000000001";
const PRODUCT = "e0000001-0000-4000-8000-000000000001";
const CASHIER = "f0000001-0000-4000-8000-000000000001";
/** 40 till rows: income / expense alternate, recorded by the owner or the cashier */
function makeTreasury() {
  return Array.from({ length: 40 }, (_, i) => ({
    id: uuid("d1000001", i + 1), tenant_id: T, branch_id: B1, type: i % 2 ? "expense" : "income", amount: (i + 1) * 100,
    payment_method: i % 3 ? "cash" : "instapay", category: "other", description: i % 4 ? `حركة ${i + 1}` : `مصاريف كهربا ${i + 1}`,
    transaction_date: `2026-11-${String((i % 15) + 1).padStart(2, "0")}`, created_at: `2026-11-${String((i % 15) + 1).padStart(2, "0")}T09:00:00+00:00`,
    created_by: i % 2 ? CASHIER : OWNER, reference_number: null, reference_id: null, voucher_id: null,
  }));
}
/** the contact file: 6 invoices of this account, 3 with a fridge, 3 with a heater */
function contactLines() {
  return Array.from({ length: 6 }, (_, i) => ({
    line_no: i + 1, line_date: `2026-11-0${i + 1}`, line_time: "10:00:00", reference: `IN0${5000 + i}`, line_type: "فاتورة بيع",
    debit: (i + 1) * 1000, credit: 0, balance: (i + 1) * 1000, notes: i === 2 ? "تسليم يوم الخميس" : null,
    src_table: "invoices", src_id: uuid("a0000001", i + 1), branch_id: B1, branch_name: "معرض سكة تلة",
  }));
}
function productLines() {
  return Array.from({ length: 6 }, (_, i) => ({
    line_no: i + 1, line_date: `2026-11-0${i + 1}`, line_time: "10:00:00", kind: "فاتورة بيع", doc_number: `IN0${5000 + i}`,
    contact_name: i % 2 ? "جارحي" : "اسامة الراعى الصالح", qty_in: 0, qty_out: 1, balance: 10 - i, unit_price: 18000,
    src_table: "invoices", src_id: uuid("a0000001", i + 1), branch_id: B1, branch_name: "معرض سكة تلة",
  }));
}

function makeDb() {
  return {
    calls: [],
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true }, { id: CASHIER, name: "ا/محمود علاء ضيف", username: "cashier1", tenant_id: T, is_active: true }],
    user_roles: [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T }],
    branch_users: [],
    branches: [{ id: B1, name: "معرض سكة تلة", code: "B1", tenant_id: T, is_active: true, is_system: false, platform_paused: false }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [],
    role_permissions: [],
    user_permissions: [],
    permission_templates: [],
    invoices: makeInvoices(),
    vouchers: makeVouchers(),
    treasury: makeTreasury(),
    contacts: [{ id: CONTACT, name: "اسامة الراعى الصالح", phone: "01000000001", type: "customer", branch_id: B1, tenant_id: T, opening_balance: 0 }],
    products: [
      { id: PRODUCT, name: "ثلاجة توشيبا 16 قدم", sku: "1001", branch_id: B1, tenant_id: T, quantity: 3, avg_cost: 15000, cost_price: 15000, selling_price: 18000, low_stock_alert: 1, initial_stock_date: "2026-01-01" },
      { id: uuid("e0000001", 2), name: "سخان اوليمبيك 50 لتر", sku: "1002", branch_id: B1, tenant_id: T, quantity: 5, avg_cost: 4000, cost_price: 4000, selling_price: 5200, low_stock_alert: 1, initial_stock_date: "2026-01-01" },
      { id: uuid("e0000001", 3), name: "غسالة فريش 8 ك", sku: "1003", branch_id: B1, tenant_id: T, quantity: 2, avg_cost: 9000, cost_price: 9000, selling_price: 11500, low_stock_alert: 1, initial_stock_date: "2026-01-01" },
    ],
    profiles_extra: [],
    stock_adjustments: [
      { id: uuid("e1000001", 1), branch_id: B1, tenant_id: T, adjustment_number: "ADJ-0001", reason: "كسر", notes: "اتكسرت في النقل", created_at: "2026-11-02T10:00:00+00:00", created_by: OWNER, stock_adjustment_items: [{ product_name: "ثلاجة توشيبا 16 قدم" }] },
      { id: uuid("e1000001", 2), branch_id: B1, tenant_id: T, adjustment_number: "ADJ-0002", reason: "عجز جرد", notes: null, created_at: "2026-11-05T10:00:00+00:00", created_by: CASHIER, stock_adjustment_items: [{ product_name: "سخان اوليمبيك 50 لتر" }] },
    ],
    inventory_sessions: [
      { id: uuid("e2000001", 1), branch_id: B1, tenant_id: T, status: "closed", notes: null, created_at: "2026-11-03T10:00:00+00:00", created_by: OWNER, branches: { name: "معرض سكة تلة" },
        inventory_session_items: [{ product_name: "ثلاجة توشيبا 16 قدم", product_code: "1001", unit_cost: 15000 }] },
      { id: uuid("e2000001", 2), branch_id: B1, tenant_id: T, status: "counting", notes: null, created_at: "2026-11-06T10:00:00+00:00", created_by: CASHIER, branches: { name: "معرض سكة تلة" },
        inventory_session_items: [{ product_name: "سخان اوليمبيك 50 لتر", product_code: "1002", unit_cost: 4000 }] },
    ],
    vessel_transfers: Array.from({ length: 4 }, (_, i) => ({ id: uuid("e3000001", i + 1), tenant_id: T, branch_id: B1, doc_number: `VT0000${i + 1}`,
      from_method: "cash", to_method: i % 2 ? "instapay" : "bank", amount: (i + 1) * 1000, fee_amount: 0, transfer_date: `2026-11-0${i + 1}`,
      notes: i === 3 ? "تحويل للبنك الأهلي" : null, status: "active", created_by: i % 2 ? CASHIER : OWNER, created_at: `2026-11-0${i + 1}T10:00:00+00:00` })),
    treasury_transfers: Array.from({ length: 4 }, (_, i) => ({ id: uuid("e4000001", i + 1), tenant_id: T, from_branch_id: i % 2 ? "b2000000-0000-0000-0000-000000000002" : B1,
      to_branch_id: i % 2 ? B1 : "b2000000-0000-0000-0000-000000000002", amount: (i + 1) * 2000, payment_method: "cash", fee_amount: 0, reference_number: `TT-${i + 1}`,
      reason: "تمويل", created_at: `2026-11-0${i + 1}T10:00:00+00:00`, transferred_by: i < 2 ? OWNER : CASHIER, acknowledged_at: i === 0 ? "2026-11-01T12:00:00+00:00" : null,
      rejected_at: null, returned_amount: 0, from_branch: { name: i % 2 ? "معرض شلبى" : "معرض سكة تلة" }, to_branch: { name: i % 2 ? "معرض سكة تلة" : "معرض شلبى" } })),
  };
}

/** 60 receipts: four payment methods, each settled one sale */
function makeVouchers() {
  const methods = ["cash", "instapay", "vodafone_cash", "bank_transfer"];
  return Array.from({ length: 60 }, (_, i) => ({
    id: uuid("b0000001", i + 1), tenant_id: T, branch_id: B1, type: "receipt", voucher_number: `RV-${String(i + 1).padStart(4, "0")}`,
    amount: (i + 1) * 250, payment_method: methods[i % 4], status: "active", source: i % 5 === 0 ? "manual" : "auto",
    voucher_date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, created_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T09:00:00+00:00`,
    treasury_id: uuid("d0000001", i + 1), party_name: null, description: `دفعة ${i + 1}`, recipient_name: null,
    voucher_categories: { name: "تحصيل من عميل", system_key: "customer_payment" }, party_type: "customer", flow_class: "customer",
  }));
}

/** the PostgREST filters this screen uses: eq / neq / gte / lte / in / is, offset + limit, count */
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
      if (op === "in") return raw.replace(/[()]/g, "").split(",").includes(String(x));
      const a = String(x ?? ""), b = raw;
      return op === "gte" ? a >= b : op === "lte" ? a <= b : op === "gt" ? a > b : a < b;
    });
  }
  return rows;
}

async function open(browser, db, me) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar-EG", acceptDownloads: true });
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
      db.calls.push({ rpc: name, n: Array.isArray(body.p_ids) ? body.p_ids.length : undefined });
      if (name === "branch_doc_users") return json([{ id: OWNER, name: "احمد ناصر" }, { id: CASHIER, name: "ا/محمود علاء ضيف" }]);
      if (name === "contact_account_movements") return json(contactLines());
      if (name === "ledger_contact_overview") return json({ contact: { id: CONTACT, name: "اسامة الراعى الصالح", type: "customer", phone: "01000000001" }, customer: { balance: 21000, debit: 21000, credit: 0 }, supplier: null });
      if (name === "product_document_movements") return json(productLines());
      if (name === "treasury_row_links") {
        return json((body.p_ids || []).map((tid) => {
          const v = db.vouchers.find((x) => x.treasury_id === tid);
          const n = v ? Number(v.voucher_number.slice(3)) : 0;
          return { id: tid, account_name: n % 2 ? "اسامة الراعى الصالح" : "جارحي", contact_id: null, src_type: "sale", src_id: uuid("a0000001", n), src_number: `IN0${5000 + n}` };
        }));
      }
      if (name === "voucher_money_split") {
        return json((body.p_ids || []).map((id) => {
          const v = db.vouchers.find((x) => x.id === id);
          return { voucher_id: id, in_ledger: true, allocated: v ? v.amount : 0, on_account: 0, docs: "IN05001" };
        }));
      }
      if (name === "ledger_document_status") {
        return json((body.p_ids || []).map((id) => {
          const x = db.invoices.find((r) => r.id === id);
          if (!x) return null;
          const paid = x.__paid;
          return { doc_id: id, total: x.total, paid, paid_money: paid, paid_by_returns: 0, paid_from_other_branches: 0, remaining: x.total - paid, state: paid >= x.total ? "paid" : paid > 0 ? "partial" : "credit" };
        }).filter(Boolean));
      }
      return json(null);
    }
    if (path.startsWith("/rest/v1/")) {
      const table = path.split("/").pop(); const method = req.method();
      if (method !== "GET" && method !== "HEAD") { db.calls.push({ table, method }); return json([]); }
      db.calls.push({ table, get: decodeURIComponent(url.search) });
      let rows = filt(db[table] ?? [], url);
      if (table === "invoices") rows = [...rows].sort((a, b) => (a.invoice_date < b.invoice_date ? 1 : a.invoice_date > b.invoice_date ? -1 : a.id < b.id ? -1 : 1));
      if (table === "vouchers") rows = [...rows].sort((a, b) => (a.voucher_date < b.voucher_date ? 1 : a.voucher_date > b.voucher_date ? -1 : a.id < b.id ? -1 : 1));
      const total = rows.length;
      const off = Number(url.searchParams.get("offset") ?? 0), lim = url.searchParams.get("limit");
      if (lim !== null) rows = rows.slice(off, off + Number(lim));
      const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
      if (single) return rows.length ? json(rows[0]) : route.fulfill({ status: 406, contentType: "application/json", body: JSON.stringify({ code: "PGRST116", message: "0 rows" }) });
      const end = rows.length ? off + rows.length - 1 : 0;
      // the real API lets the page read the count (Content-Range) across origins
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": `${off}-${end}/${total}`, "access-control-allow-origin": "*", "access-control-expose-headers": "Content-Range" }, body: JSON.stringify(rows) });
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
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
const panel = (page) => page.locator("form[data-unified-filters]").first();

async function common(page, name) {
  const p = panel(page);
  await p.waitFor({ timeout: 15000 });
  check(`${name}: الفلتر الموحد ظاهر`, await vis(p));
  check(`${name}: زرار «بحث» و«مسح الفلتر»`, await vis(p.getByRole("button", { name: /^بحث$/ })) && await vis(p.getByRole("button", { name: "مسح الفلتر" })));
  // period list
  await p.getByRole("combobox", { name: "الفترة" }).click();
  const opts = await page.getByRole("option").allInnerTexts();
  const want = ["اليوم", "الأمس", "الأسبوع الحالي", "الأسبوع السابق", "الأسبوع الأسبق", "الشهر الحالي", "الشهر السابق", "الشهر الأسبق", "العام الحالي", "العام السابق", "العام الأسبق", "بداية العام الحالي", "بداية العام السابق", "نهاية العام السابق"];
  check(`${name}: قايمة الفترة (14 اختيار)`, want.every((w) => opts.some((o) => o.trim() === w)), opts.join("،"));
  await page.getByRole("option", { name: "العام السابق", exact: true }).click();
  const from = await p.locator('input[type="date"]').nth(0).inputValue(), to = await p.locator('input[type="date"]').nth(1).inputValue();
  check(`${name}: «العام السابق» ملا من / إلى`, from.endsWith("-01-01") && to.endsWith("-12-31") && from.slice(0, 4) === to.slice(0, 4), `${from} → ${to}`);
  check(`${name}: زرار البحث بيبيّن إن فيه تغيير مستني`, ((await p.getByRole("button", { name: /^بحث$/ }).getAttribute("title")) || "").includes("لسه ما اتطبقتش"));
  // clear
  await p.getByRole("button", { name: "مسح الفلتر" }).click(); await settle(page);
  check(`${name}: «مسح الفلتر» فضّى التاريخ`, (await p.locator('input[type="date"]').nth(0).inputValue()) === "");
  return p;
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const db = makeDb();
  const { page } = await open(browser, db, OWNER);

  // ===== 1) documents (sale tab)
  await page.goto(`${BASE}/branch/${B1}/invoices?tab=sale`); await settle(page);
  let p = await common(page, "الفواتير");
  await shot(page, "uf-1-invoices");
  const before = db.calls.length;
  await p.getByRole("combobox", { name: "المستلم / البائع" }).click();
  const recips = await page.getByRole("option").allInnerTexts();
  check("الفواتير: المستلم / البائع قايمة باليوزرات", recips.some((x) => x.includes("ا/محمود علاء ضيف")) && recips.some((x) => x.includes("احمد ناصر")), recips.join("،"));
  await page.getByRole("option", { name: "ا/محمود علاء ضيف", exact: true }).click();
  await page.waitForTimeout(1200);
  const typedCalls = db.calls.slice(before).filter((c) => c.get && c.get.includes("recipient_name"));
  check("الفواتير: اختيار المستلم لوحده ما بيبحثش", typedCalls.length === 0);
  await p.getByRole("button", { name: /^بحث$/ }).click(); await settle(page);
  const applied = db.calls.slice(before).filter((c) => c.get && c.get.includes("recipient_name"));
  check("الفواتير: بعد «بحث» السيرفر اتسأل بالمستلم", applied.length > 0, applied[0]?.get ?? "");
  await p.getByRole("button", { name: "مسح الفلتر" }).click(); await settle(page);

  // Enter applies the search box
  const b2 = db.calls.length;
  await p.getByPlaceholder(/رقم المستند، اسم العميل/).fill("IN05003");
  await page.waitForTimeout(900);
  const noQ = db.calls.slice(b2).filter((c) => c.get && c.get.includes("IN05003")).length === 0;
  await p.getByPlaceholder(/رقم المستند، اسم العميل/).press("Enter"); await settle(page);
  const withQ = db.calls.slice(b2).filter((c) => c.get && c.get.includes("IN05003")).length > 0;
  check("الفواتير: الكتابة ما بتبحثش، Enter بيبحث", noQ && withQ);
  await p.getByRole("button", { name: "مسح الفلتر" }).click(); await settle(page);

  // ===== 2) treasury
  await page.goto(`${BASE}/branch/${B1}/treasury`); await settle(page);
  p = await common(page, "الخزنة");
  await shot(page, "uf-2-treasury");
  const hasTotal = async (n) => vis(p.getByText(new RegExp(`من أصل ${n} حركة`)));
  check("الخزنة: 40 حركة في الأول", await hasTotal(40));
  await p.getByRole("combobox", { name: "اللي سجّل الحركة" }).click();
  await page.getByRole("option", { name: "ا/محمود علاء ضيف", exact: true }).click();
  await page.waitForTimeout(800);
  check("الخزنة: قبل «بحث» العدد زي ما هو", await hasTotal(40));
  await p.getByRole("button", { name: /^بحث$/ }).click(); await settle(page);
  check("الخزنة: بعد «بحث» حركات الكاشير بس (20)", await hasTotal(20));
  await p.getByRole("button", { name: "مسح الفلتر" }).click(); await settle(page);
  check("الخزنة: «مسح الفلتر» رجّع الـ40", await hasTotal(40));

  // ===== 3) contact file
  await page.goto(`${BASE}/branch/${B1}/contacts/${CONTACT}`); await settle(page);
  const mv = page.locator('[data-testid="account-movements"]');
  p = mv.locator("form[data-unified-filters]");
  if (await vis(p)) {
    check("ملف العميل: الفلتر الموحد ظاهر", true);
    await shot(page, "uf-3-contact");
    await p.getByPlaceholder(/رقم المستند أو اسم الصنف/).fill("سخان");
    await p.getByRole("button", { name: /^بحث$/ }).click(); await settle(page);
    check("ملف العميل: البحث باسم صنف جوه الفاتورة = 3 فواتير", await vis(p.getByText(/من أصل 3 حركة/)));
    await p.getByRole("button", { name: "مسح الفلتر" }).click(); await settle(page);
    check("ملف العميل: «مسح الفلتر» رجّع الـ6", await vis(p.getByText(/من أصل 6 حركة/)));
  } else check("ملف العميل: الفلتر الموحد ظاهر", false, "مش ظاهر (الصفحة ما حملتش في البيانات المزيفة)");

  // ===== 4) item page
  await page.goto(`${BASE}/branch/${B1}/inventory/${PRODUCT}/movements`); await settle(page);
  const pm = page.locator('[data-testid="product-doc-movements"]');
  p = pm.locator("form[data-unified-filters]");
  if (await vis(p)) {
    check("صفحة الصنف: الفلتر الموحد ظاهر", true);
    await shot(page, "uf-4-product");
    await p.getByLabel("المبلغ من").fill("3000");
    await p.getByRole("button", { name: /^بحث$/ }).click(); await settle(page);
    check("صفحة الصنف: المبلغ على إجمالي المستند (≥ 3,000)", await vis(p.getByText(/من أصل \d+ حركة/)), await p.locator("header").innerText().catch(() => ""));
  } else check("صفحة الصنف: الفلتر الموحد ظاهر", false, "مش ظاهر");

  // ===== 5) inventory: products tab — amount on the selling / purchase price
  await page.goto(`${BASE}/branch/${B1}/inventory`); await settle(page);
  p = panel(page);
  if (await vis(p)) {
    check("المخزون (الأصناف): الفلتر الموحد ظاهر", true);
    await shot(page, "uf-5-inventory");
    const count = async () => (await p.locator("header").innerText()).match(/من أصل (\d+)/)?.[1];
    const before5 = await count();
    await p.getByLabel("المبلغ من").fill("10000"); await p.getByLabel("المبلغ إلى").fill("12000");
    check("المخزون: الكتابة ما بتفلترش قبل «بحث»", (await count()) === before5, `${before5}`);
    await p.getByRole("button", { name: /^بحث$/ }).click(); await settle(page);
    check("المخزون: على سعر البيع 10,000–12,000 = الغسالة بس (1)", (await count()) === "1", await count());
    await p.getByRole("combobox", { name: "المبلغ على سعر" }).click(); await page.getByRole("option", { name: "الشراء (التكلفة)", exact: true }).click();
    await p.getByLabel("المبلغ من").fill("8000"); await p.getByLabel("المبلغ إلى").fill("16000");
    await p.getByRole("button", { name: /^بحث$/ }).click(); await settle(page);
    check("المخزون: على سعر الشراء 8,000–16,000 = الثلاجة والغسالة (2)", (await count()) === "2", await count());
    await p.getByRole("button", { name: "مسح الفلتر" }).click(); await settle(page);
    check("المخزون: «مسح الفلتر» رجّع الكل", (await count()) === before5, `${await count()}`);
  } else check("المخزون (الأصناف): الفلتر الموحد ظاهر", false);

  // ===== 6) inventory: adjustments tab — item name inside the adjustment
  await page.goto(`${BASE}/branch/${B1}/inventory?tab=adjustments`); await settle(page);
  p = panel(page);
  if (await vis(p)) {
    check("تسوية المخزن: الفلتر الموحد ظاهر بدون خانة مبلغ", !(await vis(p.getByLabel("المبلغ من"))));
    await p.getByPlaceholder(/رقم التسوية/).fill("سخان"); await p.getByPlaceholder(/رقم التسوية/).press("Enter"); await settle(page);
    check("تسوية المخزن: البحث باسم صنف جوه التسوية = 1", await vis(p.getByText(/من أصل 1 تسوية/)));
    await p.getByRole("button", { name: "مسح الفلتر" }).click(); await settle(page);
    check("تسوية المخزن: «مسح الفلتر» = 2", await vis(p.getByText(/من أصل 2 تسوية/)));
  } else check("تسوية المخزن: الفلتر الموحد ظاهر", false);

  // ===== 7) inventory: count tab — amount on the item cost at the count
  await page.goto(`${BASE}/branch/${B1}/inventory?tab=count`); await settle(page);
  p = page.locator("form[data-unified-filters]").filter({ hasText: "جلسات الجرد" });
  if (await vis(p)) {
    check("الجرد: الفلتر الموحد ظاهر", true);
    await p.getByLabel("المبلغ من").fill("10000"); await p.getByRole("button", { name: /^بحث$/ }).click(); await settle(page);
    check("الجرد: تكلفة صنف ≥ 10,000 = جلسة الثلاجة (1)", await vis(p.getByText(/من أصل 1 جلسة/)));
    await p.getByRole("button", { name: "مسح الفلتر" }).click(); await settle(page);
    await p.getByPlaceholder(/اسم الصنف أو كوده/).fill("1002"); await p.getByRole("button", { name: /^بحث$/ }).click(); await settle(page);
    check("الجرد: البحث بكود صنف جوه الجلسة = 1", await vis(p.getByText(/من أصل 1 جلسة/)));
  } else check("الجرد: الفلتر الموحد ظاهر", false);

  // ===== 8) treasury: vessel transfers — search by VT number
  await page.goto(`${BASE}/branch/${B1}/treasury?tab=vessel_transfers`); await settle(page);
  p = page.locator("form[data-unified-filters]").filter({ hasText: "التحويلات بين الأوعية" });
  if (await vis(p)) {
    check("تحويلات الأوعية: الفلتر ظاهر وعمود الرقم VT", await vis(page.getByText("VT00003")));
    await p.getByPlaceholder("VT00012").fill("VT00003"); await p.getByPlaceholder("VT00012").press("Enter"); await settle(page);
    check("تحويلات الأوعية: البحث برقم المستند = 1", await vis(p.getByText(/من أصل 1 تحويل/)));
    await p.getByRole("button", { name: "مسح الفلتر" }).click(); await settle(page);
    await p.getByRole("combobox", { name: "إلى وعاء" }).click();
    const vopts = await page.getByRole("option").allInnerTexts();
    const bankLabel = vopts.find((o) => /بنك/.test(o));
    if (bankLabel) { await page.getByRole("option", { name: bankLabel.trim(), exact: true }).click(); await p.getByRole("button", { name: /^بحث$/ }).click(); await settle(page); }
    check("تحويلات الأوعية: «إلى وعاء» بنك = 2", !!bankLabel && await vis(p.getByText(/من أصل 2 تحويل/)), vopts.join("،"));
    await shot(page, "uf-8-vessels");
  } else check("تحويلات الأوعية: الفلتر ظاهر", false);

  // ===== 9) treasury: transfers between branches — direction + recorded by
  await page.goto(`${BASE}/branch/${B1}/treasury?tab=transfers`); await settle(page);
  p = page.locator("form[data-unified-filters]").filter({ hasText: "التحويلات بين الفروع" });
  if (await vis(p)) {
    check("تحويلات الفروع: الفلتر ظاهر", true);
    await p.getByRole("combobox", { name: "الاتجاه" }).click(); await page.getByRole("option", { name: "↗ صادر", exact: true }).click();
    await p.getByRole("button", { name: /^بحث$/ }).click(); await settle(page);
    check("تحويلات الفروع: صادر = 2", await vis(p.getByText(/من أصل 2 تحويل/)));
    await p.getByRole("button", { name: "مسح الفلتر" }).click(); await settle(page);
    await p.getByRole("combobox", { name: "الحالة" }).click(); await page.getByRole("option", { name: "بانتظار الاستلام", exact: true }).click();
    await p.getByRole("button", { name: /^بحث$/ }).click(); await settle(page);
    check("تحويلات الفروع: بانتظار الاستلام = 3", await vis(p.getByText(/من أصل 3 تحويل/)));
  } else check("تحويلات الفروع: الفلتر ظاهر", false);

  // ===== 10) all branches inventory (admin)
  await page.goto(`${BASE}/admin/catalog?tab=inventory`); await settle(page);
  p = page.locator("form[data-unified-filters]").filter({ hasText: "مخزون كل الفروع" });
  check("مخزون كل الفروع: الفلتر الموحد ظاهر", await vis(p));

  const errs = db.calls.filter((c) => c.pageerror);
  check("مفيش أخطاء في الصفحات", errs.length === 0, errs.map((e) => e.pageerror).join(" | ").slice(0, 300));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
