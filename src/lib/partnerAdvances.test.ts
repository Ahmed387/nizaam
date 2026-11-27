import { describe, expect, it } from "vitest";
import { advanceLimitProblem, cancellableRepay, monthsToRepay, repayProblem } from "@/lib/partners";

describe("partner advances (0296)", () => {
  it("limit: refused only when the open advances + the new one pass it", () => {
    expect(advanceLimitProblem(null, 60000, 20000)).toBeNull();
    expect(advanceLimitProblem(70000, 60000, 10000)).toBeNull();
    expect(advanceLimitProblem(70000, 60000, 20000)).toContain("حد السلفة");
    expect(advanceLimitProblem(70000, 60000, 0)).toBeNull();
  });
  it("«تتسد إزاي؟»: salary needs an employee and an instalment not above the rest", () => {
    expect(repayProblem("profit", 0, 50000, false)).toBeNull();
    expect(repayProblem("salary", 5000, 50000, false)).toContain("مش موظف");
    expect(repayProblem("both", 0, 50000, true)).toContain("القسط");
    expect(repayProblem("salary", 60000, 50000, true)).toContain("أكبر");
    expect(repayProblem("salary", 5000, 50000, true)).toBeNull();
  });
  it("months to finish", () => {
    expect(monthsToRepay(50000, 5000)).toBe(10);
    expect(monthsToRepay(30000, 7000)).toBe(5);
    expect(monthsToRepay(30000, 0)).toBe(0);
  });
  it("only cash / capital payments are cancelled from the partner page", () => {
    const base = { id: "x", amount: 1, date: "2026-11-01", ref_type: "treasury", ref: "t", status: "active" };
    expect(cancellableRepay({ ...base, method: "cash_till" })).toBe(true);
    expect(cancellableRepay({ ...base, method: "capital" })).toBe(true);
    expect(cancellableRepay({ ...base, method: "salary" })).toBe(false);
    expect(cancellableRepay({ ...base, method: "profit_deduction" })).toBe(false);
    expect(cancellableRepay({ ...base, method: "cash_till", status: "cancelled" })).toBe(false);
  });
});
