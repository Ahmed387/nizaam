import { describe, expect, it } from "vitest";
import { feeHint, feeOf } from "./paymentFee";

describe("feeOf", () => {
  it("cash never has a fee", () => {
    expect(feeOf("cash", 10000, "percent", 1)).toBe(0);
    expect(feeOf("cash", 10000, "fixed", 15)).toBe(0);
  });
  it("fixed / percent / none", () => {
    expect(feeOf("instapay", 10000, "fixed", 15)).toBe(15);
    expect(feeOf("instapay", 10000, "percent", 1)).toBe(100);
    expect(feeOf("instapay", 333, "percent", 0.5)).toBe(1.67);
    expect(feeOf("instapay", 10000, "none", 50)).toBe(0);
  });
  it("never negative", () => {
    expect(feeOf("vodafone", 100, "fixed", -5)).toBe(0);
    expect(feeOf("vodafone", 100, "percent", "")).toBe(0);
  });
});

describe("feeHint", () => {
  it("sale paid by InstaPay, fee on the company", () => {
    const t = feeHint({ fee: 100, amount: 10000, vessel: "انستاباي", direction: "in" });
    expect(t).toContain("9,900");
    expect(t).toContain("10,000 ج.م كاملة");
    expect(t).toContain("بيقلل ربح الشهر");
  });
  it("fee on the customer goes to other income", () => {
    const t = feeHint({ fee: 100, amount: 10000, vessel: "انستاباي", direction: "in", onCustomer: true });
    expect(t).toContain("10,100");
    expect(t).toContain("إيرادات أخرى");
  });
  it("paying a supplier", () => {
    const t = feeHint({ fee: 30, amount: 50000, vessel: "البنك", direction: "out", party: "المورد" });
    expect(t).toContain("50,030");
    expect(t).toContain("لـالمورد");
  });
  it("between branches: the fee stays if refused", () => {
    expect(feeHint({ fee: 15, amount: 20000, vessel: "انستاباي", direction: "both" })).toContain("العمولة بتفضل مصروف");
  });
  it("no fee", () => {
    expect(feeHint({ fee: 0, amount: 100, vessel: "x", direction: "in" })).toContain("مفيش عمولة");
  });
});
