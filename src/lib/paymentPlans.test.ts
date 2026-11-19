import { describe, expect, it } from "vitest";
import { planPayments } from "./paymentPlans";

describe("planPayments — the money sent with a purchase invoice (0274)", () => {
  it("credit: nothing", () => {
    expect(planPayments({ mode: "credit", paidNow: 500, splits: [], method: null } as any)).toEqual([]);
  });
  it("one method", () => {
    expect(planPayments({ mode: "cash", paidNow: 1000, splits: [], method: { method: "cash", fee_amount: 0 } } as any))
      .toEqual([expect.objectContaining({ method: "cash", amount: 1000 })]);
  });
  it("several methods, zero rows dropped", () => {
    const out = planPayments({ mode: "partial", paidNow: 1500, method: null,
      splits: [{ method: "cash", amount: 1000 }, { method: "vodafone", amount: 500, transfer_from_account: "010" }, { method: "bank", amount: 0 }] } as any);
    expect(out.map((p) => [p.method, p.amount])).toEqual([["cash", 1000], ["vodafone", 500]]);
  });
});
