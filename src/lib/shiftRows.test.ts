import { describe, expect, it } from "vitest";
import { closedTotals, openingDiff, shiftFigures, shortDateTime } from "./shiftRows";

// the two real shifts of 2026-11-15 (سكة)
const closed = { status: "closed", opening_cash: 0, cash_sales: 0, expected_cash: 0, closing_cash: 0, variance: 0, reported_opening_cash: 0, expected_opening_cash: 0 };
const open = { status: "open", opening_cash: 3900, cash_sales: null, expected_cash: null, closing_cash: null, variance: null, reported_opening_cash: 3900, expected_opening_cash: 0 };

describe("shiftFigures", () => {
  it("an open shift shows the live cash sales / expected and no actual / difference", () => {
    expect(shiftFigures(open, { cash_sales: 4100, cash_movement: 8000, expected_cash: 11900 }))
      .toEqual({ live: true, cash_sales: 4100, expected_cash: 11900, closing_cash: null, variance: null });
  });
  it("an open shift before the live numbers arrive shows nothing", () => {
    expect(shiftFigures(open, null)).toMatchObject({ cash_sales: null, expected_cash: null });
  });
  it("a closed shift keeps its stored numbers", () => {
    expect(shiftFigures({ ...closed, cash_sales: 500, expected_cash: 500, closing_cash: 480, variance: -20 }))
      .toEqual({ live: false, cash_sales: 500, expected_cash: 500, closing_cash: 480, variance: -20 });
  });
});

describe("openingDiff", () => {
  it("counted − expected", () => expect(openingDiff(open)).toBe(3900));
  it("nothing counted → null", () => expect(openingDiff({ ...open, reported_opening_cash: null })).toBeNull());
});

describe("closedTotals", () => {
  it("leaves the open shift out", () => {
    const t = closedTotals([open, { ...closed, opening_cash: 100, cash_sales: 500, expected_cash: 600, closing_cash: 580, variance: -20 }]);
    expect(t).toMatchObject({ count: 1, open: 1, opening_cash: 100, cash_sales: 500, expected_cash: 600, closing_cash: 580, variance: -20 });
  });
});

it("short date: day/month — time, Cairo", () => {
  expect(shortDateTime("2026-11-14T13:25:58Z")).toMatch(/^14\/11 — /);
  expect(shortDateTime(null)).toBe("—");
});
