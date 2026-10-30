import { describe, expect, it } from "vitest";
import { accountsOf, statementAddsUp, statementLines } from "./profitStatement";

// October 2026 as the books gave it after migration 0135 (real numbers of A & N)
const october = {
  sales: 138394.85, returns: 3400, net_sales: 134994.85, cogs: 116127.43, gross_profit: 18867.42,
  expenses: 0, operating_profit: 18867.42, other_income: 0, count_diff: 259035.5, net_profit: 277902.92,
};

describe("profit statement (0135)", () => {
  it("lists the lines in the owner's order with the right signs", () => {
    const lines = statementLines(october);
    expect(lines.map((l) => l.key)).toEqual([
      "sales", "returns", "net_sales", "cogs", "gross_profit", "expenses", "operating_profit", "other_income", "count_diff", "net_profit",
    ]);
    expect(lines.find((l) => l.key === "returns")!.op).toBe("−");
    expect(lines.find((l) => l.key === "other_income")!.op).toBe("+");
    expect(lines.find((l) => l.key === "count_diff")!.op).toBe("+");
    expect(lines.find((l) => l.key === "net_profit")!.op).toBe("=");
  });

  it("the count surplus is part of the net profit (the card used to miss it)", () => {
    expect(statementAddsUp(october)).toBe(true);
    expect(statementAddsUp({ ...october, count_diff: 0 })).toBe(false);
  });

  it("a shortage lowers the profit, other income raises it", () => {
    const t = { sales: 1000, returns: 0, cogs: 600, expenses: 100, other_income: 50, count_diff: -30, net_profit: 320 };
    expect(statementAddsUp(t)).toBe(true);
  });

  it("empty statement is zeros, not NaN", () => {
    const lines = statementLines(null);
    expect(lines.every((l) => l.value === 0)).toBe(true);
    expect(statementAddsUp(undefined)).toBe(true);
  });

  it("picks the accounts of one line", () => {
    const acc = [
      { code: "5200", name: "الرواتب", group: "expenses" as const, amount: 29500 },
      { code: "4200", name: "إيرادات أخرى", group: "other_income" as const, amount: 604 },
      { code: "5500", name: "مصروفات تشغيلية", group: "expenses" as const, amount: 14512 },
    ];
    expect(accountsOf(acc, "expenses").map((a) => a.code)).toEqual(["5200", "5500"]);
    expect(accountsOf(null, "expenses")).toEqual([]);
  });
});
