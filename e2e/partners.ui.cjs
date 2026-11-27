// UI test of the new partners screens (migration 0137, owner «صفحة الشركاء غيرها كلها»): the partners tab with each
// partner's five numbers, the withdrawal dialog (200,000 «من الربح» with 150,000 profit → 150,000 + 50,000 advance) and its
// ONE partner_money call, the partner page whose cards filter the movements, and the add form («موظف وشريك», % salary of a
// branch, operating share) → save_partner with fractions. Database faked in the browser. Run:
//   npm run build && npx vite preview --host 127.0.0.1 --port 4173, then: node e2e/partners.ui.cjs
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
  movements: [mv("m1", "contribution", 1000000, "2026-09-15", { editable: true }), mv("m2", "capital_withdrawal", 200000, "2026-10-01"),
              // 0288: an edited «موجود بالفعل» (deposit 2024-03-15, one proof file) and the cancelled one it replaced
              mv("m4", "capital_adjustment", 1200, "2026-01-01", { existing: true, editable: true, branch_id: null, method: null, treasury_id: null,
                description: "رأس مال موجود بالفعل — المساهمة الأولى", deposited_on: "2024-03-15", files: 1, replaces: "m5", replaces_amount: 1000,
                edited_by: "احمد ناصر", edited_at: "2026-11-26T10:00:00Z", edit_reason: "المبلغ غلط" }),
              // 0290: a pre-system withdrawal «من الربح»
              mv("m8", "profit_withdrawal", 40000, "2026-01-01", { existing: true, editable: true, branch_id: null, method: null, treasury_id: null,
                description: "سحب قبل السيستم — عربية", deposited_on: "2025-05-01" }),
              mv("m5", "capital_adjustment", 1000, "2026-01-01", { existing: true, void: true, cancellable: false, branch_id: null, method: null, treasury_id: null,
                replaced_by: "m4", cancelled_by: "احمد ناصر", cancelled_at: "2026-11-26T10:00:00Z", cancel_reason: "اتعدلت: المبلغ غلط" }),
              mv("m3", "profit_share", 150000, "2026-10-31", { distribution_id: "d1", cancellable: false, branch_id: null, method: null, treasury_id: null })],
  advances_list: [] };

const P2 = "b0000001-0000-4000-8000-000000000002";
const cards2 = { partner: { ...partner, id: P2, name: "الحاج ناصر" }, contributions: 800000, capital_withdrawals: 0, capital: 800000, profit: 0, profit_in: 0, profit_out: 0, advances: 0, movements: [], advances_list: [] };
const SHARES = { from: "2026-10-01", to: "2026-10-31", net_before: 300000, total: 39000, already: false,
  months: [{ month: "2026-10", from: "2026-10-01", to: "2026-10-31", net_before: 300000, pay: 39000,
    lines: [{ partner_id: P1, name: "شريك تجربة", kind: "fixed", amount: 10000 }, { partner_id: P1, name: "شريك تجربة", kind: "percent", percent: 0.1, percent_base: "after_fixed", base: 290000, amount: 29000 }] }],
  rows: [{ key: `${P1}:salary`, partner_id: P1, name: "شريك تجربة", kind: "salary_share", amount: 10000, computed: 10000, percent: 0, base: 0, branch_id: null, typed: false, needs_owner: false },
         { key: `${P1}:operating`, partner_id: P1, name: "شريك تجربة", kind: "operating_share", amount: 29000, computed: 29000, percent: 0.1, base: 290000, branch_id: null, typed: false, needs_owner: false }] };
const GAP = { start_day: "2026-01-01", opening: 4845828.43, opening_used: 0, opening_left: 4845828.43, capital_new: 10000000, gap: 5154171.57,
  capital_by_partner: {}, partners: [{ id: P1, name: "شريك تجربة", capital_new: 4000000 }, { id: P2, name: "الحاج ناصر", capital_new: 6000000 }], decisions: [] };
const GAP_LINES = [
  { account_code: "3950", debit: 4845828.43, credit: 0, description: "الرصيد الافتتاحي ← رأس مال الشركاء" },
  { account_code: "3800", debit: 4000000, credit: 0, description: "خسائر قبل السيستم" },
  { account_code: "3200", debit: 1154171.57, credit: 0, description: "مسحوبات قبل السيستم — الحاج ناصر" },
  { account_code: "3100", debit: 0, credit: 4000000, description: "رأس مال شريك تجربة" },
  { account_code: "3100", debit: 0, credit: 6000000, description: "رأس مال الحاج ناصر" }];
// 0289: step 2 — the owner's example (600,000 available; محمد 340,000 / أحمد 226,667 / إبراهيم 33,333; one partner with no capital)
const P3 = "b0000001-0000-4000-8000-000000000003", P4 = "b0000001-0000-4000-8000-000000000004";
const SPLIT = { from: "2026-10-01", to: "2026-10-31", net_profit: 600000, already: 0, available: 600000, pay_missing: false, partners: [
  { partner_id: P1, name: "محمد", capital_start: 3000000, capital_end: 3000000, suggested: 340000 / 600000, in_period: true, advances: 0 },
  { partner_id: P2, name: "أحمد", capital_start: 2000000, capital_end: 2000000, suggested: 226666.67 / 600000, in_period: true, advances: 0 },
  { partner_id: P3, name: "إبراهيم", capital_start: 0, capital_end: 1000000, suggested: 33333.33 / 600000, in_period: true, advances: 20000 },
  { partner_id: P4, name: "شريك من غير رأس مال", capital_start: 0, capital_end: 0, suggested: 0, in_period: false, advances: 0 }] };
const DISTS = [{ id: "dist-1", day: "2026-09-30", from: "2026-09-01", to: "2026-09-30", total: 100000, status: "posted", mode: "manual", rest: "keep",
  available: 120000, notes: null, by: "احمد ناصر", lines: [{ partner_id: P1, name: "محمد", amount: 60000, pct: 60, suggested: 56.67 }, { partner_id: P2, name: "أحمد", amount: 40000, pct: 40, suggested: 37.78 }] }];
// 0295: a test partner with nothing at all (delete / archive) and an archived one
const P5 = "b0000001-0000-4000-8000-000000000005", P6 = "b0000001-0000-4000-8000-000000000006";
const NOUR = { partner: { ...partner, id: P5, name: "نور ناصر" }, contributions: 0, capital_withdrawals: 0, capital: 0, profit: 0, profit_in: 0, profit_out: 0, advances: 0 };
const NOUR_OLD = { partner: { ...partner, id: P6, name: "شريك قديم", is_active: false, archived_at: "2026-11-27T10:00:00Z", archive_reason: "خرج من الشراكة" },
  contributions: 50000, capital_withdrawals: 50000, capital: 0, profit: 0, profit_in: 0, profit_out: 0, advances: 0 };
function makeDb() {
  return {
    calls: [],
    profiles: [{ id: OWNER, name: "احمد ناصر", username: "an.ayoub98", tenant_id: T, is_active: true }],
    user_roles: [{ user_id: OWNER, role: "owner", tenant_id: T }, { user_id: OWNER, role: "admin", tenant_id: T }],
    branch_users: [], role_permissions: [], user_permissions: [], permission_templates: [], transfer_fees: [],
    branches: [{ id: B1, name: "معرض عبدالمنعم", code: "FR-004", tenant_id: T, is_active: true, is_system: false, platform_paused: false }],
    tenants: [{ id: T, name: "A & N", slug: "an", is_suspended: false, owner_user_id: OWNER, setup_completed: true }],
    employees: [{ id: E1, name: "محمد ياسر", tenant_id: T, is_active: true, user_id: null }],
    equity_partners: [partner], partner_pay_rules: [], attachments: [],
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
  page.on("pageerror", (e) => db.calls.push({ pageerror: String(e).slice(0, 300) + " @after " + JSON.stringify(db.calls.slice(-3).map((c) => c.rpc || c.table)) + " " + String(e.stack || "").split("\n").slice(1, 6).join(" | ") }));
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
      if (name === "partners_overview") return json([{ ...cards, movements: undefined, advances_list: undefined },
        { ...cards2, movements: undefined, advances_list: undefined }, ...(db.withNour ? [NOUR, NOUR_OLD] : [])]);
      if (name === "delete_partner") return json({ name: "نور ناصر" });
      if (name === "set_partner_archived") return json({ name: "x", archived: body.p_archived });
      if (name === "partner_existing_capital") return json("tx-existing");
      if (name === "set_partner_pay_rule") return json("rule-1");
      if (name === "post_partner_period_shares") return json({ posted: 2 });
      if (name === "partner_capital_gap_info") return json(GAP);
      if (name === "partner_capital_gap_settle") return json({ applied: !!body.p_apply, gap: GAP.gap, leave: false, balanced: true, lines: GAP_LINES });
      if (name === "partner_period_shares_preview") return json(SHARES);
      if (name === "preview_flexible_distribution") return json({ net_profit: { net_profit: 0 }, distributable: 0, partners: [] });
      if (name === "partner_cards") return json(body.p_partner === P2 ? cards2 : cards);
      if (name === "edit_existing_capital") return json("m6");
      if (name === "partner_existing_capital") return json("new-ex");
      if (name === "partner_pre_system_withdrawal") return json("new-ps");
      if (name === "period_split_preview") return json(SPLIT);
      if (name === "profit_distributions_list") return json(DISTS);
      if (name === "distribute_profits_manual") return json({ distribution_id: "dist-2", total_amount: body.p_lines.reduce((s, l) => s + l.amount, 0), available: 600000,
        kept: 600000 - body.p_lines.reduce((s, l) => s + l.amount, 0), advances_settled: 0, day: "2026-10-31" });
      if (name === "reverse_period_distribution") return null || json(null);
      if (name === "lock_distributed_period") return json("p1");
      if (name === "edit_partner_capital_move") return json({ old: body.p_tx, new: "m7", difference: -100000 });
      if (name === "cancel_partner_transaction") return json({ voided: 1, amount: 200000 });
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

  // 1. the partners tab: 5 tabs, no «نظرة عامة», each card with his % and his pay
  await page.goto(`${BASE}/admin/financial-position`); await settle(page);
  const tabs = await page.getByRole("tab").allInnerTexts();
  check("1. التابات: الشركاء / رأس المال / توزيع الأرباح / الحركات / القوائم المالية — ومفيش «نظرة عامة»",
    ["الشركاء", "رأس المال", "توزيع الأرباح", "الحركات", "القوائم المالية"].every((t) => tabs.some((x) => x.includes(t))) && !tabs.some((x) => x.includes("نظرة عامة")), tabs.join(" | "));
  check("2. كارت كل شريك بالأرقام الخمسة", await vis(page.getByText("شريك تجربة")) && await vis(page.getByText("مسحوب من رأس المال").first()));
  const sharesTxt = await page.getByTestId("partner-share").allInnerTexts();
  check("3. نصيب كل واحد من الربح على كارته (800 ألف + 800 ألف → 50% / 50%)", sharesTxt.length === 2 && sharesTxt.every((t) => t.trim() === "50%"), sharesTxt.join(","));
  check("3b. مرتبه على الكارت: «مالوش مرتب»", (await page.getByTestId("partner-pay").first().innerText()).includes("مالوش مرتب"));
  check("3c. زراير الويزارد و«حصص التشغيل» القديمة اتشالت", !(await vis(page.getByRole("button", { name: /ظبّط رأس مال|حصص التشغيل/ }))));
  await shot(page, "partners-1-list");

  // 2. withdrawal «من الربح» above his profit (unchanged money door)
  await page.getByRole("button", { name: /^سحب$/ }).first().click(); await page.waitForTimeout(600);
  await page.locator('input[type="number"]').first().fill("200000"); await page.waitForTimeout(300);
  check("4. السحب: 150,000 من الربح + 50,000 سلفة", await vis(page.getByText(/من الربح \+ .*سلفة/)));
  check("5. من غير فرع: الزرار مقفول ومفيش طلب للسيرفر", await page.getByTestId("pm-save").isDisabled() && !db.calls.some((c) => c.rpc === "partner_money"));
  // 0295: the exact day + «يتحسب من بداية شهر» — a withdrawal stops counting in its own month
  const thisMonthLabel = await page.getByTestId("pm-rule").innerText().catch(() => "");
  check("5a. السحب: «اتسحبت إمتى» + «يتحسب من بداية شهر» والقاعدة = نفس الشهر", await vis(page.locator("#pm-day")) && /نوفمبر|ديسمبر|يناير|202\d/.test(thisMonthLabel)
    && (await page.getByTestId("pm-month").innerText()).includes(thisMonthLabel), thisMonthLabel);
  await page.getByTestId("pm-branch").click(); await page.getByRole("option", { name: "معرض عبدالمنعم" }).click();
  await shot(page, "partners-2-withdrawal");
  await page.getByRole("button", { name: /سجّل السحب/ }).click(); await page.waitForTimeout(800);
  const pm = db.calls.find((c) => c.rpc === "partner_money");
  check("6. طلب واحد partner_money بالفرع المختار والشهر", !!pm && pm.body.p_amount === 200000 && pm.body.p_branch === B1 && /^\d{4}-\d{2}-01$/.test(pm.body.p_counts_from)
    && pm.body.p_counts_from === `${pm.body.p_date.slice(0, 7)}-01`, JSON.stringify(pm?.body ?? {}));

  // 0295: a contribution — rule = the month after; an earlier month = a warning only
  await page.locator("[data-sonner-toast]").first().waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  await page.getByRole("button", { name: /^مساهمة$/ }).first().click(); await page.waitForTimeout(600);
  check("6a. فورم المساهمة بنفس شكل «سحب قبل السيستم» (عنوان + رأس ماله ونسبته + اللي هيحصل)", await vis(page.getByTestId("partner-money-dialog"))
    && await vis(page.getByRole("dialog").getByText("نسبته من الربح:")));
  await page.locator("#pm-amount").fill("10000"); await page.locator("#pm-day").fill("2026-10-15"); await page.waitForTimeout(300);
  check("6b. دخلت 15/10 → القاعدة نوفمبر 2026 والشهر اتحط لوحده", (await page.getByTestId("pm-rule").innerText()) === "نوفمبر 2026"
    && (await page.getByTestId("pm-month").innerText()).includes("نوفمبر 2026"));
  await page.getByTestId("pm-month").click(); await page.getByRole("option", { name: "أكتوبر 2026" }).click(); await page.waitForTimeout(300);
  check("6c. شهر قبل القاعدة = تنبيه أصفر بس", await vis(page.getByTestId("pm-warning")) && (await page.getByTestId("pm-warning").innerText()).includes("قبل ما الفلوس تدخل"));
  await page.getByTestId("pm-branch").click(); await page.getByRole("option", { name: "معرض عبدالمنعم" }).click(); await page.waitForTimeout(200);
  const peff = await page.getByTestId("pm-effect").innerText();
  check("6d. اللي هيحصل: رأس ماله يزيد من أكتوبر 2026", money(810000).test(peff) && peff.includes("أكتوبر 2026"), peff.replace(/\n/g, " | "));
  await page.getByTestId("pm-files").setInputFiles({ name: "transfer.png", mimeType: "image/png", buffer: Buffer.from("89504e47", "hex") });
  await shot(page, "partners-2b-contribution");
  check("6e. الزرار شغال رغم التنبيه", !(await page.getByTestId("pm-save").isDisabled()));
  await page.getByTestId("pm-save").click(); await page.waitForTimeout(900);
  const pmc = db.calls.filter((c) => c.rpc === "partner_money");
  check("6f. partner_money للمساهمة: يوم 2026-10-15 ويتحسب من 2026-10-01", pmc.length === 2 && pmc[1].body.p_kind === "contribution" && pmc[1].body.p_date === "2026-10-15"
    && pmc[1].body.p_counts_from === "2026-10-01", JSON.stringify(pmc[1]?.body ?? {}));

  // 3. «رأس المال»: «موجود بالفعل» shows the % before → after, then ONE call
  await page.getByRole("tab", { name: "رأس المال" }).click(); await settle(page);
  check("7. جدول رأس المال: إجمالي 1,600,000 وكل واحد 50%", await vis(page.getByText(money(1600000))));
  // 0290: each partner's capital is a card with icon actions (tooltip + name), the page link included
  check("7a. كارت لكل شريك فيه 5 أيقونات (موجود بالفعل / سحب قبل السيستم / مساهمة / سحب / صفحته)",
    await vis(page.getByTestId(`cap-act-existing-${P1}`)) && await vis(page.getByTestId(`cap-act-presys-${P1}`)) && await vis(page.getByTestId(`cap-act-in-${P1}`))
    && await vis(page.getByTestId(`cap-act-out-${P1}`)) && (await page.getByTestId(`cap-act-page-${P1}`).getAttribute("href")) === `/admin/financial-position/partner/${P1}`);
  await page.getByTestId(`cap-act-presys-${P1}`).hover(); await page.waitForTimeout(700);
  check("7b. الوقوف على الأيقونة بيقول بتعمل إيه", await vis(page.getByRole("tooltip").filter({ hasText: "من غير خزنة ولا قيد" })));
  await shot(page, "partners-4-capital-cards");
  await page.getByTestId(`cap-act-existing-${P1}`).click(); await page.waitForTimeout(500);
  await page.locator("#om-amount").fill("1600000"); await page.waitForTimeout(300);
  check("8z. الفورم الجديد: المبلغ مكتوب بالفاصلات تحته ورأس ماله ونسبته فوق", money(1600000).test(await page.getByTestId("om-amount-text").innerText().catch(() => ""))
    && await vis(page.getByRole("dialog").getByText("نسبته من الربح:")));
  // 0295: «اتدفعت إمتى» (required) + «يتحسب من بداية شهر» — rule = the month after; earlier = a warning only
  check("8a. «اتدفعت إمتى» إجباري جنب «يتحسب من بداية شهر»", await vis(page.locator("#om-day")) && await vis(page.getByTestId("om-month"))
    && await page.getByTestId("om-save").isDisabled() && (await page.getByTestId("om-problem").innerText()).includes("اتدفعت إمتى"));
  await page.locator("#om-day").fill("2026-03-01"); await page.waitForTimeout(200);
  check("8b. دفع 1/3 → القاعدة أبريل 2026 واتختار لوحده", (await page.getByTestId("om-rule").innerText()) === "أبريل 2026" && (await page.getByTestId("om-month").innerText()).includes("أبريل 2026"));
  await page.getByTestId("om-month").click(); await page.getByRole("option", { name: "يناير 2026" }).click(); await page.waitForTimeout(200);
  check("8c. يناير قبل القاعدة = تنبيه بس والزرار شغال", await vis(page.getByTestId("om-warning")) && !(await page.getByTestId("om-save").isDisabled()));
  await page.locator("#om-day").fill("2099-01-01"); await page.waitForTimeout(200);
  check("8d. يوم بعد النهارده = الزرار مقفول", await page.getByTestId("om-save").isDisabled());
  await page.locator("#om-day").fill("2024-03-15"); await page.waitForTimeout(200);
  const eff = await page.getByTestId("existing-effect").innerText().catch(() => "");
  check("8. قبل الحفظ: نسبته 50% ← 75% والخزن مش هتتغير", eff.includes("50%") && eff.includes("75%") && eff.includes("الخزن"), eff.replace(/\n/g, " "));
  await page.getByTestId("om-files").setInputFiles({ name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await page.waitForTimeout(200);
  check("8y. الإثبات بيتختار جوه الفورم قبل الحفظ", await vis(page.getByRole("dialog").getByText("receipt.pdf")));
  await shot(page, "partners-5-existing");
  await page.getByRole("dialog").getByRole("button", { name: "سجّل" }).click(); await page.waitForTimeout(1200);
  const ex = db.calls.filter((c) => c.rpc === "partner_existing_capital");
  check("9. partner_existing_capital مرة واحدة: 1,600,000 من 2026-01-01 واتدفعت 2024-03-15", ex.length === 1 && ex[0].body.p_amount === 1600000 && ex[0].body.p_day === "2026-01-01"
    && ex[0].body.p_partner === P1 && ex[0].body.p_deposited_on === "2024-03-15", JSON.stringify(ex[0]?.body ?? {}));
  check("9h. الإثبات اترفع على الحركة الجديدة والفورم اتقفل", db.calls.some((c) => c.table === "attachments" && c.method === "POST") && !(await vis(page.getByTestId("old-money-dialog"))));

  // 0290: «سحب قبل السيستم» — the owner picks each time: from his capital or from the profit
  await page.waitForTimeout(800);
  await page.getByTestId(`cap-act-presys-${P1}`).click(); await page.waitForTimeout(500);
  await page.locator("#om-amount").fill("100000"); await page.waitForTimeout(200);
  check("9r. من غير ما تختار «من فين» الزرار مقفول", await page.getByTestId("om-save").isDisabled() && (await page.getByTestId("om-problem").innerText()).includes("رأس ماله ولا من الربح"));
  await page.getByTestId("om-mode-capital").click(); await page.waitForTimeout(200);
  const effC = await page.getByTestId("existing-effect").innerText();
  check("9s. من رأس ماله: رأس ماله 800,000 ← 700,000 ونسبته تقل", money(800000).test(effC) && money(700000).test(effC) && /50%/.test(effC), effC.replace(/\n/g, " | "));
  await page.getByTestId("om-mode-profit").click(); await page.waitForTimeout(200);
  const effP = await page.getByTestId("existing-effect").innerText();
  check("9t. من الربح: رأس ماله زي ما هو وصافي ربحه يقل", effP.includes("زي ما هو") && effP.includes("صافي ربحه"), effP.replace(/\n/g, " | "));
  await page.getByTestId("om-mode-capital").click(); await page.locator("#om-amount").fill("9999999"); await page.waitForTimeout(200);
  check("9u. أكتر من رأس ماله = الزرار مقفول", await page.getByTestId("om-save").isDisabled());
  await page.locator("#om-amount").fill("100000"); await page.locator("#om-day").fill("2025-06-10"); await page.locator("#om-notes").fill("سحب قديم");
  await page.getByTestId("om-save").click(); await page.waitForTimeout(900);
  const ps = db.calls.filter((c) => c.rpc === "partner_pre_system_withdrawal");
  check("9v. partner_pre_system_withdrawal مرة واحدة: من رأس المال، اتسحبت 2025-06-10", ps.length === 1 && ps[0].body.p_mode === "capital" && ps[0].body.p_amount === 100000
    && ps[0].body.p_withdrawn_on === "2025-06-10" && ps[0].body.p_day === "2026-01-01" && ps[0].body.p_partner === P1, JSON.stringify(ps[0]?.body ?? {}));
  await page.waitForTimeout(600);

  // 0288: capital movements — deposit column, who edited, edit / proof / cancel
  const capTxt = await page.getByTestId("cap-moves-live").innerText().catch(() => "");
  check("9i. جدول حركات رأس المال فيه «اتدفعت إمتى» = 2024-03-15", capTxt.includes("2024-03-15"));
  check("9j. الحركة المعدلة بتقول «معدلة (كانت 1,000) — احمد ناصر — … — المبلغ غلط»", /معدلة \(كانت .*1[,٬]?000.*\) — احمد ناصر — 26\/11\/2026 — المبلغ غلط/.test(capTxt), capTxt.replace(/\n/g, " | ").slice(0, 300));
  check("9w. «الشغالة» مفيهاش الحركة الملغية، وفيها «سحب قبل السيستم (من الربح)»", !capTxt.includes("اتعدلت — احمد ناصر") && capTxt.includes("سحب قبل السيستم (من الربح)"));
  await page.getByTestId("moves-tab-cancelled").click(); await page.waitForTimeout(400);
  const cxTxt = await page.getByTestId("cap-moves-cancelled").innerText().catch(() => "");
  check("9k. تاب «الملغاة»: القديمة متعلّمة «اتعدلت — احمد ناصر» ومالهاش تعديل", /اتعدلت — احمد ناصر/.test(cxTxt) && !(await vis(page.getByTestId("edit-move-m5"))), cxTxt.replace(/\n/g, " | ").slice(0, 200));
  await shot(page, "partners-6b-cancelled");
  await page.getByTestId("moves-tab-live").click(); await page.waitForTimeout(400);
  await page.getByTestId("edit-move-m4").first().click(); await page.waitForTimeout(400);
  const dlg = page.getByRole("dialog");
  check("9l. تعديل «موجود بالفعل» بيفتح بالقيم القديمة والسبب إجباري", (await page.locator("#om-amount").inputValue()) === "1200"
    && (await page.locator("#om-day").inputValue()) === "2024-03-15" && (await page.getByTestId("om-month").innerText()).includes("يناير 2026") && await dlg.getByRole("button", { name: "احفظ التعديل" }).isDisabled());
  await page.locator("#om-amount").fill("1500"); await page.locator("#om-reason").fill("نسيت 300");
  await dlg.getByRole("button", { name: "احفظ التعديل" }).click(); await page.waitForTimeout(700);
  const ee = db.calls.filter((c) => c.rpc === "edit_existing_capital");
  check("9m. edit_existing_capital مرة واحدة بالمبلغ والإيداع والسبب", ee.length === 1 && ee[0].body.p_tx === "m4" && ee[0].body.p_amount === 1500
    && ee[0].body.p_deposited_on === "2024-03-15" && ee[0].body.p_reason === "نسيت 300", JSON.stringify(ee[0]?.body ?? {}));
  if (await vis(page.getByRole("button", { name: "خلاص" }))) await page.getByRole("button", { name: "خلاص" }).click();
  await page.waitForTimeout(400);
  await page.getByTestId("edit-move-m1").first().click(); await page.waitForTimeout(400);
  check("9n0. تعديل حركة خزنة قديمة: الشهر = القاعدة القديمة (أكتوبر 2026)", (await page.getByTestId("tm-month").innerText()).includes("أكتوبر 2026"));
  await page.locator("#tm-amount").fill("900000"); await page.locator("#tm-day").fill("2026-09-10"); await page.waitForTimeout(200);
  const teff = await page.getByTestId("till-edit-effect").innerText().catch(() => "");
  check("9n. تعديل مساهمة في الخزنة: بيقول إيه هيحصل في اليومين", teff.includes("2026-09-15") && teff.includes("2026-09-10") && teff.includes("يقل"), teff.replace(/\n/g, " | "));
  await page.locator("#tm-reason").fill("اليوم غلط"); await page.getByRole("dialog").getByRole("button", { name: "احفظ التعديل" }).click(); await page.waitForTimeout(700);
  const tm = db.calls.filter((c) => c.rpc === "edit_partner_capital_move");
  check("9o. edit_partner_capital_move مرة واحدة بالشهر", tm.length === 1 && tm[0].body.p_tx === "m1" && tm[0].body.p_amount === 900000 && tm[0].body.p_date === "2026-09-10"
    && tm[0].body.p_reason === "اليوم غلط" && tm[0].body.p_counts_from === "2026-10-01", JSON.stringify(tm[0]?.body ?? {}));
  await page.getByRole("button", { name: "إثبات الحركة (إيصال / عقد)" }).first().click(); await page.waitForTimeout(500);
  check("9p. زرار الإثبات بيفتح المرفقات", await vis(page.getByRole("dialog").getByText("إثبات الحركة (إيصال / عقد)")));
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  await page.getByTestId("cancel-move-m2").first().click(); await page.waitForTimeout(300);
  await page.getByRole("dialog").locator("textarea").fill("اتسجل مرتين");
  await page.getByRole("dialog").getByRole("button", { name: "تأكيد" }).click(); await page.waitForTimeout(600);
  const cx = db.calls.filter((c) => c.rpc === "cancel_partner_transaction");
  check("9q. الإلغاء بسبب = cancel_partner_transaction مرة واحدة", cx.length === 1 && cx[0].body.p_tx === "m2" && cx[0].body.p_reason === "اتسجل مرتين", JSON.stringify(cx[0]?.body ?? {}));
  await shot(page, "partners-6-capital-moves");

  // 3b. «الفرق بين رأس المال والدفاتر»: 10M vs 4,845,828.43 → 4M loss + الحاج ناصر drew the rest (his % goes down)
  const gc = page.getByTestId("capital-gap");
  check("9b. كارت الفرق: 5,154,171.57", (await gc.getByTestId("gap-amount").innerText()).replace(/[^\d.]/g, "").startsWith("5154171.57"));
  await gc.getByLabel(/خسارة قبل السيستم/).fill("4000000");
  check("9c. فاضل 1,154,171.57 والزرار «راجع» مقفول", /1[,٬]?154[,٬]?171\.57/.test(await gc.getByTestId("gap-left").innerText()) && await gc.getByRole("button", { name: "راجع" }).isDisabled());
  await gc.getByRole("button", { name: /ضيف سحب/ }).click();
  await gc.locator("#gap-dp-0").selectOption(P2);
  await gc.locator("#gap-da-0").fill("1154171.57");
  await gc.getByRole("radio", { name: "نسبته تقل" }).click();
  check("9d. «✓ الفرق كله اتوزع»", (await gc.getByTestId("gap-left").innerText()).includes("الفرق كله اتوزع"));
  await gc.getByRole("button", { name: "راجع" }).click(); await page.waitForTimeout(600);
  const pv = db.calls.filter((c) => c.rpc === "partner_capital_gap_settle");
  const ptxt = await gc.getByTestId("gap-preview").innerText();
  check("9e. «راجع» = معاينة بس (p_apply false) بالخسارة والسحب واختيار النسبة", pv.length === 1 && pv[0].body.p_apply === false
    && JSON.stringify(pv[0].body.p_items) === JSON.stringify([{ kind: "loss", amount: 4000000 }, { kind: "drawing", partner_id: P2, amount: 1154171.57, keep_share: false }]), JSON.stringify(pv[0]?.body));
  check("9f. المعاينة بالكلام ومن غير أرقام حسابات، وبتقول إن الخزن والربح مش هيتغيروا", ptxt.includes("خسائر قبل السيستم") && ptxt.includes("الخزن") && !/\b3[0-9]{3}\b/.test(ptxt), ptxt.replace(/\n/g, " | ").slice(0, 300));
  await page.screenshot({ path: `${OUT}/partners-8-gap.png`, fullPage: true });
  await gc.getByRole("button", { name: "سجّل" }).click(); await page.waitForTimeout(700);
  check("9g. «سجّل» = طلب واحد p_apply true", db.calls.filter((c) => c.rpc === "partner_capital_gap_settle" && c.body.p_apply === true).length === 1);

  // 4. «توزيع الأرباح»: the owner's example, then the pay dialog, then step 1
  await page.getByRole("tab", { name: "توزيع الأرباح" }).click(); await settle(page);
  await page.getByRole("button", { name: /حدد مرتبه/ }).first().click(); await page.waitForTimeout(500);
  const d = page.getByRole("dialog");
  await d.getByLabel("الاتنين").click();
  await d.getByLabel("المرتب الثابت في الشهر").fill("10000");
  await d.getByLabel("النسبة %").fill("10");
  await d.getByLabel("لو الشهر كسب").fill("300000"); await page.waitForTimeout(300);
  const ex1 = await d.getByTestId("pay-example").innerText();
  check("10. المثال: 300,000 → شريك تجربة 169,500 والحاج ناصر 130,500", /169[,٬]?500/.test(ex1) && /130[,٬]?500/.test(ex1), ex1.replace(/\n/g, " | "));
  await d.getByLabel("لو الشهر كسب").fill("-50000"); await page.waitForTimeout(300);
  const ex2 = await d.getByTestId("pay-example").innerText();
  check("11. الشهر الخسران −50,000: المرتب الثابت بيتصرف والنسبة صفر، −30,000 على كل واحد", /10[,٬]?000/.test(ex2) && /30[,٬]?000/.test(ex2), ex2.replace(/\n/g, " | "));
  await shot(page, "partners-6-pay");
  await d.getByRole("button", { name: /احفظ من شهر/ }).click(); await page.waitForTimeout(700);
  const sr = db.calls.filter((c) => c.rpc === "set_partner_pay_rule");
  check("12. set_partner_pay_rule: 10,000 ثابت + 10% بعد الثابت، من أول الشهر", sr.length === 1 && sr[0].body.p_fixed === 10000 && sr[0].body.p_percent === 0.1
    && sr[0].body.p_percent_base === "after_fixed" && /-01$/.test(sr[0].body.p_from_month), JSON.stringify(sr[0]?.body ?? {}));
  check("13. خطوة 1: شهر بشهر — صافي قبل المرتبات والمرتبات والباقي", await vis(page.getByText("خطوة 1: سجّل مرتبات الشركاء للفترة")) && await vis(page.getByText(money(261000)).first()));
  await page.getByRole("button", { name: "سجّل مرتبات الشركاء" }).click(); await page.waitForTimeout(700);
  check("14. «سجّل مرتبات الشركاء» = post_partner_period_shares مرة واحدة", db.calls.filter((c) => c.rpc === "post_partner_period_shares").length === 1);
  check("15. خطوة 2 (التوزيع على الشركا) جوه نفس التاب", await vis(page.getByText("خطوة 2: وزّع الباقي على الشركا")));
  // 0289: the owner types % / amounts; a remainder is his choice on the screen
  const sp = page.getByTestId("period-split");
  await sp.getByTestId("split-available").waitFor({ timeout: 8000 }).catch(() => {});
  check("15a. المتاح 600,000 والمقترح 3 شركا (اللي ملوش رأس مال برا الجدول)", money(600000).test(await sp.getByTestId("split-available").innerText().catch(() => ""))
    && await vis(sp.getByTestId(`split-row-${P3}`)) && !(await vis(sp.getByTestId(`split-row-${P4}`))));
  check("15b. من غير ما تكتب حاجة الإجمالي = المتاح", (await sp.getByTestId("split-diff").innerText()).includes("المتاح بالظبط"));
  await sp.getByLabel("نسبة إبراهيم").fill("10"); await page.waitForTimeout(200);
  const amtI = await sp.getByLabel("مبلغ إبراهيم").inputValue();
  check("15c. 10% لإبراهيم = 60,000 والباقيين زي ما هما", amtI === "60000" && (await sp.getByLabel("مبلغ محمد").inputValue()) === "340000", amtI);
  check("15d. زيادة 26,666.67 عن المتاح والزرار مقفول", /زيادة .*26[,٬]?666\.67/.test(await sp.getByTestId("split-diff").innerText()) && await sp.getByTestId("split-go").isDisabled());
  await sp.getByLabel("مبلغ محمد").fill("313333.33"); await page.waitForTimeout(200);
  check("15e. محمد 313,333.33 → النسبة 52.22% والإجمالي = المتاح", (await sp.getByLabel("نسبة محمد").inputValue()) === "52.22"
    && (await sp.getByTestId("split-diff").innerText()).includes("المتاح بالظبط") && !(await sp.getByTestId("split-go").isDisabled()));
  await sp.getByLabel("مبلغ محمد").fill("250000"); await sp.getByLabel("مبلغ أحمد").fill("200000"); await sp.getByLabel("مبلغ إبراهيم").fill("50000"); await page.waitForTimeout(200);
  check("15f. فاضل 100,000 → لازم تختار أ ولا ب", /فاضل .*100[,٬]?000/.test(await sp.getByTestId("split-diff").innerText()) && await vis(sp.getByTestId("rest-choice"))
    && await sp.getByTestId("split-go").isDisabled() && (await sp.getByTestId("split-problem").innerText()).includes("الباقي"));
  const rc = await sp.getByTestId("rest-choice").innerText();
  check("15g. كل اختيار بيقول الفلوس هتروح فين (ب: محمد 300,000 / أحمد 240,000 / إبراهيم 60,000)", rc.includes("أرباح محتجزة") && rc.includes("مش في كارت أي شريك")
    && money(300000).test(rc) && money(240000).test(rc), rc.replace(/\n/g, " | "));
  await sp.getByText("(ب) وزّع الباقي على الشركا").click(); await page.waitForTimeout(200);
  const fin = await sp.getByTestId("split-final").innerText();
  check("15h. ب: الكروت تاخد 300,000 / 240,000 / 60,000 وإبراهيم بيسدد سلفته الأول", money(300000).test(fin) && money(240000).test(fin) && /سداد سلفته/.test(fin), fin.replace(/\n/g, " | "));
  await sp.getByTestId("split-go").click(); await page.waitForTimeout(400);
  await page.getByRole("button", { name: "أيوه، وزّع" }).click(); await page.waitForTimeout(600);
  if (await vis(page.getByRole("button", { name: "لأ، سيبها مفتوحة" }))) await page.getByRole("button", { name: "لأ، سيبها مفتوحة" }).click();
  await page.waitForTimeout(400);
  const dm = db.calls.filter((c) => c.rpc === "distribute_profits_manual");
  check("15i. distribute_profits_manual (ب): المتاح كله 600,000 و p_rest spread", dm.length === 1 && dm[0].body.p_rest === "spread"
    && Math.abs(dm[0].body.p_lines.reduce((s, l) => s + l.amount, 0) - 600000) < 0.01 && dm[0].body.p_from === dm[0].body.p_from, JSON.stringify(dm[0]?.body ?? {}));
  // أ: keep the remainder
  await sp.getByLabel("مبلغ محمد").fill("250000"); await sp.getByLabel("مبلغ أحمد").fill("200000"); await sp.getByLabel("مبلغ إبراهيم").fill("50000"); await page.waitForTimeout(200);
  await sp.getByText("(أ) سيب الباقي في الشركة").click(); await page.waitForTimeout(200);
  check("15j. أ: بيقول الباقي 100,000 في الشركة", /والباقي .*100[,٬]?000.* في الشركة/.test(await sp.getByTestId("split-final").innerText()));
  await sp.getByTestId("split-go").click(); await page.waitForTimeout(400);
  await page.getByRole("button", { name: "أيوه، وزّع" }).click(); await page.waitForTimeout(600);
  if (await vis(page.getByRole("button", { name: "أيوه، اقفلها" }))) await page.getByRole("button", { name: "أيوه، اقفلها" }).click();
  await page.waitForTimeout(400);
  const dm2 = db.calls.filter((c) => c.rpc === "distribute_profits_manual");
  check("15k. distribute_profits_manual (أ): 500,000 و p_rest keep + سؤال القفل", dm2.length === 2 && dm2[1].body.p_rest === "keep"
    && dm2[1].body.p_lines.reduce((s, l) => s + l.amount, 0) === 500000 && db.calls.some((c) => c.rpc === "lock_distributed_period"), JSON.stringify(dm2[1]?.body ?? {}));
  await sp.getByLabel("ضيف شريك").selectOption(P4); await sp.getByRole("button", { name: "ضيف شريك" }).click(); await page.waitForTimeout(200);
  check("15l. «ضيف شريك» بيضيف اللي ملوش رأس مال بـ 0", await vis(sp.getByTestId(`split-row-${P4}`)) && (await sp.getByLabel("مبلغ شريك من غير رأس مال").inputValue()) === "0");
  const dl = await sp.getByTestId("dist-dist-1").innerText().catch(() => "");
  check("15m. «توزيعات الفترات»: نصيب كل واحد بنسبته والمقترح والباقي في الشركة", dl.includes("نسب يدوية") && /60[,٬]?000/.test(dl) && dl.includes("المقترح 56.67%") && /20[,٬]?000 .*في الشركة/.test(dl), dl.replace(/\n/g, " | "));
  await sp.getByTestId("dist-dist-1").getByRole("button", { name: "اعكس التوزيع" }).click(); await page.waitForTimeout(300);
  await page.getByRole("dialog").locator("textarea").fill("النسب غلط");
  await page.getByRole("dialog").getByRole("button", { name: "اعكس التوزيع" }).click(); await page.waitForTimeout(600);
  const rv = db.calls.filter((c) => c.rpc === "reverse_period_distribution");
  check("15n. «اعكس التوزيع» بسبب = reverse_period_distribution مرة واحدة", rv.length === 1 && rv[0].body.p_id === "dist-1" && rv[0].body.p_reason === "النسب غلط", JSON.stringify(rv[0]?.body ?? {}));
  await shot(page, "partners-7-distribution");

  // 5. «القوائم المالية» inside the page; its own tabs do not move the page's tab
  await page.getByRole("tab", { name: "القوائم المالية" }).click(); await settle(page);
  check("16. تاب القوائم المالية جوه صفحة الشركاء", await vis(page.getByRole("tab", { name: /قائمة الدخل|الدخل/ }).first()) && page.url().includes("tab=statements"));

  // 6. the add form: no pay fields there any more
  // a toast can sit over the tabs: wait for it to go (removing it by hand breaks React — «removeChild»)
  await page.locator("[data-sonner-toast]").first().waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  await page.getByRole("tab", { name: "الشركاء" }).click(); await settle(page);
  await page.getByRole("button", { name: /شريك جديد/ }).click(); await page.waitForTimeout(500);
  check("17. فورم الشريك الجديد من غير خانات مرتب / حصة تشغيل (بقت في «توزيع الأرباح»)",
    !(await vis(page.getByRole("dialog").getByText("حصة تشغيل؟"))) && await vis(page.getByRole("dialog").getByText(/توزيع الأرباح/).first()));
  await shot(page, "partners-4-form");
  await page.keyboard.press("Escape");

  // 7. the partner page still works
  await page.goto(`${BASE}/admin/financial-position/partner/${P1}`); await settle(page);
  check("18. صفحة الشريك فيها الخمس كروت", await vis(page.getByText("رأس المال لحد النهارده")) && await vis(page.getByText("السلف").first()));
  const ptab = await page.locator("table").filter({ hasText: "اتدفعت إمتى" }).first().innerText().catch(() => "");
  check("18c. صفحة الشريك: «اتدفعت إمتى» + تعديل الحركات + الإثبات", ptab.includes("2024-03-15") && await vis(page.getByTestId("edit-move-m4")) && await vis(page.getByTestId("edit-move-m1"))
    && await vis(page.getByRole("button", { name: "إثبات الحركة (إيصال / عقد)" })));
  await shot(page, "partners-3-profile");

  // 8. 0295: delete / archive — a partner with nothing → «حذف»; with capital → «أرشفة» locked; archived → «المؤرشفين» + «استرجاع»
  db.withNour = true;
  await page.goto(`${BASE}/admin/financial-position`); await settle(page);
  const nour = page.locator("div").filter({ has: page.getByRole("link", { name: "نور ناصر" }) }).filter({ has: page.getByTestId("partner-delete") }).last();
  const p1card = page.locator("div").filter({ has: page.getByRole("link", { name: "شريك تجربة" }) }).filter({ has: page.getByTestId("partner-archive") }).last();
  check("20. نور (مفيش حاجة): «حذف» ظاهر و«أرشفة» شغالة", await vis(nour.getByTestId("partner-delete")) && !(await nour.getByTestId("partner-archive").isDisabled()));
  check("20a. شريك عنده رأس مال: «أرشفة» مقفولة ومفيش «حذف»", await p1card.getByTestId("partner-archive").isDisabled() && !(await vis(p1card.getByTestId("partner-delete"))));
  check("20b. المؤرشف مش في القايمة، وفي زرار «المؤرشفين (1)»", !(await vis(page.getByRole("link", { name: "شريك قديم" }))) && (await page.getByTestId("show-archived").innerText()).includes("(1)"));
  await nour.getByTestId("partner-delete").click(); await page.waitForTimeout(300);
  check("20c. الحذف بيطلب سبب", await page.getByTestId("pa-confirm").isDisabled());
  await page.locator("#pa-reason").fill("اتسجلت للتجربة"); await shot(page, "partners-8-delete");
  await page.getByTestId("pa-confirm").click(); await page.waitForTimeout(600);
  const dp = db.calls.filter((c) => c.rpc === "delete_partner");
  check("20d. delete_partner مرة واحدة بالسبب", dp.length === 1 && dp[0].body.p_partner === P5 && dp[0].body.p_reason === "اتسجلت للتجربة", JSON.stringify(dp[0]?.body ?? {}));
  await page.locator("[data-sonner-toast]").first().waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  await nour.getByTestId("partner-archive").click().catch(() => {});
  await page.waitForTimeout(300);
  if (await vis(page.getByTestId("partner-archive-dialog"))) {
    await page.locator("#pa-reason").fill("خرج"); await page.getByTestId("pa-confirm").click(); await page.waitForTimeout(600);
  }
  const ar = db.calls.filter((c) => c.rpc === "set_partner_archived");
  check("20e. set_partner_archived(true) بالسبب", ar.length === 1 && ar[0].body.p_archived === true && ar[0].body.p_reason === "خرج", JSON.stringify(ar[0]?.body ?? {}));
  await page.locator("[data-sonner-toast]").first().waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  await page.getByTestId("show-archived").click(); await page.waitForTimeout(400);
  check("20f. «المؤرشفين»: شريك قديم + «مؤرشف — خرج من الشراكة» + «استرجاع»", await vis(page.getByRole("link", { name: "شريك قديم" }))
    && (await page.getByTestId("partner-archived-badge").first().innerText()).includes("خرج من الشراكة") && await vis(page.getByTestId("partner-restore")));
  await shot(page, "partners-9-archived");
  await page.getByTestId("partner-restore").first().click(); await page.waitForTimeout(300);
  await page.getByTestId("pa-confirm").click(); await page.waitForTimeout(600);
  const rs = db.calls.filter((c) => c.rpc === "set_partner_archived");
  check("20g. «استرجاع» = set_partner_archived(false)", rs.length === 2 && rs[1].body.p_partner === P6 && rs[1].body.p_archived === false, JSON.stringify(rs[1]?.body ?? {}));

  check("18b. مفيش رسالة خطأ ظهرت (toast) في أي خطوة", !(await vis(page.getByText(/حصل خطأ/))));
  const errs = db.calls.filter((c) => c.pageerror);
  check("19. مفيش أخطاء في الصفحة", errs.length === 0, errs.map((e) => e.pageerror).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("❌")) ? 1 : 0);
})();
