import { describe, expect, it } from "vitest";
import { countActions, countWaitingFor } from "./stockCount";

const warehouse = { canCount: true, canReview: false, isOwner: false };
const manager = { canCount: true, canReview: true, isOwner: false };
const owner = { canCount: true, canReview: true, isOwner: true };
const cashier = { canCount: false, canReview: false, isOwner: false };

describe("stock count buttons follow the owner's flow (0267)", () => {
  it("warehouse counts only", () => {
    expect(countActions("counting", warehouse)).toEqual(["count"]);
    expect(countActions("reviewing", warehouse)).toEqual([]);
    expect(countActions("pending_approval", warehouse)).toEqual([]);
  });
  it("manager counts, reviews and cancels an open count, never approves", () => {
    expect(countActions("counting", manager)).toEqual(["count", "cancel_open"]);
    expect(countActions("reviewing", manager)).toEqual(["review", "cancel_open"]);
    expect(countActions("pending_approval", manager)).toEqual(["cancel_open"]);
    expect(countActions("closed", manager)).toEqual([]);
  });
  it("the owner approves and can cancel an approved count", () => {
    expect(countActions("pending_approval", owner)).toEqual(["approve", "cancel_open"]);
    expect(countActions("closed", owner)).toEqual(["cancel_approved"]);
  });
  it("a cashier gets nothing", () => {
    for (const s of ["counting", "reviewing", "pending_approval", "closed"]) expect(countActions(s, cashier)).toEqual([]);
  });
  it("says what the count waits for", () => {
    expect(countWaitingFor("reviewing")).toContain("مراجعة المدير");
    expect(countWaitingFor("pending_approval")).toContain("صاحب الشركة");
  });
});
