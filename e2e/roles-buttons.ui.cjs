// Roles × buttons (owner 2026-11-18 «اختبار في المتصفح لكل دور … يتأكد إن الزراير بتظهر وبتختفي صح») — same harness as the filter test (owner 2026-10-26): arrows on every column over the WHOLE list
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
      { id: uuid("e2000001", 3), branch_id: B1, tenant_id: T, status: "reviewing", notes: null, created_at: "2026-11-07T10:00:00+00:00", created_by: CASHIER, branches: { name: "معرض سكة تلة" },
        inventory_session_items: [{ product_name: "غسالة فريش 8 ك", product_code: "1003", unit_cost: 9000 }] },
      { id: uuid("e2000001", 4), branch_id: B1, tenant_id: T, status: "pending_approval", notes: null, created_at: "2026-11-08T10:00:00+00:00", created_by: CASHIER, branches: { name: "معرض سكة تلة" },
        inventory_session_items: [{ product_name: "غسالة فريش 8 ك", product_code: "1003", unit_cost: 9000 }] },
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
  // these checks look for a row's own buttons: keep them in the row, except where `keepRowMenu` is set (the «⋮» check)
  await ctx.addInitScript(() => {
    const on = () => { if (sessionStorage.getItem("keepRowMenu") !== "1") document.documentElement?.setAttribute("data-no-row-menu", ""); };
    on(); document.addEventListener("readystatechange", on);
  });
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
      if (name === "contacts_page") return json({ rows: [
          { id: CONTACT, name: "اسامة الراعى الصالح", type: "both", branch_id: B1, account_no: 101, phone: null, customer_balance: 1000, supplier_balance: 0 },
          { id: uuid("c0000001", 2), name: "شركة فريش", type: "supplier", branch_id: B1, account_no: 102, phone: null, customer_balance: 0, supplier_balance: 5000 },
        ], total: 2, counts: { all: 2, customer: 0, supplier: 1, both: 1 }, totals: {}, sides: { customer: true, supplier: true } });
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
// a row button the «⋮» menu holds (hidden in its cell, owner 2026-11-28) counts as shown: it is in the menu
const vis = async (loc) => {
  if (await loc.first().isVisible().catch(() => false)) return true;
  if (!(await loc.count().catch(() => 0))) return false;
  return loc.first().evaluate((el) => !!el.closest("td[data-ra]"), null, { timeout: 2000 }).catch(() => false);
};
const settle = async (page) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1200); };

const ME = "a9000000-0000-4000-8000-000000000001";
// role, branch level, and what each button must do — the defaults of src/lib/roles.ts (no saved rows)
const PEOPLE = [
  { label: "كاشير",      role: "cashier", sc: { newCount: false, count: false, review: false, approve: false, cancelOpen: false },        level: "manage", add: true,  edit: false, archive: false, receipt: true,  payment: false,
    newProduct: false, editProduct: false, archiveProduct: false, cancelSale: false, newPreorder: true,  newTransfer: false, addEmployee: false },
  { label: "أمين مخزن",  role: "warehouse", sc: { newCount: true, count: true, review: false, approve: false, cancelOpen: false },      level: "manage", add: true,  edit: true,  archive: false, receipt: false, payment: false,
    newProduct: true,  editProduct: true,  archiveProduct: false, cancelSale: false, newPreorder: false, newTransfer: true,  addEmployee: true },
  { label: "مدير فرع",   role: "branch_manager", sc: { newCount: true, count: true, review: true, approve: false, cancelOpen: true }, level: "manage", add: true,  edit: true,  archive: true,  receipt: true,  payment: true,
    newProduct: true,  editProduct: true,  archiveProduct: true,  cancelSale: true,  newPreorder: true,  newTransfer: true,  addEmployee: true },
  { label: "مراقب",      role: "viewer", sc: { newCount: false, count: false, review: false, approve: false, cancelOpen: false },         level: null,     add: false, edit: false, archive: false, receipt: false, payment: false,
    newProduct: false, editProduct: false, archiveProduct: false, cancelSale: false, newPreorder: false, newTransfer: false, addEmployee: false },
  { label: "مدير فرع «عرض فقط»", role: "branch_manager", sc: { newCount: false, count: false, review: false, approve: false, cancelOpen: false }, level: "read", add: false, edit: false, archive: false, receipt: false, payment: false,
    newProduct: false, editProduct: false, archiveProduct: false, cancelSale: false, newPreorder: false, newTransfer: false, addEmployee: false },
  { label: "كاشير اتفتحله «يعدل» بس", role: "cashier", sc: { newCount: false, count: false, review: false, approve: false, cancelOpen: false }, level: "manage", rules: [{ permission_key: "customers.update", allowed: true }],
    add: true, edit: true, archive: false, receipt: true, payment: false,
    newProduct: false, editProduct: false, archiveProduct: false, cancelSale: false, newPreorder: true, newTransfer: false, addEmployee: false },
  { label: "مدير فرع اتقفل عليه «إلغاء البيع» و«المخزون ← يلغي»", role: "branch_manager", sc: { newCount: true, count: true, review: true, approve: false, cancelOpen: true }, level: "manage",
    rules: [{ permission_key: "sales.delete", allowed: false }, { permission_key: "inventory.delete", allowed: false }],
    add: true, edit: true, archive: true, receipt: true, payment: true,
    newProduct: true, editProduct: true, archiveProduct: false, cancelSale: false, newPreorder: true, newTransfer: true, addEmployee: true },
];

async function countChecks(page, label, sc) {
  await page.goto(`${BASE}/branch/${B1}/inventory-count`); await settle(page);
  const look = async (name, want, loc) => { const v = await vis(loc); check(`${label}: الجرد — ${name} ${want ? "ظاهر" : "مخفي"}`, v === want, `ظاهر=${v}`); };
  await look("«بدء جرد جديد»", sc.newCount, page.getByRole("button", { name: /بدء جرد جديد/ }));
  await look("«إدخال العد»", sc.count, page.getByRole("button", { name: "إدخال العد", exact: true }));
  await look("«مراجعة»", sc.review, page.getByRole("button", { name: "مراجعة", exact: true }));
  await look("«اعتماد»", sc.approve, page.getByRole("button", { name: "اعتماد", exact: true }));
  await look("«إلغاء» جرد مفتوح", sc.cancelOpen, page.getByRole("button", { name: "إلغاء", exact: true }));
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  for (const p of PEOPLE) {
    const db = makeDb();
    db.profiles.push({ id: ME, name: `موظف ${p.label}`, username: "t", tenant_id: T, is_active: true });
    db.user_roles = [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: ME, role: p.role, tenant_id: T }];
    db.branch_users = p.level ? [{ user_id: ME, branch_id: B1, access_level: p.level, full_access: false, branch_role: null, branch_template: null, branches: db.branches[0] }] : [];
    db.user_permissions = (p.rules ?? []).map((r) => ({ ...r, user_id: ME, tenant_id: T, branch_id: null }));
    db.pre_orders = []; db.stock_transfers = []; db.employees = [];
    const { page, ctx } = await open(browser, db, ME);

    // accounts page
    await page.goto(`${BASE}/branch/${B1}/contacts`); await settle(page);
    const addBtn = await vis(page.getByRole("button", { name: /إضافة جهة/ }));
    check(`${p.label}: «إضافة جهة» ${p.add ? "ظاهر" : "مخفي"}`, addBtn === p.add, `ظاهر=${addBtn}`);
    const editBtn = await vis(page.getByRole("button", { name: "تعديل", exact: true }));
    const notesBtn = await vis(page.getByRole("button", { name: /تعديل ملاحظات/ }));
    check(`${p.label}: قلم «الملاحظة» ${p.edit ? "ظاهر" : "مخفي"}`, notesBtn === p.edit, `ظاهر=${notesBtn}`);
    check(`${p.label}: «تعديل» الحساب ${p.edit ? "ظاهر" : "مخفي"}`, editBtn === p.edit, `ظاهر=${editBtn}`);
    const archBtn = await vis(page.getByRole("button", { name: "أرشفة", exact: true }));
    check(`${p.label}: «أرشفة» الحساب ${p.archive ? "ظاهر" : "مخفي"}`, archBtn === p.archive, `ظاهر=${archBtn}`);

    // vouchers — from the documents page (the cashier has no till page)
    await page.goto(`${BASE}/branch/${B1}/invoices?tab=income`); await settle(page);
    const rv = page.getByRole("button", { name: "سند قبض جديد", exact: true });
    const rvShown = await vis(rv);
    check(`${p.label}: «سند قبض جديد» ${p.receipt ? "ظاهر" : "مخفي"}`, rvShown === p.receipt, `ظاهر=${rvShown}`);
    if (rvShown) {
      await rv.first().click(); await page.waitForTimeout(800);
      const dlg = await vis(page.getByRole("dialog"));
      check(`${p.label}: «سند قبض جديد» بيفتح الفورم في نفس الصفحة`, dlg && page.url().includes("/invoices"), page.url());
      await page.keyboard.press("Escape");
    }
    await page.goto(`${BASE}/branch/${B1}/invoices?tab=expense`); await settle(page);
    const pvShown = await vis(page.getByRole("button", { name: "سند صرف جديد", exact: true }));
    check(`${p.label}: «سند صرف جديد» ${p.payment ? "ظاهر" : "مخفي"}`, pvShown === p.payment, `ظاهر=${pvShown}`);

    // inventory
    await page.goto(`${BASE}/branch/${B1}/inventory`); await settle(page);
    const look = async (name, want, loc) => { const v = await vis(loc); check(`${p.label}: ${name} ${want ? "ظاهر" : "مخفي"}`, v === want, `ظاهر=${v}`); };
    await look("«منتج جديد»", p.newProduct, page.getByRole("button", { name: "منتج جديد", exact: true }));
    await look("تعديل الصنف", p.editProduct, page.getByTitle("تعديل بيانات المنتج"));
    await look("أرشفة الصنف", p.archiveProduct, page.getByTitle("حذف / أرشفة المنتج"));
    // sales list: cancel
    await page.evaluate(() => sessionStorage.setItem("keepRowMenu", "1"));
    await page.goto(`${BASE}/branch/${B1}/invoices?tab=sale`); await settle(page);
    // the document tables group a row's buttons in ONE «⋮» menu (owner PDF 2026-11-28): look inside it
    {
      const ra = page.getByTestId("row-actions").first();
      let v;
      if (await ra.count()) {
        await ra.click(); await page.waitForTimeout(150);
        v = (await page.locator('[data-testid="row-actions-menu"] [role=menuitem]').filter({ hasText: "إلغاء الفاتورة" }).count()) > 0;
        await page.keyboard.press("Escape");
      } else v = await vis(page.getByTitle("إلغاء الفاتورة (مع رد المدفوع)"));
      check(`${p.label}: إلغاء فاتورة البيع ${p.cancelSale ? "ظاهر" : "مخفي"}`, v === p.cancelSale, `ظاهر=${v}`);
      // the menu itself, once (a role that can cancel): the row's own buttons hidden, the dangerous one last in red,
      // «تأكيد …؟» first, then the real button runs (its dialog opens outside the menu)
      if (p.cancelSale && !globalThis.__raChecked && (await ra.count())) {
        globalThis.__raChecked = true;
        const own = await page.evaluate(() => {
          const td = document.querySelector("[data-ra-button]")?.closest("td");
          return td ? Array.from(td.children).filter((c) => !c.hasAttribute("data-ra-holder")).every((c) => getComputedStyle(c).display === "none") : false;
        });
        check("⋮ فواتير البيع: أزرار الصف مستخبية وفيه ⋮ واحد", own);
        await ra.click(); await page.waitForTimeout(150);
        const items = page.locator('[data-testid="row-actions-menu"] [role=menuitem]');
        const texts = await items.allInnerTexts();
        const last = items.last();
        const red = await last.evaluate((b) => b.className.includes("text-destructive"));
        check("⋮ فواتير البيع: الإلغاء آخر واحد وبالأحمر", /إلغاء/.test(texts[texts.length - 1] ?? "") && red, texts.join(" | "));
        // the menu is wholly on the screen, also on a narrower screen (owner 2026-11-28 «القائمة مش باينة كلها»)
        const inView = async () => { const vp = page.viewportSize(); const bb = await page.getByTestId("row-actions-menu").boundingBox(); return !!bb && bb.x >= 0 && bb.x + bb.width <= vp.width && bb.y >= 0 && bb.y + bb.height <= vp.height ? "" : JSON.stringify({ bb, vp }); };
        const v1 = await inView();
        await page.keyboard.press("Escape");
        await page.setViewportSize({ width: 1024, height: 700 }); await page.waitForTimeout(400);
        const raN = page.getByTestId("row-actions").last();
        await raN.scrollIntoViewIfNeeded(); await raN.click(); await page.waitForTimeout(200);
        const v2 = await inView();
        await page.screenshot({ path: `${__dirname}/row-menu-invoices-1024.png` });
        await page.keyboard.press("Escape");
        await page.setViewportSize({ width: 1440, height: 1000 }); await page.waitForTimeout(300);
        check("⋮ فواتير البيع: القايمة كلها جوه الشاشة (1440 و 1024، آخر صف)", !v1 && !v2, v1 || v2);
        await ra.click(); await page.waitForTimeout(150);
        await last.click(); await page.waitForTimeout(150);
        check("⋮ فواتير البيع: الإلغاء بيسأل «تأكيد …؟» الأول", (await page.getByTestId("row-action-confirm").count()) === 1 && (await page.getByRole("dialog").count()) === 0);
        await page.getByTestId("row-action-confirm-yes").click(); await page.waitForTimeout(400);
        check("⋮ فواتير البيع: «تأكيد» بيفتح نافذة الإلغاء الأصلية (برا القايمة)", (await page.getByRole("dialog").count()) >= 1 && (await page.getByTestId("row-actions-menu").count()) === 0);
        await page.keyboard.press("Escape"); await page.waitForTimeout(150);
      }
      await page.evaluate(() => sessionStorage.removeItem("keepRowMenu"));
    }
    await page.goto(`${BASE}/branch/${B1}/pre-orders`); await settle(page);
    await look("«حجز جديد»", p.newPreorder, page.getByRole("button", { name: "حجز جديد", exact: true }));
    await page.goto(`${BASE}/branch/${B1}/transfers`); await settle(page);
    await look("«طلب نقل جديد»", p.newTransfer, page.getByRole("button", { name: "طلب نقل جديد", exact: true }));
    await page.goto(`${BASE}/branch/${B1}/employees`); await settle(page);
    await look("«إضافة موظف»", p.addEmployee, page.getByRole("button", { name: "إضافة موظف", exact: true }));

    // stock count (0267): open / count / review / approve / cancel follow «جرد المخزن» of the branch; approving = owner
    await countChecks(page, p.label, p.sc);

    const errs = db.calls.filter((c) => c.pageerror);
    check(`${p.label}: مفيش أخطاء في الصفحات`, errs.length === 0, errs.map((e) => e.pageerror).join(" | ").slice(0, 200));
    await ctx.close();
  }
  { // the company owner: approves, cancels an approved count
    const db = makeDb();
    db.pre_orders = []; db.stock_transfers = []; db.employees = [];
    const { page, ctx } = await open(browser, db, OWNER);
    await countChecks(page, "صاحب الشركة", { newCount: true, count: true, review: true, approve: true, cancelOpen: true });
    const v = await vis(page.getByRole("button", { name: /إلغاء الجرد المعتمد/ }));
    check("صاحب الشركة: الجرد — «إلغاء الجرد المعتمد» ظاهر", v, `ظاهر=${v}`);
    const errs = db.calls.filter((c) => c.pageerror);
    check("صاحب الشركة: مفيش أخطاء في صفحة الجرد", errs.length === 0, errs.map((e) => e.pageerror).join(" | ").slice(0, 200));
    await ctx.close();
  }
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
