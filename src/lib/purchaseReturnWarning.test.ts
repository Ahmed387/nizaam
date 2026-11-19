import { describe, expect, it } from "vitest";
import { onAccountWarning } from "./purchaseReturnWarning";

describe("مرتجع شراء «على حساب المورد» — تنبيه قبل الحفظ (owner 2026-11-19)", () => {
  it("we owe him nothing: he becomes مدين لكم by the whole on-account part", () => {
    expect(onAccountWarning(2000, 0)).toBe("المورد هيبقى مدين لكم 2,000 — متأكد؟");
  });
  it("we owe him less than the on-account part: only the excess", () => {
    expect(onAccountWarning(2000, 500)).toBe("المورد هيبقى مدين لكم 1,500 — متأكد؟");
  });
  it("he already owes us (negative): the whole part", () => {
    expect(onAccountWarning(2000, -300)).toBe("المورد هيبقى مدين لكم 2,000 — متأكد؟");
  });
  it("we owe him at least that much: no question", () => {
    expect(onAccountWarning(2000, 4000)).toBeNull();
    expect(onAccountWarning(2000, 2000)).toBeNull();
  });
  it("nothing on account (cash / transfer): no question", () => {
    expect(onAccountWarning(0, 0)).toBeNull();
  });
});
