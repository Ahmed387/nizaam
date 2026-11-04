import { describe, expect, it } from "vitest";
import { followUpItems, followUpSummary, type FollowUps } from "./followUps";

const base: FollowUps = {
  month_from: "2026-11-01", month_to: "2026-11-04", approvals_pending: 0, money_transfers_pending: { count: 0, amount: 0 },
  stock_transfers_pending: 0, other_income_month: 0, count_diff_month: 0, internal_sales_month: { count: 0, amount: 0 },
  partner_advances: { count: 0, amount: 0 }, period_shares_missing: null,
};

describe("«متابعة» cards", () => {
  it("nothing waiting → no card asks for attention, the stock card is hidden", () => {
    const items = followUpItems(base);
    expect(items.some((i) => i.attention)).toBe(false);
    expect(items.map((i) => i.key)).not.toContain("stock");
  });
  it("waiting things are marked and summed in one line", () => {
    const d = { ...base, approvals_pending: 2, money_transfers_pending: { count: 1, amount: 15000 }, partner_advances: { count: 1, amount: 50000 },
      period_shares_missing: { from: "2026-10-01", to: "2026-10-31" } };
    const items = followUpItems(d);
    expect(items.find((i) => i.key === "approvals")?.attention).toBe(true);
    expect(items.find((i) => i.key === "money")?.value).toBe(15000);
    expect(items.find((i) => i.key === "shares")?.hint).toBe("فترة 2026-10-01 → 2026-10-31");
    expect(followUpSummary(d)).toMatch(/^2 طلب موافقة • /);
  });
  it("a count difference needs a look, other income does not", () => {
    const items = followUpItems({ ...base, count_diff_month: 259036, other_income_month: 1250 });
    expect(items.find((i) => i.key === "count_diff")?.attention).toBe(true);
    expect(items.find((i) => i.key === "other_income")?.attention).toBe(false);
  });
});
