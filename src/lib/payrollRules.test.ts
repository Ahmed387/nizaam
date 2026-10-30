import { describe, expect, it } from "vitest";
import { advancesOwed, canCancelAdvance } from "./payrollRules";

describe("cancel-only advances (0138)", () => {
  it("an untouched advance can be cancelled by the owner / manager only", () => {
    const a = { amount: 1000, remaining: 1000, status: "active" };
    expect(canCancelAdvance(a, true)).toBe(true);
    expect(canCancelAdvance(a, false)).toBe(false);
  });
  it("once a salary deducted from it, cancel the salary first", () => {
    expect(canCancelAdvance({ amount: 1000, remaining: 750, status: "active" }, true)).toBe(false);
  });
  it("a cancelled advance has no button and owes nothing", () => {
    const c = { amount: 1000, remaining: 0, status: "cancelled" };
    expect(canCancelAdvance(c, true)).toBe(false);
    expect(advancesOwed([c, { amount: 500, remaining: 250, status: "active" }])).toBe(250);
  });
  it("strings from the database are read as numbers", () => {
    expect(canCancelAdvance({ amount: "1000.00", remaining: "1000", status: null }, true)).toBe(true);
  });
});
