import { describe, expect, it } from "vitest";
import { amountsOf, moveProblem, openingProblem, setupPayload, emptyMove } from "./partnerCapitalSetup";

const partners = [{ id: "a", name: "محمد" }, { id: "b", name: "ناصر" }];

describe("amountsOf", () => {
  it("amounts stay as typed", () => {
    expect(amountsOf("amount", { a: "3000000", b: "1000000" }, 4845828.43)).toEqual({ a: 3000000, b: 1000000 });
  });
  it("percent of the net worth, rounded to the piaster", () => {
    expect(amountsOf("percent", { a: "60", b: "40" }, 4845828.43)).toEqual({ a: 2907497.06, b: 1938331.37 });
  });
  it("empty means zero", () => {
    expect(amountsOf("amount", { a: "" }, 100)).toEqual({ a: 0 });
  });
});

describe("openingProblem", () => {
  it("refuses a total above the net worth", () => {
    expect(openingProblem({ a: 4000000, b: 900000 }, 4845828.43)).toMatch(/أكبر من صافي الملك/);
  });
  it("refuses a negative amount", () => {
    expect(openingProblem({ a: -1 }, 100)).toMatch(/بالسالب/);
  });
  it("needs at least one amount", () => {
    expect(openingProblem({ a: 0, b: 0 }, 100)).toMatch(/اكتب/);
  });
  it("accepts up to the net worth", () => {
    expect(openingProblem({ a: 4845828.43 }, 4845828.43)).toBeNull();
  });
});

describe("moveProblem", () => {
  const ok = { ...emptyMove("2026-11-19"), partner_id: "a", branch_id: "br", amount: "100", date: "2026-03-01" };
  it("a good cash move passes", () => {
    expect(moveProblem(ok, "2026-01-01", "2026-11-19")).toBeNull();
  });
  it("a supplier move needs the supplier", () => {
    expect(moveProblem({ ...ok, kind: "supplier" }, "2026-01-01", "2026-11-19")).toMatch(/المورد/);
  });
  it("before the books' first day is refused", () => {
    expect(moveProblem({ ...ok, date: "2025-12-31" }, "2026-01-01", "2026-11-19")).toMatch(/قبل بداية الدفاتر/);
  });
  it("a future day is refused", () => {
    expect(moveProblem({ ...ok, date: "2026-12-01" }, "2026-01-01", "2026-11-19")).toMatch(/المستقبل/);
  });
  it("needs partner, branch and amount", () => {
    expect(moveProblem({ ...ok, partner_id: "" }, "2026-01-01", "2026-11-19")).toMatch(/الشريك/);
    expect(moveProblem({ ...ok, branch_id: "" }, "2026-01-01", "2026-11-19")).toMatch(/الفرع/);
    expect(moveProblem({ ...ok, amount: "0" }, "2026-01-01", "2026-11-19")).toMatch(/المبلغ/);
  });
});

describe("setupPayload", () => {
  it("sends every partner's amount and the moves as the server wants them", () => {
    const p = setupPayload(partners, { a: 3000000, b: 1000000 }, [
      { ...emptyMove("2026-11-19"), kind: "supplier", partner_id: "b", branch_id: "br", amount: "50000", date: "2026-03-02", supplier_id: "s" },
    ], true);
    expect(p).toEqual({
      p_openings: [{ partner_id: "a", amount: 3000000 }, { partner_id: "b", amount: 1000000 }],
      p_moves: [{ kind: "supplier", partner_id: "b", branch_id: "br", amount: 50000, date: "2026-03-02", supplier_id: "s", method: "cash", notes: null }],
      p_apply: true,
    });
  });
});
