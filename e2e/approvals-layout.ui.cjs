// «ظبّط رأس مال الشركاء» (migration 0275, owner «نفذ» 2026-11-19): the owner opens the 4-step wizard from the partners tab,
// sees the books' first day and the net worth, types each partner's capital (above the net worth is refused), adds a cash
// contribution, reviews before → after (preview call, nothing saved) and saves with ONE call. Database faked in the browser.
// Run: npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/partner-capital.ui.cjs
const { chromium } = require("playwright");
const OUT = process.env.OUT_DIR || __dirname;
const BASE = "http://127.0.0.1:4173";
const SB = "https://kkfiplnucefytutlwaiz.supabase.co";
const REF = "kkfiplnucefytutlwaiz";
const T = "5316fbfe-b862-4c91-b48b-1d81c8aa5a71";
const OWNER = "85c76e60-3d27-4a99-8cd7-c8f8b39d914a";
const B1 = "7a9f9e1b-d6ae-47c0-9965-bf23d0d31213";
const P1 = "b0000001-0000-4000-8000-000000000001";
const E1 = "e0000001-0000-4000-8000-000000000009";

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.sig`;


// «طلبات الموافقة» (owner screenshot 25/11: «موافقة» / «رفض» on top of each other, «النوع» twice).
// Checks: one «الطلب» column, the two buttons side by side with their words readable, each opens its dialog, nothing saved
// until the dialog's own button. Database faked in the browser. Run: build + vite preview :4173, then node e2e/approvals-layout.ui.cjs
const REQS = [
  ["PV-7651", "update", "voucher", "خطا في الملف بتجريب الكي بورد", ["المبلغ: 1000 ← 10000"]],
  ["RV-6445", "update", "voucher", "خطا في كتابة المبلغ", ["المبلغ: 119700 ← 1700", "البيان: فاتورة رشدي خشبة ← فاتورة رشدي خشبة خطا في المبلغ"]],
  ["IN47905", "delete", "invoice", "فاتورة مكررة", []],
].map(([label, action, entity_type, reason, diff], i) => ({ id: `r${i}`, tenant_id: T, entity_type, entity_id: `e${i}`, entity_label: `سند ${label}`,
  action, payload: { diff }, reason, status: "pending", requested_by_name: "ا/محمد طه", admin_note: null, created_at: `2026-11-2${5 - i}T15:4${i}:00Z`, decided_at: null }));
function makeDb() {
  return { calls: [],
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true }],
    user_roles: [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T }],
    branch_users: [], role_permissions: [], user_permissions: [], permission_templates: [], transfer_fees: [],
    branches: [{ id: B1, name: "معرض عبدالمنعم", code: "FR-004", tenant_id: T, is_active: true, is_system: false, platform_paused: false }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    approval_requests: REQS };
}
function filt(rows, url) {
  for (const [k, v] of url.searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict", "or"].includes(k) || k.includes(".")) continue;
    const m = /^(eq|neq|is|in)\.(.*)$/.exec(v); if (!m) continue;
    const [, op, raw] = m;
    rows = rows.filter((r) => {
      const x = r[k];
      if (op === "eq") return x === undefined || String(x) === raw;
      if (op === "neq") return String(x) !== raw;
      if (op === "is") return raw === "null" ? x == null : String(x) === raw;
      return raw.replace(/[()"]/g, "").split(",").includes(String(x));
    });
  }
  return rows;
}

async function open(browser, db, me) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ar-EG" });
  // these checks click a row's own buttons: keep them in the row (the «⋮» menu itself is tested in column-resize / roles-buttons)
  await ctx.addInitScript(() => { const on = () => document.documentElement?.setAttribute("data-no-row-menu", ""); on(); document.addEventListener("readystatechange", on); });
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
      db.calls.push({ rpc: name, body });
      if (name === "ledger_position") return json({ customers: {}, suppliers: {}, cross_branch: {} });   // the page's other cards
      return json(null);
    }
    if (path.startsWith("/rest/v1/")) {
      const table = path.split("/").pop(); const method = req.method();
      if (method !== "GET" && method !== "HEAD") { db.calls.push({ table, method }); return json([]); }
      const rows = filt(db[table] ?? [], url);
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
const settle = async (page) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(900); };

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  for (const [w, tag] of [[1887, "owner-screen"], [1440, "desktop"], [1280, "laptop"]]) {
    const db = makeDb();
    const { page, ctx } = await open(browser, db, OWNER);
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`${BASE}/admin/approvals-hub?tab=approvals`); await settle(page);
    const heads = await page.locator("thead th").allInnerTexts();
    check(`${tag}: عمود «النوع» مش متكرر وفيه «الطلب»`, heads.filter((h) => h.includes("النوع")).length === 0 && heads.some((h) => h.includes("الطلب")), heads.join(" | "));
    const ok = page.getByRole("button", { name: /موافقة/ }), no = page.getByRole("button", { name: /رفض/ });
    check(`${tag}: زرار موافقة ورفض في كل صف (3)`, (await ok.count()) === 3 && (await no.count()) === 3);
    let overlap = false, cut = false;
    for (let i = 0; i < 3; i++) {
      const a = await ok.nth(i).boundingBox(), b = await no.nth(i).boundingBox();
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) overlap = true;
      const sc = await ok.nth(i).evaluate((el) => el.scrollWidth > el.clientWidth + 1) || await no.nth(i).evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      if (sc) cut = true;
    }
    check(`${tag}: الزرارين مش فوق بعض`, !overlap);
    check(`${tag}: الكلام جوه الزرار مش مقصوص`, !cut);
    const hscroll = await page.evaluate(() => { const t = document.querySelector("table"); const p = t?.parentElement; return p ? p.scrollWidth > p.clientWidth + 2 : false; });
    check(`${tag}: الجدول من غير اسكرول جانبي`, !hscroll);
    await page.screenshot({ path: `${OUT}/approvals-${tag}.png`, fullPage: true });
    await ok.first().click(); await page.waitForTimeout(500);
    check(`${tag}: «موافقة» بتفتح «تأكيد الموافقة»`, await page.getByRole("dialog").getByText("تأكيد الموافقة").isVisible().catch(() => false));
    check(`${tag}: مفيش حفظ قبل التأكيد`, !db.calls.some((c) => c.table === "approval_requests"));
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    await no.nth(1).click(); await page.waitForTimeout(500);
    check(`${tag}: «رفض» بتفتح «تأكيد الرفض»`, await page.getByRole("dialog").getByText("تأكيد الرفض").isVisible().catch(() => false));
    await page.getByRole("dialog").getByRole("button", { name: /^رفض$/ }).click(); await page.waitForTimeout(600);
    check(`${tag}: تأكيد الرفض = طلب واحد للسيرفر`, db.calls.filter((c) => c.table === "approval_requests" && c.method === "PATCH").length === 1, JSON.stringify(db.calls.filter((c) => c.table)));
    const errs = db.calls.filter((c) => c.pageerror);
    check(`${tag}: مفيش أخطاء في الصفحة`, errs.length === 0, errs.map((e) => e.pageerror).join(" | "));
    await ctx.close();
  }
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
