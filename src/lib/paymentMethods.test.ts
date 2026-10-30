import { describe, expect, it } from "vitest";
import { calculateFee, isVirtualMethod, methodRequiresReference, vesselTransferFee, type TransferFee } from "./paymentMethods";

const fees: TransferFee[] = [
  { payment_method: "instapay", fee_type: "percentage", fee_value: 1.5, is_enabled: true, kind: "wallet" },
  { payment_method: "paymob", label: "PayMob", fee_type: "fixed", fee_value: 10, is_enabled: true, kind: "wallet" },
  { payment_method: "company_offers", label: "خصومات / عروض الشركات", fee_type: "fixed", fee_value: 50, is_enabled: true, kind: "virtual" },
];

describe("vessels (0139)", () => {
  it("a fee appears for any real vessel, fixed or %", () => {
    expect(calculateFee("instapay", 10000, fees)).toBe(150);
    expect(calculateFee("paymob", 10000, fees)).toBe(10);
    expect(calculateFee("cash", 10000, fees)).toBe(0);
  });
  it("a book vessel («خصومات / عروض الشركات») has no fee and needs no transfer number", () => {
    expect(isVirtualMethod("company_offers", fees)).toBe(true);
    expect(calculateFee("company_offers", 10000, fees)).toBe(0);
    expect(methodRequiresReference("company_offers", fees)).toBe(false);
    expect(methodRequiresReference("paymob", fees)).toBe(true);
    expect(methodRequiresReference("cash", fees)).toBe(false);
  });
  it("transfer between vessels: none / fixed / % (same as the server)", () => {
    expect(vesselTransferFee(10000, "none", 5)).toBe(0);
    expect(vesselTransferFee(10000, "fixed", 25)).toBe(25);
    expect(vesselTransferFee(10000, "percent", 1)).toBe(100);
    expect(vesselTransferFee(572, "percent", 1.5)).toBe(8.58);
  });
});
