// «تعديل / إلغاء أصل ثابت» (migration 0284, owner 2026-11-25 «افرض دخلنا اصول غلط وعاوزين نعدلها»): buttons by status,
// totals without cancelled assets, a text-only edit (no reason, nothing in the books), a money edit (warning + reason →
// edit_fixed_asset), cancel (effect in words → cancel_fixed_asset), undo a disposal. Database faked in the browser.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/fixed-assets.ui.cjs
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


const MGR = "9aa41d69-13ef-41d8-a6ca-b6c722c95c62";
const A1 = uuid("aaaaaaaa", 1), A2 = uuid("aaaaaaaa", 2), A3 = uuid("aaaaaaaa", 3), A4 = uuid("aaaaaaaa", 4);
const fa = (o) => ({ tenant_id: T, category: null, salvage_value: 0, useful_life_months: 60, depreciation_method: "straight_line", disposal_date: null, disposal_amount: null,
  asset_account_id: null, accum_depreciation_account_id: null, depreciation_expense_account_id: null, branch_id: B1, funding: "opening", payment_method: null,
  notes: null, cancel_reason: null, replaced_by: null, replaces: null, created_at: "2026-11-01T00:00:00Z", ...o });
function makeDb() {
  return {
    calls: [],
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true }],
    user_roles: [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T }],
    branch_users: [],
    branches: [{ id: B1, name: "مكتب ومخزن شلبى", code: "B1", tenant_id: T, is_active: true, is_system: false, platform_paused: false, low_balance_threshold: 0 }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [], role_permissions: [], user_permissions: [], permission_templates: [], transfer_fees: [], vessel_accounts: [], vessel_access: [],
    fixed_assets: [
      fa({ id: A1, code: "FA-0001", name: "تكييف", category: "أجهزة", acquisition_date: "2026-01-15", cost: 60000, status: "active" }),
      fa({ id: A2, code: "FA-0002", name: "عربية نقل", acquisition_date: "2026-02-01", cost: 300000, status: "disposed", disposal_date: "2026-10-20", disposal_amount: 250000 }),
      fa({ id: A3, code: "FA-0003", name: "رفوف", acquisition_date: "2026-03-01", cost: 9999, status: "cancelled", cancel_reason: "التكلفة غلط", replaced_by: A4, funding: "paid", payment_method: "cash" }),
      fa({ id: A4, code: "FA-0004", name: "رفوف", acquisition_date: "2026-03-01", cost: 10000, status: "active", replaces: A3, funding: "paid", payment_method: "cash" }),
    ],
    depreciation_entries: [{ asset_id: A1, amount: 9000 }, { asset_id: A3, amount: 500 }, { asset_id: A4, amount: 3000 }],
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
      if (name === "edit_fixed_asset") return json({ mode: body.p_cost === 60000 ? "text" : "replace", code: "FA-0005", old_code: "FA-0001" });
      if (name === "cancel_fixed_asset" || name === "undo_fixed_asset_disposal") return json({ ok: true });
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
  const db = makeDb();
  const { page } = await open(browser, db, OWNER);
  await page.goto(`${BASE}/admin/accounting/fixed-assets`); await settle(page);
  const main = page.locator("main");
  const row = (code) => page.locator("tr", { has: page.locator("td", { hasText: new RegExp(`^${code}$`) }) });
  const txt = await main.innerText().catch(() => "");
  check("1. الكروت = النشط بس (60,000 + 10,000 = 70,000) والمجموع تحت من غير الملغي (370,000)", /70,000/.test(txt) && /370,000/.test(txt) && !/379,999/.test(txt));
  check("2. مجمع الإهلاك من غير الملغي (12,000) والقيمة الدفترية 58,000 (المتباع صفر)", /12,000/.test(txt) && /58,000/.test(txt));
  check("3. النشط: تعديل + التخلص + إلغاء", await vis(row("FA-0001").getByRole("button", { name: "تعديل" })) && await vis(row("FA-0001").getByRole("button", { name: "التخلص" })) && await vis(row("FA-0001").getByRole("button", { name: "إلغاء" })));
  check("4. المتباع: إلغاء التخلص + إلغاء، من غير تعديل", await vis(row("FA-0002").getByRole("button", { name: "إلغاء التخلص" })) && !(await vis(row("FA-0002").getByRole("button", { name: "تعديل" }))));
  const r3 = await row("FA-0003").innerText();
  check("5. الملغي: «ملغي» + «بقى FA-0004» + السبب، من غير زراير", /ملغي/.test(r3) && /بقى FA-0004/.test(r3) && /كانت تكلفته 9,999/.test(r3) && /التكلفة غلط/.test(r3) && (await row("FA-0003").getByRole("button").count()) === 0, r3.replace(/\n/g, " "));
  check("6. الجديد مكتوب عليه «بدل FA-0003»", /بدل FA-0003/.test(await row("FA-0004").innerText()));
  await page.screenshot({ path: `${OUT}/fa-1-list.png`, fullPage: true });

  // text-only edit
  await row("FA-0001").getByRole("button", { name: "تعديل" }).click(); await page.waitForTimeout(400);
  let dlg = page.getByRole("dialog");
  check("7. نافذة «تعديل FA-0001» مليانة بالأرقام", /تعديل FA-0001/.test(await dlg.innerText()) && (await dlg.locator('input[type="number"]').first().inputValue()) === "60000");
  await dlg.locator("input").first().fill("تكييف سبليت");
  check("8. تغيير الاسم بس: «مفيش حاجة بتتحرك في الدفاتر» ومفيش سبب", await vis(dlg.getByText("مفيش حاجة بتتحرك في الدفاتر")) && !(await vis(dlg.getByText("سبب التعديل"))));
  await dlg.getByRole("button", { name: "حفظ التعديل" }).click(); await page.waitForTimeout(600);
  let ed = db.calls.filter((c) => c.rpc === "edit_fixed_asset");
  check("9. edit_fixed_asset بالاسم الجديد ونفس التكلفة", ed.length === 1 && ed[0].body.p_name === "تكييف سبليت" && ed[0].body.p_cost === 60000 && ed[0].body.p_asset === A1);

  // money edit
  await row("FA-0001").getByRole("button", { name: "تعديل" }).click(); await page.waitForTimeout(400);
  dlg = page.getByRole("dialog");
  await dlg.locator('input[type="number"]').first().fill("48000");
  check("10. تغيير التكلفة: تحذير «هيتلغي في أيامه» + خانة السبب", await vis(dlg.getByText(/هيتلغي في أيامه/)) && await vis(dlg.getByText("سبب التعديل *")));
  await page.screenshot({ path: `${OUT}/fa-2-edit.png` });
  await dlg.getByRole("button", { name: "حفظ التعديل" }).click(); await page.waitForTimeout(400);
  check("11. من غير سبب مش بيبعت", db.calls.filter((c) => c.rpc === "edit_fixed_asset").length === 1);
  await dlg.getByPlaceholder("مثلاً: التكلفة اتكتبت غلط").fill("التكلفة غلط");
  await dlg.getByRole("button", { name: "حفظ التعديل" }).click(); await page.waitForTimeout(600);
  ed = db.calls.filter((c) => c.rpc === "edit_fixed_asset");
  check("12. edit_fixed_asset بالتكلفة 48000 والسبب", ed.length === 2 && ed[1].body.p_cost === 48000 && ed[1].body.p_reason === "التكلفة غلط");

  // cancel
  await row("FA-0004").getByRole("button", { name: "إلغاء" }).click(); await page.waitForTimeout(400);
  dlg = page.getByRole("dialog");
  const ct = await dlg.innerText();
  check("13. الإلغاء بيقول هيحصل إيه: الفلوس ترجع الخزنة يومها + الإهلاك يتلغي", /هترجع الخزنة يوم 2026-03-01/.test(ct) && /3,000/.test(ct), ct.replace(/\n/g, " ").slice(0, 300));
  await page.screenshot({ path: `${OUT}/fa-3-cancel.png` });
  await dlg.getByPlaceholder("مثلاً: اتسجل بالغلط").fill("اتسجل بالغلط");
  await dlg.getByRole("button", { name: "تأكيد الإلغاء" }).click(); await page.waitForTimeout(600);
  const cc = db.calls.filter((c) => c.rpc === "cancel_fixed_asset");
  check("14. cancel_fixed_asset بالسبب", cc.length === 1 && cc[0].body.p_asset === A4 && cc[0].body.p_reason === "اتسجل بالغلط");

  // undo disposal
  await row("FA-0002").getByRole("button", { name: "إلغاء التخلص" }).click(); await page.waitForTimeout(400);
  dlg = page.getByRole("dialog");
  check("15. إلغاء التخلص: الـ 250,000 تطلع من الخزنة يوم 2026-10-20", /250,000/.test(await dlg.innerText()) && /2026-10-20/.test(await dlg.innerText()));
  await dlg.locator("input").last().fill("اتسجل بالغلط");
  await dlg.getByRole("button", { name: "تأكيد" }).click(); await page.waitForTimeout(600);
  check("16. undo_fixed_asset_disposal اتنادى", db.calls.some((c) => c.rpc === "undo_fixed_asset_disposal" && c.body.p_asset === A2));
  const errs = db.calls.filter((c) => c.pageerror);
  check("17. مفيش أخطاء في الصفحة", errs.length === 0, errs.map((e) => e.pageerror).join(" | ").slice(0, 400));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
