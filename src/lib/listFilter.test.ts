import { describe, expect, it } from "vitest";
import { amountIn, anyAmountIn, dayIn, hasAny, searchHas } from "./listFilter";
import { EMPTY_DOCUMENT_FILTERS } from "@/components/documents/UnifiedDocumentFilters";

describe("listFilter", () => {
  it("dayIn: empty range lets everything through, a timestamp counts by its day", () => {
    expect(dayIn(null, "", "")).toBe(true);
    expect(dayIn("2026-11-05T22:00:00+00:00", "2026-11-01", "2026-11-05")).toBe(true);
    expect(dayIn("2026-10-31", "2026-11-01", "")).toBe(false);
    expect(dayIn("2026-11-06", "", "2026-11-05")).toBe(false);
    expect(dayIn("", "2026-11-01", "")).toBe(false);
  });
  it("amountIn: from / to inclusive, half-open ranges", () => {
    expect(amountIn(15000, "10000", "20000")).toBe(true);
    expect(amountIn(10000, "10000", "")).toBe(true);
    expect(amountIn(9999, "10000", "")).toBe(false);
    expect(amountIn(25000, "", "20000")).toBe(false);
    expect(amountIn(null, "", "")).toBe(true);
    expect(amountIn(null, "1", "")).toBe(false);
  });
  it("anyAmountIn: a session matches when ONE item cost is in range", () => {
    expect(anyAmountIn([500, 15000], "10000", "20000")).toBe(true);
    expect(anyAmountIn([500, 900], "10000", "20000")).toBe(false);
    expect(anyAmountIn([], "", "")).toBe(true);
  });
  it("searchHas: every word, any order, ة = ه", () => {
    expect(searchHas(["VT00012", "ثلاجة توشيبا"], "توشيبا ثلاجه")).toBe(true);
    expect(searchHas(["VT00012"], "vt00012")).toBe(true);
    expect(searchHas(["VT00012"], "VT00013")).toBe(false);
    expect(searchHas([null], "")).toBe(true);
  });
  it("hasAny", () => {
    expect(hasAny(EMPTY_DOCUMENT_FILTERS)).toBe(false);
    expect(hasAny({ ...EMPTY_DOCUMENT_FILTERS, amountMin: "5" })).toBe(true);
  });
});

import { productPrice } from "./listFilter";
describe("productPrice", () => {
  it("sell by default, buy = average cost else cost price — never the total", () => {
    const p = { selling_price: 18000, avg_cost: 15000, cost_price: 14000, quantity: 3 };
    expect(productPrice(p, "")).toBe(18000);
    expect(productPrice(p, "sell")).toBe(18000);
    expect(productPrice(p, "buy")).toBe(15000);
    expect(productPrice({ ...p, avg_cost: 0 }, "buy")).toBe(14000);
  });
});
