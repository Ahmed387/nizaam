// «تسوية رصيد» forms (migration 0291, owner 2026-11-26): the «بدون فلوس» form offers only branches where that side has a
// balance, disables the direction against it, and above the balance asks «لحد الصفر بس» / «كمّل ويقلب» (sends the
// right amount / p_allow_flip). The new «تسوية برصيد» form turns a typed balance into a gain / loss line with the month,
// asks the same two choices when the balance would flip, and sends p_target / p_allow_flip. Server mocked — no real data.
// Run: npx vite --host 127.0.0.1 --port 4174 & then: node e2e/settlement.ui.cjs
const { chromium } = require("playwright");
const PAGE = "http://127.0.0.1:4174/e2e/harness/settlement.html";
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const INFO = [
  { branch_id: "sk", branch: "معرض سكة تلة", customer: 3600, supplier: 17100 },
  { branch_id: "ab", branch: "معرض عبدالمنعم", customer: -250, supplier: 0 },
  { branch_id: "sh", branch: "شلبى", customer: 0, supplier: 0 },
];
const LIST = [
  { id: "s1", settlement_number: "TS00195", settlement_date: "2026-11-20", branch_id: "sk", side: "customer", direction: "he_owes_less", amount: 1600,
    reason: "اتفاق", status: "active", kind: "profit_loss", result: "loss" },
  { id: "s2", settlement_number: "TS00189", settlement_date: "2026-11-21", branch_id: "sk", side: "customer", direction: "he_owes_less", amount: 500,
    reason: "x", status: "cancelled", kind: "prior_years", result: null },
];
(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errors = [];
  async function open(q) {
    const calls = [];
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/rest/v1/**", async (route) => {
      const u = new URL(route.request().url());
      const fn = u.pathname.split("/").pop();
      if (u.pathname.includes("/rpc/")) {
        const body = JSON.parse(route.request().postData() || "{}");
        calls.push({ fn, body });
        if (fn === "contact_settle_info") return route.fulfill({ json: INFO });
        if (fn === "settle_contact_without_money") return route.fulfill({ json: { settlement_number: "TS00200" } });
        if (fn === "settle_contact_to_balance") return route.fulfill({ json: { settlement_number: "TS00201", result: "loss", amount: 1600 } });
        if (fn === "cancel_contact_settlement") return route.fulfill({ json: { cancelled: true } });
        return route.fulfill({ json: null });
      }
      if (fn === "contact_settlements") return route.fulfill({ json: LIST });
      return route.fulfill({ json: [] });
    });
    await page.goto(PAGE + q);
    await page.waitForSelector('[data-testid$="-branch-sk"]');
    return { page, calls };
  }
  const t = (page, id) => page.locator(`[data-testid="${id}"]`);

  // ===== «بدون فلوس» =====
  {
    const { page, calls } = await open("?d=swm&sides=customer,supplier");
    ok(await t(page, "swm-branch-sk").count() === 1 && await t(page, "swm-branch-ab").count() === 1 && await t(page, "swm-branch-sh").count() === 0,
      "swm: only branches with a customer balance (سكة, عبدالمنعم — not شلبى)");
    ok((await t(page, "swm-branch-sk").innerText()).includes("عليه 3,600"), "swm: سكة card shows «عليه 3,600»");
    ok(await t(page, "swm-dir-we_owe_less").isDisabled() && !(await t(page, "swm-dir-he_owes_less").isDisabled()), "swm: سكة (he owes) → «نقلل اللي ليه» disabled");
    ok(await t(page, "swm-dir-he_owes_less").getAttribute("aria-checked") === "true", "swm: the matching direction is picked by itself");
    await t(page, "swm-branch-ab").click();
    ok(await t(page, "swm-dir-he_owes_less").isDisabled() && await t(page, "swm-dir-we_owe_less").getAttribute("aria-checked") === "true",
      "swm: عبدالمنعم (له 250) → only «نقلل اللي ليه عندنا»");
    await t(page, "swm-branch-sk").click();
    await t(page, "swm-amount").fill("1000");
    ok(await t(page, "swm-over").count() === 0 && (await t(page, "swm-effect").innerText()).includes("عليه 2,600"), "swm: 1,000 → effect «رصيده يبقى عليه 2,600»");
    await t(page, "swm-amount").fill("5000");
    ok(await t(page, "swm-over").isVisible(), "swm: 5,000 above 3,600 → the two choices show");
    ok((await t(page, "swm-over-flip").innerText()).includes("ليه عندنا 1,400"), "swm: «كمّل» says he ends «ليه عندنا 1,400»");
    await t(page, "swm-reason").fill("تجربة");
    await t(page, "swm-save").click();
    await page.waitForTimeout(300);
    ok(!calls.some((c) => c.fn === "settle_contact_without_money"), "swm: save without a choice sends nothing");
    await t(page, "swm-over-zero").click();
    await t(page, "swm-save").click();
    await page.waitForTimeout(500);
    let c = calls.filter((x) => x.fn === "settle_contact_without_money").pop();
    ok(c && c.body.p_amount === 3600 && c.body.p_allow_flip === false && c.body.p_branch === "sk" && c.body.p_direction === "he_owes_less",
      `swm: «لحد الصفر» sends 3,600, no flip (${JSON.stringify(c && c.body)})`);
    await t(page, "swm-amount").fill("5000");
    await t(page, "swm-reason").fill("تجربة 2");
    await t(page, "swm-over-flip").click();
    await t(page, "swm-save").click();
    await page.waitForTimeout(500);
    c = calls.filter((x) => x.fn === "settle_contact_without_money").pop();
    ok(c && c.body.p_amount === 5000 && c.body.p_allow_flip === true, "swm: «كمّل» sends 5,000 with p_allow_flip");
    ok((await t(page, "settle-row-TS00195").innerText()).includes("تسوية برصيد · خسارة"), "swm: list shows «تسوية برصيد · خسارة»");
    ok(await t(page, "settle-cancel-TS00189").count() === 0 && await t(page, "settle-cancel-TS00195").count() === 1, "swm: cancel only on the active one");
    await t(page, "swm-side-supplier").click();
    ok(await t(page, "swm-branch-sk").count() === 1 && await t(page, "swm-branch-ab").count() === 0 && (await t(page, "swm-branch-sk").innerText()).includes("علينا ليه 17,100"),
      "swm: supplier side → سكة only, «علينا ليه 17,100»");
    await t(page, "settle-cancel-TS00195").click();
    await t(page, "settle-cancel-reason").fill("غلط");
    await t(page, "settle-cancel-go").click();
    await page.waitForTimeout(400);
    c = calls.filter((x) => x.fn === "cancel_contact_settlement").pop();
    ok(c && c.body.p_id === "s1" && c.body.p_reason === "غلط", "swm: cancel sends the settlement and its reason");
    await page.screenshot({ path: "/tmp/settle-swm.png", fullPage: true });
    await page.close();
  }

  // ===== «تسوية برصيد» =====
  {
    const { page, calls } = await open("?d=stb&sides=customer,supplier");
    await t(page, "stb-target").fill("2000");
    let e = await t(page, "stb-effect").innerText();
    ok(e.includes("خسارة 1,600") && e.includes("خسائر تسوية أرصدة") && /نوفمبر|ديسمبر|يناير/.test(e), `stb: 3,600 → 2,000 = «خسارة 1,600» + month (${e.slice(0, 70)}…)`);
    await t(page, "stb-target").fill("4000");
    e = await t(page, "stb-effect").innerText();
    ok(e.includes("ربح 400") && e.includes("إيرادات أخرى"), "stb: 3,600 → 4,000 = «ربح 400» on «إيرادات أخرى»");
    await t(page, "stb-zero").click();
    ok((await t(page, "stb-effect").innerText()).includes("خسارة 3,600"), "stb: «صفّر الرصيد» → خسارة 3,600");
    await t(page, "stb-target").fill("500");
    await t(page, "stb-way-other").click();
    ok(await t(page, "stb-flip").isVisible() && await t(page, "stb-effect").count() === 0, "stb: «ليه عندنا 500» → the two choices, no effect yet");
    await t(page, "stb-flip-flip").click();
    ok((await t(page, "stb-effect").innerText()).includes("خسارة 4,100"), "stb: «كمّل ويقلب» → خسارة 4,100");
    await t(page, "stb-reason").fill("اتفاق");
    await t(page, "stb-save").click();
    await page.waitForTimeout(500);
    let c = calls.filter((x) => x.fn === "settle_contact_to_balance").pop();
    ok(c && c.body.p_target === -500 && c.body.p_allow_flip === true && c.body.p_side === "customer", `stb: sends target −500 + flip (${JSON.stringify(c && c.body)})`);
    await t(page, "stb-target").fill("500");
    await t(page, "stb-way-other").click();
    await t(page, "stb-flip-zero").click();
    await t(page, "stb-reason").fill("اتفاق 2");
    await t(page, "stb-save").click();
    await page.waitForTimeout(500);
    c = calls.filter((x) => x.fn === "settle_contact_to_balance").pop();
    ok(c && c.body.p_target === 0 && c.body.p_allow_flip === false, "stb: «صفّر بس» sends target 0, no flip");
    await t(page, "stb-side-supplier").click();
    await t(page, "stb-target").fill("16000");
    e = await t(page, "stb-effect").innerText();
    ok(e.includes("ربح 1,100"), "stb: supplier 17,100 → 16,000 = «ربح 1,100»");
    await t(page, "stb-target").fill("17600");
    ok((await t(page, "stb-effect").innerText()).includes("خسارة 500"), "stb: supplier 17,100 → 17,600 = «خسارة 500»");
    await t(page, "stb-target").fill("17100");
    ok(await t(page, "stb-effect").count() === 0, "stb: same balance → no effect line");
    await t(page, "stb-reason").fill("x");
    const before = calls.length;
    await t(page, "stb-save").click();
    await page.waitForTimeout(300);
    ok(!calls.slice(before).some((x) => x.fn === "settle_contact_to_balance"), "stb: same balance sends nothing");
    await page.setViewportSize({ width: 390, height: 844 });
    await t(page, "stb-target").fill("2000");
    await page.screenshot({ path: "/tmp/settle-stb-phone.png", fullPage: true });
    const w = await page.evaluate(() => { const d = document.querySelector('[data-testid="stb-dialog"]'); return [d.scrollWidth, d.clientWidth]; });
    ok(w[0] <= w[1] + 1, `stb: phone — no sideways scroll in the dialog (${w[0]} / ${w[1]})`);
    await page.close();
  }
  ok(errors.length === 0, `no page errors ${errors.join(" | ")}`);
  await browser.close();
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
})();
