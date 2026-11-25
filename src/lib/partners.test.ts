import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import {
  profitShares, pct, payExample, payRuleText,
  formFromPartner, movementsOfCard, partnerFormProblem, partnerMoneyProblem, partnerPayload, salaryText, splitWithdrawal,
  txCard, txSign, withdrawalSentence, type PartnerForm, type PartnerMovement,
} from "./partners";
import { formatEGP } from "./format";

const cards = { capital: 800000, profit: 150000 };

describe("splitWithdrawal — the owner's example", () => {
  it("200,000 «من الربح» with 150,000 profit → 150,000 profit + 50,000 advance", () => {
    expect(splitWithdrawal(200000, "profit", 0, cards)).toEqual({ capital: 0, profit: 150000, advance: 50000 });
  });
  it("«من رأس المال» takes it all from capital", () => {
    expect(splitWithdrawal(200000, "capital", 0, cards)).toEqual({ capital: 200000, profit: 0, advance: 0 });
  });
  it("split: 100,000 capital + the rest from profit", () => {
    expect(splitWithdrawal(300000, "split", 100000, cards)).toEqual({ capital: 100000, profit: 150000, advance: 50000 });
  });
  it("no profit at all → the whole «من الربح» is an advance", () => {
    expect(splitWithdrawal(20000, "profit", 0, { capital: 0, profit: -500 })).toEqual({ capital: 0, profit: 0, advance: 20000 });
  });
});

describe("partnerMoneyProblem", () => {
  const base = { kind: "withdrawal" as const, amount: 900000, branchId: "b", date: "2026-11-04", today: "2026-11-04" };
  it("refuses taking more capital than he has", () => {
    expect(partnerMoneyProblem({ ...base, source: "capital", cards })).toBe(`رأس ماله ${formatEGP(800000)} بس`);
  });
  it("needs a branch, an amount and a past date", () => {
    expect(partnerMoneyProblem({ ...base, branchId: null, source: "profit", cards })).toMatch("اختار الفرع");
    expect(partnerMoneyProblem({ ...base, amount: 0, source: "profit", cards })).toBe("اكتب المبلغ");
    expect(partnerMoneyProblem({ ...base, date: "2026-11-05", source: "profit", cards })).toBe("التاريخ في المستقبل");
  });
  it("split needs a capital part between 0 and the amount", () => {
    expect(partnerMoneyProblem({ ...base, amount: 1000, source: "split", capitalPart: 1000, cards })).toMatch("جزء رأس المال");
    expect(partnerMoneyProblem({ ...base, amount: 1000, source: "split", capitalPart: 400, cards })).toBeNull();
  });
  it("a contribution only needs amount / branch / date", () => {
    expect(partnerMoneyProblem({ kind: "contribution", amount: 5, branchId: "b", date: "2026-01-01", today: "2026-11-04" })).toBeNull();
  });
});

describe("labels and cards", () => {
  it("signs: withdrawals and settles take, the rest gives", () => {
    expect(["capital_withdrawal", "profit_withdrawal", "advance_settle", "drawing"].map(txSign)).toEqual([-1, -1, -1, -1]);
    expect(["contribution", "profit_share", "operating_share", "salary_share"].map(txSign)).toEqual([1, 1, 1, 1]);
  });
  it("a movement belongs to one card", () => {
    expect(txCard("contribution")).toBe("contributions");
    expect(txCard("capital_withdrawal")).toBe("capital_withdrawals");
    expect(txCard("operating_share")).toBe("profit");
  });
  it("clicking a card filters its movements", () => {
    const m = (id: string, type: any, treasury_id: string | null = null) => ({ id, type, treasury_id } as PartnerMovement);
    const list = [m("1", "contribution", "t1"), m("2", "capital_withdrawal", "t2"), m("3", "profit_withdrawal", "t3"), m("4", "advance_settle")];
    expect(movementsOfCard("capital", list).map((x) => x.id)).toEqual(["1", "2"]);
    expect(movementsOfCard("profit", list).map((x) => x.id)).toEqual(["3", "4"]);
    expect(movementsOfCard("advances", list, new Set(["t3"])).map((x) => x.id)).toEqual(["3", "4"]);
    expect(movementsOfCard(null, list)).toHaveLength(4);
  });
  it("the withdrawal sentence names each part", () => {
    expect(withdrawalSentence({ capital: 0, profit: 150000, advance: 50000 })).toBe(
      `${formatEGP(150000)} من الربح + ${formatEGP(50000)} سلفة (أكتر من ربحه — بتتخصم من التوزيع الجاي)`);
  });
});

describe("partner form", () => {
  const f: PartnerForm = {
    name: "", role_kind: "employee_partner", employee_id: "e1", operating_on: true, operating_percent: "10",
    salary_mode: "percent", salary_amount: "", salary_percent: "5", salary_base: "branch", salary_branch_id: "b1", salary_when: "after",
    start_date: "2026-11-01", notes: "",
  };
  it("percent boxes go to the server as fractions", () => {
    expect(partnerPayload(f)).toMatchObject({ operating_share: 0.1, salary_percent: 0.05, salary_mode: "percent", salary_branch_id: "b1" });
  });
  it("«شريك بس» never sends a salary", () => {
    expect(partnerPayload({ ...f, role_kind: "partner", name: "س" })).toMatchObject({ salary_mode: "none", salary_percent: 0 });
  });
  it("asks for what is missing", () => {
    expect(partnerFormProblem({ ...f, employee_id: null })).toBe("اختار الموظف");
    expect(partnerFormProblem({ ...f, salary_branch_id: null })).toMatch("اختار الفرع");
    expect(partnerFormProblem({ ...f, operating_percent: "0" })).toMatch("نسبة التشغيل");
    expect(partnerFormProblem({ ...f, salary_mode: "fixed", salary_amount: "" })).toBe("اكتب المرتب الثابت");
    expect(partnerFormProblem(f)).toBeNull();
  });
  it("reads a saved partner back into the form", () => {
    const back = formFromPartner({ ...(partnerPayload(f) as any), id: "p", name: "س", employee_id: "e1", role_kind: "employee_partner",
      capital_share: 0, is_active: true, start_date: "2026-11-01", notes: null, initial_capital: 0 } as any);
    expect(back).toMatchObject({ operating_on: true, operating_percent: "10", salary_percent: "5", salary_base: "branch" });
  });
  it("says how he is paid", () => {
    expect(salaryText({ role_kind: "employee_partner", salary_mode: "percent", salary_amount: 0, salary_percent: 0.05, salary_base: "company", salary_when: "before" }))
      .toBe("5% من صافي ربح الشركة (قبل حصص التشغيل)");
    expect(salaryText({ role_kind: "partner", salary_mode: "none", salary_amount: 0, salary_percent: 0, salary_base: "company", salary_when: "before" })).toBe("مالوش مرتب");
  });
});

describe("profitShares — the % on each card", () => {
  const card = (id: string, capital: number, capital_share: number, is_active = true) =>
    ({ partner: { id, capital_share, is_active }, capital } as any);

  it("follows the capital when anybody has capital: 5M + 5M → 50% / 50%", () => {
    const s = profitShares([card("a", 5_000_000, 0), card("b", 5_000_000, 1)]);
    expect(s.a).toEqual({ share: 0.5, fromCapital: true });
    expect(s.b).toEqual({ share: 0.5, fromCapital: true });
  });

  it("6M of 11M → 54.55%", () => {
    const s = profitShares([card("a", 6_000_000, 0), card("b", 5_000_000, 0)]);
    expect(pct(s.a.share)).toBe("54.55%");
  });

  it("no capital recorded yet → 0% for everybody, flagged (the distribution splits by capital only)", () => {
    const s = profitShares([card("a", 0, 0), card("b", 0, 1)]);
    expect(s.b).toEqual({ share: 0, fromCapital: false });
    expect(s.a).toEqual({ share: 0, fromCapital: false });
  });

  it("a stopped partner takes no share", () => {
    const s = profitShares([card("a", 5_000_000, 0.5), card("b", 5_000_000, 0.5, false)]);
    expect(s.a.share).toBe(1);
    expect(s.b.share).toBe(0);
  });
});

describe("payExample — fixed → % → the rest by capital (the owner's examples)", () => {
  const m = { id: "m", name: "محمد ناصر", share: 0.5, rule: { fixed: 10000, percent: 0.1, base: "after_fixed" as const } };
  const n = { id: "n", name: "الحاج ناصر", share: 0.5, rule: null };

  it("300,000: محمد 10,000 + 29,000 + 130,500 = 169,500 — الحاج ناصر 130,500", () => {
    const e = payExample(300000, [m, n]);
    expect(e.byId.m).toMatchObject({ fixed: 10000, percent: 29000, capital: 130500, total: 169500 });
    expect(e.byId.n).toMatchObject({ fixed: 0, percent: 0, capital: 130500, total: 130500 });
    expect(e.left).toBe(261000);
  });

  it("% of the WHOLE profit when chosen: 30,000", () => {
    const e = payExample(300000, [{ ...m, rule: { ...m.rule, base: "all" } }, n]);
    expect(e.byId.m.percent).toBe(30000);
    expect(e.left).toBe(260000);
  });

  it("a loss month −50,000: the fixed is paid, the % is 0, −60,000 split −30,000 each", () => {
    const e = payExample(-50000, [m, n]);
    expect(e.byId.m).toMatchObject({ fixed: 10000, percent: 0, capital: -30000, total: -20000 });
    expect(e.byId.n.capital).toBe(-30000);
  });
});

describe("payRuleText", () => {
  it("says what he takes in words", () => {
    expect(payRuleText(null)).toBe("مالوش مرتب");
    expect(payRuleText({ fixed: 10000, percent: 0, base: "all" })).toBe(`مرتب ثابت ${formatEGP(10000)}`);
    expect(payRuleText({ fixed: 0, percent: 0.1, base: "all" })).toBe("10% من الربح كله");
    expect(payRuleText({ fixed: 10000, percent: 0.1, base: "after_fixed" })).toBe(`مرتب ثابت ${formatEGP(10000)} + 10% من الربح بعد المرتبات الثابتة`);
  });
});
