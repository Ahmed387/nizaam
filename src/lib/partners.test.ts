import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import {
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
