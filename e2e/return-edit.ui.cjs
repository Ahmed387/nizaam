// UI test of «تعديل المرتجع» (owner 2026-10-28, migration 0131): the button on the return view, the edit screen
// pre-filled with the old lines (date + invoice locked), «قبل ← بعد», the required reason, and the ONE call to
// edit_sale_return. The button is for everyone (permission «returns.update», 0132): a cashier sees it; once the owner
// switches it off for him it is gone and the edit link sends him back. Database faked in the browser. Run:
//   npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/return-edit.ui.cjs
const { chromium } = require("playwright");
const OUT = process.env.OUT_DIR || __dirname;
const BASE = "http://127.0.0.1:4173";
const SB = "https://kkfiplnucefytutlwaiz.supabase.co";
const REF = "kkfiplnucefytutlwaiz";
const T = "5316fbfe-b862-4c91-b48b-1d81c8aa5a71";
const OWNER = "85c76e60-3d27-4a99-8cd7-c8f8b39d914a";
const CASHIER = "a3174891-df98-4baa-a806-8c4c94d29eca"; // a cashier of the branch
const B1 = "1329f6cc-0000-0000-0000-000000000001";
const R1 = "e0000001-0000-4000-8000-000000000001";
const INV = "a0000001-0000-4000-8000-000000000001";
const C1 = "c0000001-0000-4000-8000-000000000001";
const KAN = "f0000001-0000-4000-8000-000000000001";
const WASH = "f0000001-0000-4000-8000-000000000002";

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.sig`;

function makeDb() {
  return {
    calls: [],
    profiles: [
      { id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true },
      { id: CASHIER, name: "كاشير", username: "cashier", tenant_id: T, is_active: true },
    ],
    user_roles: [
      { user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T },
      { user_id: CASHIER, role: "cashier", tenant_id: T },
    ],
    branch_users: [{ user_id: CASHIER, branch_id: B1, tenant_id: T, access_level: "manage", full_access: false, branch_role: null, branch_template: null,
      branches: { id: B1, name: "معرض سكة تلة", code: "B1", tenant_id: T, is_active: true, is_system: false, platform_paused: false } }],
    branches: [{ id: B1, name: "معرض سكة تلة", code: "B1", tenant_id: T, is_active: true, is_system: false, platform_paused: false }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [], role_permissions: [], user_permissions: [], permission_templates: [],
    returns: [{
      id: R1, tenant_id: T, branch_id: B1, invoice_id: INV, return_number: "SR00076", status: "active",
      invoice_date: "2026-08-13T09:00:00+00:00", created_at: "2026-10-19T14:12:36+00:00", migration_batch_id: null,
      replaces_return_id: null, reason: "منتج تالف / معيب", notes: null, refund_method: "cash", refund_reference: null,
      refund_account: null, total_refund: 2080, refund_cash_amount: 2080, refund_transfer_amount: 0, refund_balance_amount: 0,
      invoices: { invoice_number: "IN03400", contacts: { name: "عميل تجربة", phone: "01000000001", address: null } },
    }],
    return_items: [
      { id: "i1", return_id: R1, product_id: KAN, quantity: 1, refund: 280, products: { name: "كنكة قهوة هوساكي", sku: "K1", selling_price: 280 } },
      { id: "i2", return_id: R1, product_id: WASH, quantity: 1, refund: 1800, products: { name: "غسالة ملابس أطفال كاسيل", sku: "W1", selling_price: 1800 } },
    ],
    invoices: [{ id: INV, tenant_id: T, branch_id: B1, invoice_number: "IN03400", total: 2080, created_at: "2026-08-10T09:00:00+00:00",
      invoice_date: "2026-08-10T09:00:00+00:00", contact_id: C1, contacts: { id: C1, name: "عميل تجربة", phone: "01000000001" } }],
    invoice_items: [
      { id: "ii1", invoice_id: INV, product_id: KAN, product_name: "كنكة قهوة هوساكي", quantity: 1, selling_price: 280, line_discount: 0, total: 280 },
      { id: "ii2", invoice_id: INV, product_id: WASH, product_name: "غسالة ملابس أطفال كاسيل", quantity: 1, selling_price: 1800, line_discount: 0, total: 1800 },
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar-EG" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => db.calls.push({ pageerror: String(e).slice(0, 300) }));
  page.on("dialog", (d) => d.accept());
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
      if (name === "edit_sale_return") {
        return json({ ok: true, id: "e0000001-0000-4000-8000-000000000002", return_number: "SR00095", old_return_number: "SR00076",
          old_total: 2080, total_refund: 280, cash_refund: 280, transfer_refund: 0, applied_to_debt: 0, refund_method: "cash" });
      }
      return json(null);
    }
    if (path.startsWith("/rest/v1/")) {
      const table = path.split("/").pop(); const method = req.method();
      if (method !== "GET" && method !== "HEAD") { db.calls.push({ table, method }); return json([]); }
      let rows = filt(db[table] ?? [], url);
      const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
      if (single) return rows.length ? json(rows[0]) : route.fulfill({ status: 406, contentType: "application/json", body: JSON.stringify({ code: "PGRST116", message: "0 rows" }) });
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}`, "access-control-allow-origin": "*", "access-control-expose-headers": "Content-Range" }, body: JSON.stringify(rows) });
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

(async () => {
  const browser = await chromium.launch();
  const db = makeDb();
  const { ctx, page } = await open(browser, db, OWNER);

  // 1. the button on the return view
  await page.goto(`${BASE}/branch/${B1}/sale-returns/${R1}`); await settle(page);
  const btn = page.getByRole("button", { name: /تعديل المرتجع/ });
  check("1. زرار «تعديل المرتجع» ظاهر للمالك على SR00076", await vis(btn));
  await shot(page, "return-edit-1-view");

  // 2. edit screen, pre-filled
  await btn.first().click(); await settle(page); await page.waitForTimeout(800);
  check("2. اتفتحت شاشة التعديل", page.url().includes(`edit=${R1}`) && await vis(page.getByText(/تعديل مرتجع بيع SR00076/)), page.url());
  const qty = page.locator('input[type="number"]');
  const q0 = await qty.nth(0).inputValue().catch(() => "?"), q1 = await qty.nth(1).inputValue().catch(() => "?");
  check("3. الكميات القديمة متملية (كنكة 1 + غسالة 1)", q0 === "1" && q1 === "1", `${q0} / ${q1}`);
  check("4. التاريخ مقفول على تاريخ القديم والفاتورة مقفولة", await vis(page.getByText(/نفس تاريخ المرتجع القديم/)) && await vis(page.getByText("IN03400")) && !(await vis(page.getByRole("button", { name: /تغيير الفاتورة/ }))));

  // 3. remove the washer → «قبل ← بعد»
  await qty.nth(1).fill("0"); await page.waitForTimeout(400);
  check("5. «قبل ← بعد» بيبيّن الغسالة 1 ← 0 والقيمة 2,080 ← 280", await vis(page.getByText(/1 ← 0/)) && await vis(page.getByText(/2,080.*←.*280|٢٬?٠٨٠.*←.*٢٨٠/)));
  await shot(page, "return-edit-2-form");

  // 4. reason required
  const save = page.getByRole("button", { name: /حفظ التعديل/ });
  await save.first().click(); await page.waitForTimeout(700);
  check("6. من غير سبب التعديل: رفض ومفيش طلب للسيرفر", !db.calls.some((c) => c.rpc === "edit_sale_return") && await vis(page.getByText(/اكتب سبب التعديل/)));

  // 5. save → ONE edit_sale_return call with the new lines
  await page.getByPlaceholder(/العميل رجّع الكنكة بس/).fill("الغسالة اتسجلت بالغلط");
  await save.first().click(); await settle(page);
  const calls = db.calls.filter((c) => c.rpc === "edit_sale_return");
  const b = calls[0]?.body ?? {};
  check("7. اتبعت edit_sale_return مرة واحدة بالسطور الجديدة", calls.length === 1 && b._return_id === R1 && b._edit_reason === "الغسالة اتسجلت بالغلط"
    && Array.isArray(b._items) && b._items.length === 1 && b._items[0].product_id === KAN && b._items[0].quantity === 1 && Number(b._items[0].refund) === 280
    && b._refund_method === "cash", JSON.stringify(b).slice(0, 300));
  check("8. مفيش register_sale_return_full ولا تغيير تاريخ من المتصفح", !db.calls.some((c) => c.rpc === "register_sale_return_full" || c.rpc === "update_return_sovereign"));
  check("9. رسالة النجاح فيها القديم والجديد", await vis(page.getByText(/SR00076 ← SR00095/)));
  await shot(page, "return-edit-3-saved");
  await ctx.close();

  // 6. a cashier: the button is there by default (للكل) and opens the edit screen
  const db2 = makeDb();
  const c2 = await open(browser, db2, CASHIER);
  await c2.page.goto(`${BASE}/branch/${B1}/sale-returns/${R1}`); await settle(c2.page);
  check("10. الكاشير شايف «تعديل المرتجع» (مفتوح للكل)", await vis(c2.page.getByRole("button", { name: /تعديل المرتجع/ })));
  await c2.page.goto(`${BASE}/branch/${B1}/sale-returns/new?edit=${R1}`); await settle(c2.page); await c2.page.waitForTimeout(800);
  check("11. الكاشير بيفتح شاشة التعديل", c2.page.url().includes(`edit=${R1}`) && await vis(c2.page.getByText(/تعديل مرتجع بيع SR00076/)), c2.page.url());
  await c2.ctx.close();

  // 7. the owner switched «returns.update» off for him: no button, the link sends him back
  const db3 = makeDb();
  db3.user_permissions = [{ user_id: CASHIER, tenant_id: T, permission_key: "returns.update", allowed: false, branch_id: null }];
  const c3 = await open(browser, db3, CASHIER);
  await c3.page.goto(`${BASE}/branch/${B1}/sale-returns/${R1}`); await settle(c3.page);
  check("12. بعد ما المالك قفل الصلاحية: الزرار اختفى", !(await vis(c3.page.getByRole("button", { name: /تعديل المرتجع/ }))) && await vis(c3.page.getByText("SR00076")));
  await c3.page.goto(`${BASE}/branch/${B1}/sale-returns/new?edit=${R1}`); await settle(c3.page); await c3.page.waitForTimeout(800);
  check("13. ولو فتح رابط التعديل بيرجع لصفحة المرتجع", c3.page.url().endsWith(`/sale-returns/${R1}`) && !db3.calls.some((c) => c.rpc === "edit_sale_return"), c3.page.url());
  await c3.ctx.close();

  const errs = [...db.calls, ...db2.calls, ...db3.calls].filter((c) => c.pageerror);
  check("14. مفيش أخطاء في الصفحة", errs.length === 0, errs.map((e) => e.pageerror).join(" | "));
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
