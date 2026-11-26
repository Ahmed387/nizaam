import { describe, expect, it } from "vitest";
import { addPartner, finalLines, setAmount, setPct, splitProblem, splitTotals, spreadRest, suggestedRows, type SplitPreview } from "./periodSplit";

// the owner's example: 600,000 available; محمد 340,000 / أحمد 226,667 / إبراهيم 33,333
const P: SplitPreview = {
  from: "2026-01-01", to: "2026-03-31", net_profit: 600000, already: 0, available: 600000, pay_missing: false,
  partners: [
    { partner_id: "m", name: "محمد", capital_start: 3e6, capital_end: 3e6, suggested: 340000 / 600000, in_period: true, advances: 0 },
    { partner_id: "a", name: "أحمد", capital_start: 2e6, capital_end: 2e6, suggested: 226666.67 / 600000, in_period: true, advances: 0 },
    { partner_id: "i", name: "إبراهيم", capital_start: 0, capital_end: 1e6, suggested: 33333.33 / 600000, in_period: true, advances: 20000 },
    { partner_id: "x", name: "شريك جديد", capital_start: 0, capital_end: 0, suggested: 0, in_period: false, advances: 0 },
  ],
};

describe("period split (owner example)", () => {
  it("suggested amounts add up to the available, partners with no capital are left out", () => {
    const rows = suggestedRows(P);
    expect(rows.map((r) => r.partner_id)).toEqual(["m", "a", "i"]);
    expect(splitTotals(rows, 600000).exact).toBe(true);
    expect(rows[0].amount).toBe(340000);
  });
  it("10% for إبراهيم → 60,000; the others don't move; 26,667 over", () => {
    let rows = setPct(suggestedRows(P), "i", 0.1, 600000);
    expect(rows.find((r) => r.partner_id === "i")!.amount).toBe(60000);
    expect(rows.find((r) => r.partner_id === "m")!.amount).toBe(340000);
    const t = splitTotals(rows, 600000);
    expect(t.over).toBe(true);
    expect(t.rest).toBeCloseTo(-26666.67, 2);
    rows = setAmount(rows, "m", 313333.33, 600000);
    expect(splitTotals(rows, 600000).exact).toBe(true);
    expect(rows.find((r) => r.partner_id === "m")!.pct).toBeCloseTo(0.5222, 4);
  });
  it("a remainder: keep sends the typed amounts, spread scales them to the whole available", () => {
    let rows = suggestedRows(P);
    rows = setAmount(rows, "m", 250000, 600000);
    rows = setAmount(rows, "a", 200000, 600000);
    rows = setAmount(rows, "i", 50000, 600000);
    expect(splitTotals(rows, 600000).rest).toBe(100000);
    expect(finalLines(rows, 600000, "keep").reduce((s, l) => s + l.amount, 0)).toBe(500000);
    const spread = finalLines(rows, 600000, "spread");
    expect(spread.reduce((s, l) => s + l.amount, 0)).toBe(600000);
    expect(spread.find((l) => l.partner_id === "m")!.amount).toBe(300000);   // 250 × 6/5
    expect(spreadRest(rows, 600000).find((r) => r.partner_id === "i")!.amount).toBe(60000);
  });
  it("add a partner with no capital at 0; zero lines are not sent", () => {
    const rows = addPartner(suggestedRows(P), P.partners[3]);
    expect(rows).toHaveLength(4);
    expect(finalLines(rows, 600000, "keep").some((l) => l.partner_id === "x")).toBe(false);
    expect(addPartner(rows, P.partners[3])).toHaveLength(4);
  });
  it("the button stays closed with a reason", () => {
    expect(splitProblem({ ...P, pay_missing: true }, suggestedRows(P), null)).toContain("خطوة 1");
    expect(splitProblem({ ...P, available: 0 }, [], null)).toContain("مفيش ربح");
    expect(splitProblem(P, setPct(suggestedRows(P), "i", 0.2, 600000), "keep")).toContain("أكبر من المتاح");
    expect(splitProblem(P, setAmount(suggestedRows(P), "m", 0, 600000), null)).toContain("الباقي");
    expect(splitProblem(P, setAmount(suggestedRows(P), "m", 0, 600000), "keep")).toBeNull();
    expect(splitProblem(P, suggestedRows(P), null)).toBeNull();
  });
});
