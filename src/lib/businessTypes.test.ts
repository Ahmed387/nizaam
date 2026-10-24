import { describe, it, expect } from "vitest";
import { BUSINESS_TYPES, DEFAULT_BUSINESS_TYPE, branchLabel, branchUsage, suggestPassword } from "./businessTypes";

describe("businessTypes", () => {
  it("default company type is the first in the list (A & N's type)", () => {
    expect(DEFAULT_BUSINESS_TYPE).toBe("أجهزة كهربائية — بيع وشراء");
    expect(BUSINESS_TYPES).toContain("صيدلية");
    expect(BUSINESS_TYPES).toContain("مطعم");
  });

  it("branchUsage shows used out of the limit, 3 when the limit is missing", () => {
    expect(branchUsage(2, 5)).toBe("2 من 5");
    expect(branchUsage(3, null)).toBe("3 من 3");
    expect(branchUsage(0, undefined)).toBe("0 من 3");
  });

  it("suggestPassword is strong enough for Supabase Auth and has no look-alike characters", () => {
    for (let i = 0; i < 200; i++) {
      const p = suggestPassword();
      expect(p).toMatch(/^Nz-[2-9][A-Za-z2-9]{4}-[A-Za-z2-9]{5}$/);
      expect(p.length).toBe(14);
      expect(p).toMatch(/[0-9]/);
      expect(p).not.toMatch(/[01ilIoO]/);
    }
  });

  it("suggestPassword gives a different password each time", () => {
    const set = new Set(Array.from({ length: 50 }, () => suggestPassword()));
    expect(set.size).toBe(50);
  });

  it("branchLabel never doubles the word «فرع»", () => {
    expect(branchLabel("فرع المعادي")).toBe("فرع المعادي");
    expect(branchLabel("المعادي")).toBe("فرع المعادي");
    expect(branchLabel("  فرع الدقي ")).toBe("فرع الدقي");
    expect(branchLabel("فرعون")).toBe("فرع فرعون");
  });
});
