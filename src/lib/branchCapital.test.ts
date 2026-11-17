import { describe, it, expect } from "vitest";
import { capitalOfBranch, capitalKindLabel, capitalProblem, vesselBalance } from "./branchCapital";

const PC = "partners";
const rows = [
  { branch_id: "A", from_branch_id: PC, amount: 100000, kind: "allocate" },
  { branch_id: PC, from_branch_id: "A", amount: 30000, kind: "return" },
  { branch_id: "B", from_branch_id: "A", amount: 20000, kind: "move" },
];

describe("branch capital", () => {
  it("a branch's capital = what came in minus what went out", () => {
    expect(capitalOfBranch(rows, "A")).toBe(50000);
    expect(capitalOfBranch(rows, "B")).toBe(20000);
    expect(capitalOfBranch(rows, "C")).toBe(0);
  });

  it("an old row with no source counts as from the partners' treasury", () => {
    expect(capitalOfBranch([{ branch_id: "A", from_branch_id: null, amount: 7, kind: "allocate" }], "A")).toBe(7);
  });

  it("names each movement", () => {
    expect(capitalKindLabel("allocate")).toBe("تحويل رأس مال");
    expect(capitalKindLabel("return")).toBe("رجوع لخزينة الشركاء");
    expect(capitalKindLabel("move")).toBe("نقل لفرع تاني");
  });

  it("sums a vessel's balance from till rows", () => {
    const t = [
      { type: "income", amount: 500, payment_method: "vodafone" },
      { type: "expense", amount: 200, payment_method: "vodafone" },
      { type: "income", amount: 900, payment_method: null },
    ];
    expect(vesselBalance(t, "vodafone")).toBe(300);
    expect(vesselBalance(t, "cash")).toBe(900);
  });
});

describe("capitalProblem", () => {
  const ok = { from: "A", to: "partners", amount: 1000, capital: 50000, balance: 60000, needsAccounts: false,
               fromAccount: "", toAccount: "", fromIsPartners: false };
  it("passes a valid return", () => { expect(capitalProblem(ok)).toBeNull(); });
  it("needs a branch, a destination and an amount", () => {
    expect(capitalProblem({ ...ok, from: "" })).toMatch("اختار الفرع");
    expect(capitalProblem({ ...ok, to: "" })).toMatch("رايح فين");
    expect(capitalProblem({ ...ok, amount: 0 })).toMatch("المبلغ");
  });
  it("refuses the same place on both sides", () => {
    expect(capitalProblem({ ...ok, to: "A" })).toMatch("مختلفين");
  });
  it("refuses more than the branch's capital (capital only)", () => {
    expect(capitalProblem({ ...ok, amount: 60000 })).toMatch("50,000");
  });
  it("does not cap the partners' treasury by capital, only by its balance", () => {
    expect(capitalProblem({ ...ok, from: "partners", to: "A", fromIsPartners: true, capital: 0, amount: 1000 })).toBeNull();
    expect(capitalProblem({ ...ok, from: "partners", to: "A", fromIsPartners: true, amount: 70000 })).toMatch("المتاح");
  });
  it("refuses more than the vessel holds", () => {
    expect(capitalProblem({ ...ok, capital: 900000, amount: 70000 })).toMatch("60,000");
  });
  it("requires both accounts on a vessel that has accounts", () => {
    expect(capitalProblem({ ...ok, needsAccounts: true, toAccount: "0100" })).toMatch("هيتحول منه");
    expect(capitalProblem({ ...ok, needsAccounts: true, fromAccount: "0100" })).toMatch("هيوصل عليه");
    expect(capitalProblem({ ...ok, needsAccounts: true, fromAccount: "0100", toAccount: "0101" })).toBeNull();
  });
});
