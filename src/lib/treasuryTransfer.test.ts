import { describe, expect, it } from "vitest";
import { receiveSplit } from "./treasuryTransfer";

describe("money transfer between branches (0140)", () => {
  it("full receipt: nothing goes back", () => {
    expect(receiveSplit(50000, 50000)).toEqual({ received: 50000, returned: 0, error: null, needsNote: false });
  });
  it("partial: the difference goes back and needs a reason", () => {
    expect(receiveSplit(50000, 48000).returned).toBe(2000);
    expect(receiveSplit(50000, 48000).error).toBe("اكتب سبب الفرق");
    expect(receiveSplit(50000, 48000, "ناقص 2000").error).toBeNull();
  });
  it("refusal = receive 0, all back", () => {
    expect(receiveSplit(1000, 0, "غلط").returned).toBe(1000);
  });
  it("more than was sent is refused", () => {
    expect(receiveSplit(1000, 1200).error).not.toBeNull();
  });
});
