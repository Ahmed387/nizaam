import { describe, expect, it } from "vitest";
import { balanceFiltersFor, dropZero } from "./hideZero";

describe("«استبعاد الصفر» (owner 2026-11-15)", () => {
  it("contacts: box on and no chip → مدين + دائن only; a chosen chip wins; box off → as chosen", () => {
    expect(balanceFiltersFor([], true)).toEqual(["debit", "credit"]);
    expect(balanceFiltersFor(["zero"], true)).toEqual(["zero"]);
    expect(balanceFiltersFor(["debit"], true)).toEqual(["debit"]);
    expect(balanceFiltersFor([], false)).toEqual([]);
  });
  it("rows: zero (±0.005) out, negatives stay, explicit zero choice keeps them", () => {
    const rows = [{ q: 0 }, { q: -1 }, { q: 3 }, { q: 0.004 }];
    expect(dropZero(rows, true, (r) => r.q).map((r) => r.q)).toEqual([-1, 3]);
    expect(dropZero(rows, true, (r) => r.q, true)).toHaveLength(4);
    expect(dropZero(rows, false, (r) => r.q)).toHaveLength(4);
  });
});
