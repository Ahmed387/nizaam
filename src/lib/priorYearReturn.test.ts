import { describe, it, expect } from "vitest";
import { pyrProblem, pyrTotals } from "./priorYearReturn";

describe("special return of a pre-2026 invoice (0145)", () => {
  const fan = { product_id: "p1", name: "مروحة", quantity: 1, price: 1500, cost: 1200 };
  it("price 1,500, cost 1,200 → 300 against previous years", () => {
    expect(pyrTotals([fan])).toEqual({ price: 1500, cost: 1200, priorYears: 300, lines: 1 });
  });
  it("checks what was typed", () => {
    expect(pyrProblem([], "refund", null, "2026-11-05")).toBe("ضيف صنف واحد على الأقل");
    expect(pyrProblem([fan], null, null, "2026-11-05")).toContain("اختار");
    expect(pyrProblem([fan], "account", null, "2026-11-05")).toContain("اسم العميل");
    expect(pyrProblem([fan], "refund", null, "2025-12-31")).toContain("2026");
    expect(pyrProblem([fan], "refund", null, "2026-11-05")).toBeNull();
  });
});
