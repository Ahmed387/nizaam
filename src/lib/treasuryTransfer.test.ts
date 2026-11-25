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

import { moneyTransferState, needsOwnerApproval, receiverCanAct, senderCanChange } from "./treasuryTransfer";
describe("money transfer states (0285)", () => {
  it("waiting for the owner: the sender may change it, the receiver may not act", () => {
    const r = { approval_status: "waiting" };
    expect(moneyTransferState(r)).toBe("waiting");
    expect(senderCanChange(r)).toBe(true);
    expect(receiverCanAct(r)).toBe(false);
  });
  it("cancelled wins over everything", () => {
    expect(moneyTransferState({ cancelled_at: "x", approval_status: "approved" })).toBe("cancelled");
    expect(senderCanChange({ cancelled_at: "x" })).toBe(false);
  });
  it("received: nobody changes it", () => {
    const r = { approval_status: "approved", acknowledged_at: "x" };
    expect(moneyTransferState(r)).toBe("confirmed");
    expect(senderCanChange(r)).toBe(false);
    expect(receiverCanAct(r)).toBe(false);
  });
  it("refused by the owner", () => expect(moneyTransferState({ approval_status: "refused" })).toBe("refused"));
  it("approval limit", () => {
    expect(needsOwnerApproval(1500, 1000, false)).toBe(true);
    expect(needsOwnerApproval(1500, 1000, true)).toBe(false);
    expect(needsOwnerApproval(1500, 0, false)).toBe(false);
    expect(needsOwnerApproval(1000, 1000, false)).toBe(false);
  });
});
