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

const partner = { id: P1, name: "شريك تجربة", role_kind: "partner", employee_id: null, capital_share: 1, operating_share: 0, is_active: true,
  salary_mode: "none", salary_amount: 0, salary_percent: 0, salary_base: "company", salary_branch_id: null, salary_when: "before",
  start_date: "2026-01-01", notes: null, initial_capital: 0 };
const mv = (id, type, amount, date, extra = {}) => ({ id, type, amount, date, created_at: `${date}T10:00:00Z`, description: null, branch_id: B1,
  method: "cash", void: false, cancel_reason: null, distribution_id: null, treasury_id: `t-${id}`, editable: false, cancellable: true, ...extra });
const cards = { partner, contributions: 1000000, capital_withdrawals: 200000, capital: 800000, profit: 150000, profit_in: 150000, profit_out: 0, advances: 0,
  movements: [mv("m1", "contribution", 1000000, "2026-09-15"), mv("m2", "capital_withdrawal", 200000, "2026-10-01"),
              mv("m3", "profit_share", 150000, "2026-10-31", { distribution_id: "d1", cancellable: false, branch_id: null, method: null, treasury_id: null })],
  advances_list: [] };


const PB = "b0000001-0000-4000-8000-000000000002";
const INFO = { start_day: "2026-01-01", opening_equity: 4845828.43, distributed: false, partners: [
  { id: PB, name: "الحاج ناصر ايوب", opening: 0, capital: 0, capital_share: 1 },
  { id: P1, name: "شريك تجربة", opening: 0, capital: 0, capital_share: 0 } ] };
const RESULT = (applied) => ({ start_day: "2026-01-01", opening_equity: 4845828.43, opening_total: 4000000, kept_as_retained: 845828.43, applied,
  books_balanced: applied ? true : undefined, partners: [
    { id: PB, name: "الحاج ناصر ايوب", capital_before: 0, capital_after: 1000000, share_before: 1, share_after: 0.25 },
    { id: P1, name: "شريك تجربة", capital_before: 0, capital_after: 3100000, share_before: 0, share_after: 0.7561 } ] });

function makeDb() {
  return {
    calls: [],
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true }],
    user_roles: [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T }],
    branch_users: [], role_permissions: [], user_permissions: [], permission_templates: [], transfer_fees: [],
    branches: [{ id: B1, name: "معرض عبدالمنعم", code: "FR-004", tenant_id: T, is_active: true, is_system: false, platform_paused: false }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [{ id: E1, name: "محمد ياسر", tenant_id: T, is_active: true, user_id: null }],
    equity_partners: [partner],
  };
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
      if (name === "partner_capital_setup_info") return json(INFO);
      if (name === "partner_capital_setup") return json(RESULT(body.p_apply));
      if (name === "search_branch_contacts") return json([{ id: "sup1", name: "شركة فريش", type: "supplier", branch_id: B1, branch_name: "معرض عبدالمنعم", phone: null }]);
      if (name === "partners_overview") return json([{ ...cards, movements: undefined, advances_list: undefined }]);
      if (name === "partner_cards") return json(cards);
      if (name === "partner_money") return json({ treasury_id: "t9", capital: 0, profit: 150000, advance: 50000 });
      if (name === "save_partner") return json("b0000001-0000-4000-8000-000000000002");
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
const vis = (loc) => loc.first().isVisible().catch(() => false);
const settle = async (page) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(900); };
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
const money = (n) => new RegExp(String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "[,٬]?"));

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const db = makeDb();
  const { page } = await open(browser, db, OWNER);
  await page.goto(`${BASE}/admin/financial-position?tab=partners`); await settle(page);
  check("1. زرار «ظبّط رأس مال الشركاء» ظاهر للمالك", await vis(page.getByRole("button", { name: /ظبّط رأس مال الشركاء/ })));
  await page.getByRole("button", { name: /ظبّط رأس مال الشركاء/ }).click(); await page.waitForTimeout(800);
  const d = page.getByRole("dialog");
  check("2. خطوة 1: يوم البداية وصافي الملك", await vis(d.getByText("2026-01-01")) && await vis(d.getByText(money(4845828))));
  await shot(page, "capital-1-start");
  await d.getByRole("button", { name: "التالي" }).click();
  await d.getByLabel("شريك تجربة").fill("5000000");
  check("3. خطوة 2: أكبر من صافي الملك → رسالة والتالي مقفول", await vis(d.getByRole("alert")) && await d.getByRole("button", { name: "التالي" }).isDisabled());
  await d.getByLabel("شريك تجربة").fill("3000000");
  await d.getByLabel("الحاج ناصر ايوب").fill("1000000");
  check("4. الباقي أرباح محتجزة 845,828.43", await vis(d.getByText(money(845828))));
  await shot(page, "capital-2-amounts");
  await d.getByRole("button", { name: "التالي" }).click();
  await d.getByRole("button", { name: /ضيف حركة/ }).click();
  await d.getByLabel("الشريك").selectOption(P1);
  await d.getByLabel("الفرع").selectOption(B1);
  await d.getByLabel("اليوم").fill("2026-03-01");
  await d.getByLabel("المبلغ").fill("100000");
  await shot(page, "capital-3-moves");
  await d.getByRole("button", { name: "راجع" }).click(); await page.waitForTimeout(800);
  const pv = db.calls.find((c) => c.rpc === "partner_capital_setup" && c.body.p_apply === false);
  check("5. معاينة: partner_capital_setup(apply=false) بالمبالغ والحركة",
    !!pv && pv.body.p_openings.length === 2 && pv.body.p_openings.some((o) => o.partner_id === P1 && o.amount === 3000000)
      && pv.body.p_moves[0].kind === "cash" && pv.body.p_moves[0].amount === 100000 && pv.body.p_moves[0].branch_id === B1, JSON.stringify(pv?.body ?? {}));
  check("6. خطوة 4: قبل ← بعد والنسب الجديدة", await vis(d.getByText("75.61%")) && await vis(d.getByText("25%")));
  await shot(page, "capital-4-review");
  check("7. لسه مفيش تسجيل قبل «سجّل»", !db.calls.some((c) => c.rpc === "partner_capital_setup" && c.body.p_apply === true));
  await d.getByRole("button", { name: "سجّل" }).click(); await page.waitForTimeout(900);
  const ap = db.calls.filter((c) => c.rpc === "partner_capital_setup" && c.body.p_apply === true);
  check("8. «سجّل» = طلب واحد بنفس البيانات", ap.length === 1 && JSON.stringify(ap[0].body.p_moves) === JSON.stringify(pv.body.p_moves));
  check("9. الويزارد اتقفل والصفحة اتحدثت", !(await vis(page.getByRole("dialog"))) && db.calls.filter((c) => c.rpc === "partners_overview").length >= 2);
  const errs = db.calls.filter((c) => c.pageerror);
  check("10. مفيش أخطاء في الصفحة", errs.length === 0, errs.map((e) => e.pageerror).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
