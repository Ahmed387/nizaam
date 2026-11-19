// «ابعت واتساب» with no mobile (owner 2026-11-19 «يظهر Alert بالمشكلة و ينقله بخفة ولذاذه لصفحة المورد او العميل … ويبعت»):
// sale invoice → alert → «سجّل رقمه في ملفه» → the customer's page with the edit open and the phone field focused → a landline
// is refused → a mobile is saved → back to the invoice with the button pointed out → WhatsApp opens on that number.
// The purchase invoice has «ابعت للمورد واتساب» with the same alert. Everything is mocked: nothing reaches the database.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: CHROME=<headless shell> node e2e/whatsapp-fix.ui.cjs
const { chromium } = require("playwright");
const OUT = process.env.OUT_DIR || __dirname;
const BASE = "http://127.0.0.1:4173";
const SB = "https://kkfiplnucefytutlwaiz.supabase.co";
const REF = "kkfiplnucefytutlwaiz";
const T = "5316fbfe-b862-4c91-b48b-1d81c8aa5a71";
const OWNER = "85c76e60-3d27-4a99-8cd7-c8f8b39d914a";
const B1 = "7a9f9e1b-0000-4000-8000-000000000001";

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.sig`;

function makeDb() {
  const db = {
    calls: [], phone: null, supPhone: null,
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true }],
    user_roles: [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T }],
    branch_users: [],
    branches: [{ id: B1, name: "معرض عبدالمنعم", code: "FR-004", tenant_id: T, is_active: true, is_system: false, platform_paused: false, low_balance_threshold: 0 }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [], role_permissions: [], user_permissions: [], permission_templates: [], notifications: [],
    invoice_items: [{ id: "ii1", invoice_id: "i1", product_id: "p1", product_name: "غسالة ال جي 20 كيلو", quantity: 1, total: 12000, unit_price: 12000 }],
    invoice_payments: [], payment_plans: [], payment_installments: [], products: [{ id: "p1", sku: "1991", pack_size: 1, pack_name: null }],
    shipment_items: [{ id: "si1", shipment_id: "s1", product_id: "p1", product_name: "سخان", quantity: 2, cost_price: 2000, total: 4000, products: { name: "سخان" } }],
  };
  db.invoice = () => ({ id: "i1", invoice_number: "IN00015", branch_id: B1, contact_id: "c1", status: "active", total: 12000, subtotal: 12000,
    vat_amount: 0, discount_amount: 0, invoice_date: "2026-11-19T10:00:00Z", created_at: "2026-11-19T10:00:00Z", tenant_id: T,
    contacts: { name: "أحمد هديه", phone: db.phone, address: null } });
  db.shipment = () => ({ id: "s1", shipment_number: "PO25011", branch_id: B1, contact_id: "c2", status: "active", total_cost: 4000, shipping_cost: 0,
    customs_cost: 0, other_cost: 0, admin_cost: 0, arrival_date: "2026-11-19", created_at: "2026-11-19T10:00:00Z", tenant_id: T,
    contacts: { name: "كيرلس رسيفرات", phone: db.supPhone, address: null } });
  return db;
}

function filt(rows, url) {
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(k) || k.includes(".")) continue;
    const m = /^(eq|neq|is|in)\.(.*)$/.exec(v);
    if (!m) continue;
    const [, op, raw] = m;
    rows = rows.filter((r) => {
      const x = r[k];
      if (op === "eq") return x === undefined || String(x) === raw;
      if (op === "neq") return String(x) !== raw;
      if (op === "is") return raw === "null" ? x === null || x === undefined : String(x) === raw;
      return raw.replace(/[()"]/g, "").split(",").includes(String(x));
    });
  }
  return rows;
}

async function open(browser, db) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar-EG" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => db.calls.push({ pageerror: String(e).slice(0, 300) }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(`${SB}/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    const json = (d, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
    if (path.startsWith("/auth/v1/user")) return json({ id: OWNER, aud: "authenticated", app_metadata: {}, user_metadata: {} });
    if (path.startsWith("/auth/v1/")) return json({});
    if (path.startsWith("/functions/v1/")) return json({ ok: true });
    // 0278: the invoice PDF goes to the private bucket «shared-docs», the message carries a signed link
    if (path.startsWith("/storage/v1/object/sign/shared-docs/")) {
      const key = path.replace("/storage/v1/object/sign/", "");
      db.calls.push({ sign: key, body: req.postDataJSON() });
      return json({ signedURL: `/object/sign/${key}?token=t0k` });
    }
    if (path.startsWith("/storage/v1/object/shared-docs/")) {
      const buf = req.postDataBuffer() || Buffer.alloc(0);
      if (process.env.PDF_OUT) require("fs").writeFileSync(`${process.env.PDF_OUT}/${path.split("/").pop()}`, buf);
      db.calls.push({ upload: path, size: buf.length, pdf: buf.includes(Buffer.from("%PDF")), upsert: req.headers()["x-upsert"] });
      return json({ Key: path.replace("/storage/v1/object/", "") });
    }
    if (path.startsWith("/rest/v1/rpc/")) {
      const name = path.split("/").pop(); let body = {}; try { body = req.postDataJSON() || {}; } catch {}
      db.calls.push({ rpc: name, body });
      if (name === "save_contact") { if (body.p_id === "c1") db.phone = body.p_data.phone; else db.supPhone = body.p_data.phone; return json({ id: body.p_id }); }
      if (name === "ledger_contact_overview") {
        const sup = body.p_contact === "c2";
        return json({ contact: { id: body.p_contact, name: sup ? "كيرلس رسيفرات" : "أحمد هديه", type: sup ? "supplier" : "customer", phone: sup ? db.supPhone : db.phone,
          branch_id: B1, contact_person: null, address: null, notes: null, branches: [{ id: B1, name: "معرض عبدالمنعم" }] },
          customer: sup ? null : { balance: 0, documents: 0 }, supplier: sup ? { balance: 0, documents: 0 } : null });
      }
      if (/movements|statement|documents|lines|list|page|status|balances/.test(name)) return json([]);
      return json(null);
    }
    if (path.startsWith("/rest/v1/")) {
      const table = path.split("/").pop(); const method = req.method();
      if (method !== "GET" && method !== "HEAD") return json([]);
      const base = table === "invoices" ? [db.invoice()] : table === "shipments" ? [db.shipment()] : (db[table] ?? []);
      const rows = filt(base, url);
      const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
      if (single) return rows.length ? json(rows[0]) : route.fulfill({ status: 406, contentType: "application/json", body: JSON.stringify({ code: "PGRST116", message: "0 rows" }) });
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }, body: JSON.stringify(rows) });
    }
    return json({});
  });
  const sess = { access_token: jwt(OWNER), refresh_token: "r", token_type: "bearer", expires_in: 31536000, expires_at: 4102444800, user: { id: OWNER, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } };
  await page.addInitScript(([k, v]) => {
    localStorage.setItem(k, v);
    window.__opened = [];
    window.open = (u) => { window.__opened.push(String(u)); return null; };
  }, [`sb-${REF}-auth-token`, JSON.stringify(sess)]);
  return { ctx, page };
}

const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
const settle = async (page) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(900); };
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const db = makeDb();
  const { page } = await open(browser, db);

  // 1) sale invoice, customer with no number
  await page.goto(`${BASE}/branch/${B1}/sales/i1`); await settle(page);
  const waBtn = page.getByRole("button", { name: /ابعت للعميل واتساب/ });
  check("sale invoice shows «ابعت للعميل واتساب»", (await waBtn.count()) === 1);
  await waBtn.click(); await page.waitForTimeout(400);
  const alertText = (await page.getByTestId("wa-problem").innerText().catch(() => ""));
  check("no number → an alert explains it", alertText.includes("مفيش رقم موبايل متسجل") && alertText.includes("سجّل رقمه في ملفه"), alertText.slice(0, 80));
  check("WhatsApp did not open yet", (await page.evaluate(() => window.__opened.length)) === 0);
  await shot(page, "wa-1-alert");

  // 2) to the customer's page, edit open, phone focused
  await page.getByRole("button", { name: /سجّل رقمه في ملفه/ }).click(); await settle(page);
  check("moved to the customer's page with fix=phone", page.url().includes(`/branch/${B1}/contacts/c1?fix=phone`), page.url());
  check("the edit dialog opened with the WhatsApp note", await page.getByTestId("wa-fix-note").isVisible().catch(() => false));
  check("the phone field has the cursor", (await page.evaluate(() => document.activeElement && document.activeElement.id)) === "contact-phone");
  await shot(page, "wa-2-contact-edit");

  // 3) a landline is refused, a mobile is saved and he goes back
  await page.fill("#contact-phone", "0862345678");
  check("a landline shows «ده مش رقم موبايل»", (await page.locator("body").innerText()).includes("ده مش رقم موبايل"));
  await page.getByRole("button", { name: /^حفظ$/ }).click(); await page.waitForTimeout(500);
  check("landline not saved", !db.calls.some((c) => c.rpc === "save_contact"));
  await page.fill("#contact-phone", "01001234567");
  await page.getByRole("button", { name: /^حفظ$/ }).click(); await settle(page);
  check("mobile saved through save_contact", db.calls.some((c) => c.rpc === "save_contact" && c.body.p_data.phone === "01001234567"));
  check("back on the invoice", page.url().endsWith(`/branch/${B1}/sales/i1`), page.url());
  const ready = await page.getByRole("button", { name: /ابعت للعميل واتساب/ }).getAttribute("data-ready");
  check("the WhatsApp button is pointed out", ready === "1");
  await shot(page, "wa-3-back-ready");

  // 4) one click opens WhatsApp on that number with the invoice text
  await page.getByRole("button", { name: /ابعت للعميل واتساب/ }).click();
  await page.waitForFunction(() => window.__opened.some((u) => u.startsWith("https://wa.me/")), null, { timeout: 30000 }).catch(() => {});
  const opened = (await page.evaluate(() => window.__opened)).filter((u) => u);
  check("WhatsApp opens on 201001234567 with the invoice", opened.length === 1 && opened[0].startsWith("https://wa.me/201001234567?text=") && decodeURIComponent(opened[0]).includes("IN00015"), opened[0]);
  const up = db.calls.find((c) => c.upload);
  check("the invoice went up as a real PDF, one file per invoice", !!up && up.pdf && up.size > 5000 && /shared-docs\/[^/]+\/sale-i1\.pdf$/.test(up.upload), JSON.stringify(up ?? {}));
  check("the message carries the 7-day PDF link", decodeURIComponent(opened[0] ?? "").includes("sale-i1.pdf?token=t0k") && decodeURIComponent(opened[0] ?? "").includes("7 أيام")
    && db.calls.some((c) => c.sign && c.body.expiresIn === 604800));

  // 5) purchase invoice: supplier wording, same alert
  await page.goto(`${BASE}/branch/${B1}/shipments/s1`); await settle(page);
  const sBtn = page.getByRole("button", { name: /ابعت للمورد واتساب/ });
  check("purchase invoice shows «ابعت للمورد واتساب»", (await sBtn.count()) === 1);
  await sBtn.click(); await page.waitForTimeout(400);
  const sAlert = await page.getByTestId("wa-problem").innerText().catch(() => "");
  check("supplier alert talks about المورد", sAlert.includes("المورد") && sAlert.includes("مفيش رقم موبايل"));
  await shot(page, "wa-4-supplier-alert");
  await page.getByRole("button", { name: /سجّل رقمه في ملفه/ }).click(); await settle(page);
  check("moved to the supplier's page", page.url().includes(`/branch/${B1}/contacts/c2?fix=phone`), page.url());
  await page.fill("#contact-phone", "01112223334");
  await page.getByRole("button", { name: /^حفظ$/ }).click(); await settle(page);
  check("back on the purchase invoice, button ready", page.url().endsWith(`/branch/${B1}/shipments/s1`) && (await page.getByRole("button", { name: /ابعت للمورد واتساب/ }).getAttribute("data-ready")) === "1", page.url());
  await page.getByRole("button", { name: /ابعت للمورد واتساب/ }).click(); await page.waitForTimeout(300);
  await page.waitForFunction(() => window.__opened.some((u) => u.startsWith("https://wa.me/")), null, { timeout: 30000 }).catch(() => {});
  const op2 = (await page.evaluate(() => window.__opened)).filter((u) => u);
  check("WhatsApp opens on the supplier with the purchase invoice", op2.length === 1 && op2[0].startsWith("https://wa.me/201112223334?text=") && decodeURIComponent(op2[0]).includes("PO25011"), op2[0]);

  check("no page errors", !db.calls.some((c) => c.pageerror), db.calls.filter((c) => c.pageerror).map((c) => c.pageerror).join(" | "));
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
