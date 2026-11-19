import { describe, it, expect } from "vitest";
import { payTypeOf, payTypeText, payTypeProblem, payTypePatch, filterByPayType } from "./payType";

const fmt = (n: number) => `${n} ج.م`;

describe("payType (0270)", () => {
  it("an employee with nothing set is monthly", () => {
    expect(payTypeOf({})).toBe("monthly");
    expect(payTypeOf({ pay_type: "daily" })).toBe("daily");
  });
  it("shows the daily wage next to a daily worker", () => {
    expect(payTypeText({ pay_type: "daily", daily_wage: 200 }, fmt)).toBe("يومي — 200 ج.م في اليوم");
    expect(payTypeText({ pay_type: "daily" }, fmt)).toBe("يومي — أجر اليوم مش متسجل");
    expect(payTypeText({ pay_type: "monthly", daily_wage: 200 }, fmt)).toBe("شهري");
  });
  it("a daily worker needs a wage above zero", () => {
    expect(payTypeProblem("daily", "")).not.toBeNull();
    expect(payTypeProblem("daily", "0")).not.toBeNull();
    expect(payTypeProblem("daily", "150")).toBeNull();
    expect(payTypeProblem("monthly", "")).toBeNull();
  });
  it("saves the wage only for a daily worker", () => {
    expect(payTypePatch("daily", "150.555")).toEqual({ pay_type: "daily", daily_wage: 150.56 });
    expect(payTypePatch("monthly", "150")).toEqual({ pay_type: "monthly" });
  });
  it("filters the list by pay type", () => {
    const rows = [{ id: 1, pay_type: "daily" }, { id: 2, pay_type: "monthly" }, { id: 3 }];
    expect(filterByPayType(rows, "daily").map((r) => r.id)).toEqual([1]);
    expect(filterByPayType(rows, "monthly").map((r) => r.id)).toEqual([2, 3]);
    expect(filterByPayType(rows, null)).toHaveLength(3);
  });
});
