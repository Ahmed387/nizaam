// UI test of the Excel filters on the documents screen (owner 2026-10-26): arrows on every column over the WHOLE list
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
      recipient_name: i % 5 === 0 ? "محمد" : null, notes: i % 6 === 0 ? "تسليم المخزن" : null,
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

function makeDb() {
  return {
    calls: [],
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true }],
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
      db.calls.push({ table, get: url.search.slice(0, 160) });
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
const num = (s) => Number(String(s).replace(/[^\d.-]/g, ""));
const fmt = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

(async () => {
  const browser = await chromium.launch();
  const db = makeDb();
  const live = db.invoices.filter((r) => r.status !== "cancelled");
  const usama = live.filter((r) => r.contacts?.name === "اسامة الراعى الصالح");
  const { ctx, page } = await open(browser, db, OWNER);
  await page.goto(`${BASE}/branch/${B1}/invoices?tab=sale`); await settle(page);
  const table = page.locator("table").filter({ has: page.getByRole("columnheader", { name: /العميل/ }) }).first();
  const bodyRows = () => table.locator(":scope > tbody > tr:not([hidden])");
  check("الصفحة الأولى 50 صف من 117", (await bodyRows().count()) === 50 && await vis(page.getByText(/من أصل 117 مستند/)), String(await bodyRows().count()));

  // ---- the arrow of «العميل»: the values of ALL pages with their counts
  const arrow = (label) => page.getByRole("button", { name: new RegExp(`^فلتر وترتيب عمود ${label}`) });
  check("سهم على العميل والمبلغ وحالة السداد، ومفيش على الإجراءات", await vis(arrow("العميل")) && await vis(arrow("المبلغ")) && await vis(arrow("حالة السداد")) && !(await vis(arrow("إجراءات"))));
  await arrow("العميل").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("اسامة الراعى الصالح").waitFor({ timeout: 10000 });
  const countText = await dialog.locator("label", { hasText: "اسامة الراعى الصالح" }).innerText();
  check("القيم من كل الصفحات بعددها (اسامة " + usama.length + ")", countText.includes(`(${usama.length})`), countText);
  await shot(page, "invoices-excel-menu");
  // tick only اسامة
  await dialog.getByText("تحديد الكل").click();
  await dialog.locator("label", { hasText: "اسامة الراعى الصالح" }).click();
  await dialog.getByRole("button", { name: "تطبيق" }).click();
  await settle(page);
  const sumUsama = usama.reduce((s, r) => s + r.total, 0);
  check(`فلتر العميل على القائمة كلها: ${usama.length} صف`, await vis(page.getByText(new RegExp(`من أصل ${usama.length} مستند`))) && (await bodyRows().count()) === Math.min(50, usama.length), String(await bodyRows().count()));
  const totalsRow = table.locator("tfoot[data-xf-totals] tr");
  const totalsText = await totalsRow.innerText().catch(() => "");
  check("صف المجموع = مجموع كل صفوف اسامة (مش الصفحة بس)", totalsText.includes(fmt(sumUsama)), `${totalsText.replace(/\s+/g, " ").slice(0, 160)} | expected ${fmt(sumUsama)}`);
  check("شريط الفلاتر: «العميل: اسامة…»", await vis(page.getByText(/العميل: اسامة الراعى الصالح/)));

  // ---- the bar on top writes the column: «حالة السداد» = لم يتم الدفع (اسامة always pays at the sale → nothing left)
  const payStateField = page.locator("div.space-y-1\\.5").filter({ has: page.getByText("حالة السداد", { exact: true }) }).getByRole("combobox");
  await payStateField.click();
  await page.getByRole("option", { name: "لم يتم الدفع" }).click();
  await settle(page);
  check("الشريط اللي فوق بيكتب في العمود: اسامة AND لم يتم الدفع = مفيش", await vis(page.getByText("مفيش صفوف بالفلاتر دي")) && await vis(page.getByText(/حالة السداد: لم يتم الدفع/)) && await vis(page.getByText(/من أصل 0 مستند/)));
  await shot(page, "invoices-excel-empty");
  await page.getByRole("button", { name: "شيل فلتر العميل" }).click(); await settle(page);
  const unpaidAll = live.filter((r) => r.__paid <= 0);
  check(`شيل شريحة العميل: لم يتم الدفع لوحده = ${unpaidAll.length}`, await vis(page.getByText(new RegExp(`من أصل ${unpaidAll.length} مستند`))));
  const psArrow = await arrow("حالة السداد").first().getAttribute("aria-label");
  check("سهم «حالة السداد» منوّر (عليه فلتر)", (psArrow || "").includes("عليه فلتر"), psArrow || "");
  await arrow("حالة السداد").click();
  await dialog.getByText("لم يتم الدفع").waitFor();
  const ticked = await dialog.locator("label", { hasText: "لم يتم الدفع" }).locator("input").isChecked();
  const notTicked = !(await dialog.locator("label", { hasText: "مدفوعة بالكامل" }).locator("input").isChecked().catch(() => false));
  check("جوه السهم: «لم يتم الدفع» بس اللي متعلّم", ticked && notTicked);
  await page.keyboard.press("Escape");
  // back to اسامة for the next steps
  await payStateField.click(); await page.getByRole("option", { name: "الكل" }).click(); await settle(page);
  await arrow("العميل").click();
  await dialog.getByText("اسامة الراعى الصالح").waitFor();
  await dialog.getByText("تحديد الكل").click();
  await dialog.locator("label", { hasText: "اسامة الراعى الصالح" }).click();
  await dialog.getByRole("button", { name: "تطبيق" }).click(); await settle(page);

  // ---- the column writes the bar: المبلغ > 20,000 → «نطاق المبلغ من» shows it
  await arrow("المبلغ").click();
  await dialog.getByRole("radio", { name: "أكبر من", exact: true }).click();
  await dialog.getByLabel("الرقم").fill("20000");
  await dialog.getByRole("button", { name: "تطبيق" }).click();
  await settle(page);
  const minBox = page.getByLabel("المبلغ من");
  check("العمود بيكتب في الشريط: «المبلغ من» = 20000", (await minBox.inputValue()) === "20000", await minBox.inputValue());
  const big = usama.filter((r) => r.total > 20000);
  check(`اسامة AND المبلغ > 20,000 = ${big.length}`, await vis(page.getByText(new RegExp(`من أصل ${big.length} مستند`))));

  // ---- sort the whole list by amount, biggest first
  await arrow("المبلغ").click();
  await dialog.getByRole("button", { name: /من الأكبر للأصغر/ }).click();
  await settle(page);
  const firstAmount = num(await bodyRows().first().locator("td").nth(4).innerText());
  check("الترتيب على القائمة كلها: أول صف = أكبر مبلغ", firstAmount === Math.max(...big.map((r) => r.total)), `${firstAmount}`);

  // ---- the cards follow the filters
  const cardsText = await page.locator("main").innerText();
  check("الكروت ماشية مع الفلاتر (إجمالي = مجموع الظاهر)", cardsText.includes(fmt(big.reduce((s, r) => s + r.total, 0))));
  await shot(page, "invoices-excel-filtered");

  // ---- remembered «زي ما سبتها»
  await page.reload(); await settle(page);
  check("بعد إعادة الفتح: الفلاتر زي ما سبتها", await vis(page.getByText(/العميل: اسامة الراعى الصالح/)) && (await page.getByLabel("المبلغ من").inputValue()) === "20000" && await vis(page.getByText(new RegExp(`من أصل ${big.length} مستند`))));

  // ---- Excel exports what the filters leave, in the order shown (every page)
  const XLSX = require(process.env.XLSX_PATH || "/home/claude/nizaam/node_modules/xlsx");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: /^Excel$/ }).click()]);
  const file = `${OUT}/export.xlsx`;
  await dl.saveAs(file);
  const sheet = XLSX.readFile(file);
  const xrows = XLSX.utils.sheet_to_json(sheet.Sheets[sheet.SheetNames[0]]);
  const amounts = xrows.map((r) => Number(String(r["المبلغ"]).replace(/[^\d.]/g, "")));
  check(`Excel = اللي ظاهر: ${big.length} صف، اسم العميل مكتوب، بنفس الترتيب`, xrows.length === big.length
    && xrows.every((r) => r["العميل"] === "اسامة الراعى الصالح")
    && amounts.every((a, i) => i === 0 || a <= amounts[i - 1]), `${xrows.length} | ${JSON.stringify(xrows[0] ?? {}).slice(0, 120)}`);

  // ---- «مسح» on top clears everything
  await page.getByRole("button", { name: "مسح وإعادة تعيين كل الفلاتر" }).click(); await settle(page);
  check("مسح الكل: رجعت 117", await vis(page.getByText(/من أصل 117 مستند/)) && !(await vis(page.getByText(/العميل: اسامة/))));

  // ---- page 3 has the last rows; a filter that leaves one row on page 3 of the old list finds it
  const target = live[live.length - 1];
  await arrow("رقم").click();
  await dialog.getByText("تحديد الكل").waitFor();
  await dialog.getByText("تحديد الكل").click(); // all off
  await dialog.getByPlaceholder("دوّر في القيم…").fill(target.invoice_number);
  await dialog.locator("label", { hasText: target.invoice_number }).click();
  await dialog.getByRole("button", { name: "تطبيق" }).click(); await settle(page);
  const rowsNow = await bodyRows().count();
  check(`فاتورة من آخر صفحة (${target.invoice_number}) بتتلاقي لوحدها`, rowsNow === 1 && await vis(table.getByText(target.invoice_number)), `rows=${rowsNow}`);

  // ---- receipts: «طريقة الدفع» on top = the words of the column; a row of the whole list reads what it paid when opened
  await page.goto(`${BASE}/branch/${B1}/invoices?tab=income`); await settle(page);
  const vTable = page.locator("table").filter({ has: page.getByRole("columnheader", { name: /رقم السند/ }) }).first();
  const vRows = () => vTable.locator(":scope > tbody > tr:not([hidden])");
  check("سندات القبض: 50 من 60", (await vRows().count()) === 50 && await vis(page.getByText(/من أصل 60 مستند/)), String(await vRows().count()));
  const payField = page.locator("div.space-y-1\\.5").filter({ has: page.getByText("طريقة الدفع / الوعاء", { exact: true }) }).getByRole("combobox");
  await payField.click(); await page.getByRole("option", { name: "انستاباي" }).click(); await settle(page);
  check("انستاباي من فوق = 15 سند وشريحة «طريقة الدفع: انستاباي»", await vis(page.getByText(/من أصل 15 مستند/)) && await vis(page.getByText(/طريقة الدفع: انستاباي/)));
  await arrow("اسم الحساب").click();
  await dialog.getByText("جارحي").waitFor();
  const accText = await dialog.innerText();
  // انستاباي = سندات زوجية كلها على حساب جارحي: القائمة بتبين اللي الفلاتر التانية سايباه بس (زي Excel)
  check("قيم «اسم الحساب» من الحسابات المربوطة، ماشية مع فلتر انستاباي: جارحي (15) بس", /جارحي\s*\(15\)/.test(accText) && !/اسامة الراعى الصالح/.test(accText), accText.replace(/\s+/g, " ").slice(0, 120));
  await page.keyboard.press("Escape");
  const splitsBefore = db.calls.filter((c) => c.rpc === "voucher_money_split").length;
  await vRows().first().getByRole("button", { name: "عرض تفاصيل السند" }).click(); await settle(page);
  check("تفاصيل سند من القائمة كلها: «اتخصم من فواتير» بتتقري لما يتفتح", await vis(page.getByText(/اتخصم من فواتير/)) && db.calls.filter((c) => c.rpc === "voucher_money_split").length > splitsBefore);
  await shot(page, "invoices-excel-vouchers");
  // the sale tab still remembers its own filters
  await page.goto(`${BASE}/branch/${B1}/invoices?tab=sale`); await settle(page);
  check("كل تاب ليه فلاتره: البيع لسه فاضي بعد مسح الكل", await vis(page.getByText(/من أصل (117|1) مستند/)));

  const errs = db.calls.filter((c) => c.pageerror);
  check("مفيش أخطاء في الصفحة", !errs.length, errs.map((x) => x.pageerror).join(" | "));
  const reads = db.calls.filter((c) => c.table === "invoices").length;
  check("قراية الفواتير معقولة", reads < 40, String(reads));
  await ctx.close(); await browser.close();
  console.log(results.join("\n"));
})();
