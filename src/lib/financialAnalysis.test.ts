import { describe, expect, it } from "vitest";
import { balanceOf, change, daysIn, incomeOf, isStatementTab, previousPeriod, ratiosOf, share, type Analysis } from "./financialAnalysis";

describe("previousPeriod", () => {
  it("a whole month → the whole month before", () => {
    expect(previousPeriod("2026-10-01", "2026-10-31")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousPeriod("2026-03-01", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("whole months → the same number of months before", () => {
    expect(previousPeriod("2026-07-01", "2026-09-30")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });
  it("any other period → the same number of days ending the day before", () => {
    expect(previousPeriod("2026-11-01", "2026-11-15")).toEqual({ from: "2026-10-17", to: "2026-10-31" });
    expect(daysIn("2026-10-17", "2026-10-31")).toBe(15);
  });
});

// October 2026, company, from the dry-run of migration 0227 (= profit_statement_core to the piaster)
const OCT: Analysis = {
  cur: { from: "2026-10-01", to: "2026-10-31" }, cmp: { from: "2026-09-01", to: "2026-09-30" },
  pl: {
    cur: { sales: 9145432.10, returns: 276858.96, cogs: 8752027.38, expenses: 54661.85, other_income: 1035, count_diff: 0 },
    cmp: { sales: 8000000, returns: 100000, cogs: 7700000, expenses: 60000, other_income: 0, count_diff: 0 },
  },
  bal: {
    cur_end: { cash: 1618512.54, receivables: 8597468.16, inventory: 5585156.29, other_current: 100, fixed_net: 0, other_assets: 0,
               payables: 9223677.05, other_liabilities: 0, equity_accounts: 6038970.65, profit_to_date: 538589.29 },
    cur_start: { cash: 1422602.40, receivables: 7842556.85, inventory: 6462233.36, other_current: 100, fixed_net: 0, other_assets: 0,
                 payables: 9212887.74, other_liabilities: 0, equity_accounts: 6038934.49, profit_to_date: 475670.38 },
    cmp_end: { cash: 1422602.40, receivables: 7842556.85, inventory: 6462233.36, other_current: 100, fixed_net: 0, other_assets: 0,
               payables: 9212887.74, other_liabilities: 0, equity_accounts: 6038934.49, profit_to_date: 475670.38 },
    cmp_start: { cash: 1546978.39, receivables: 8624274.32, inventory: 6276416.59, other_current: 100, fixed_net: 0, other_assets: 0,
                 payables: 10036065.27, other_liabilities: 0, equity_accounts: 6041589.49, profit_to_date: 370114.54 },
  },
  months: [],
};

describe("incomeOf / balanceOf", () => {
  it("income lines like قائمة الدخل (October: net profit 62,918.91)", () => {
    const i = incomeOf(OCT.pl.cur);
    expect(i.net_sales).toBeCloseTo(8868573.14, 2);
    expect(i.gross_profit).toBeCloseTo(116545.76, 2);
    expect(i.net_profit).toBeCloseTo(62918.91, 2);
  });
  it("the balance balances (assets = liabilities + equity) on every date of the dry-run", () => {
    for (const k of ["cur_end", "cur_start", "cmp_end", "cmp_start"] as const) {
      const b = balanceOf(OCT.bal[k]);
      expect(b.total_assets).toBeCloseTo(b.total_liab_equity, 2);
    }
  });
});

describe("ratiosOf", () => {
  const r = Object.fromEntries(ratiosOf(OCT).map((x) => [x.key, x]));
  it("gross margin of October ≈ 1.3 % → «محتاج انتباه»", () => {
    expect(r.gross_margin.cur).toBeCloseTo((116545.76 / 8868573.14) * 100, 4);
    expect(r.gross_margin.verdict).toBe("watch");
  });
  it("current ratio = current assets ÷ liabilities at the end", () => {
    const b = balanceOf(OCT.bal.cur_end);
    expect(r.current_ratio.cur).toBeCloseTo(b.current_assets / b.current_liabilities, 6);
  });
  it("inventory days use the average stock and the days of the period", () => {
    const avgInv = (6462233.36 + 5585156.29) / 2;
    expect(r.inventory_days.cur).toBeCloseTo(31 / (8752027.38 / avgInv), 6);
  });
  it("every ratio carries meaning, formula and a verdict", () => {
    for (const x of Object.values(r)) {
      expect(x.meaning.length).toBeGreaterThan(5);
      expect(x.formula).toMatch(/÷/);
      expect(["good", "watch", "bad", "none"]).toContain(x.verdict);
    }
  });
  it("no sales → «—» and no verdict, never a division by zero", () => {
    const empty = ratiosOf({ ...OCT, pl: {}, bal: { cur_end: {}, cur_start: {}, cmp_end: {}, cmp_start: {} } });
    for (const x of empty) { expect(x.cur).toBeNull(); expect(x.verdict).toBe("none"); }
  });
});

describe("change / share / tabs", () => {
  it("change in amount and %, null % on a zero base", () => {
    expect(change(150, 100)).toEqual({ diff: 50, pct: 50 });
    expect(change(-50, -100).pct).toBe(50);
    expect(change(10, 0).pct).toBeNull();
  });
  it("share of a base", () => {
    expect(share(25, 200)).toBe(12.5);
    expect(share(1, 0)).toBeNull();
  });
  it("tab names from the address", () => {
    expect(isStatementTab("analysis")).toBe(true);
    expect(isStatementTab("trial")).toBe(false);
  });
});
