import { describe, expect, it } from "vitest";
import { accountLevel, methodLevel, rowsToSave, type VesselRule } from "./vesselAccess";

// the owner's example (2026-11-25): محمد طه — cash use, instapay view only, vodafone hidden but the branch number open
const rules: VesselRule[] = [
  { method: "instapay", account_id: null, level: "view" },
  { method: "vodafone", account_id: null, level: "hidden" },
  { method: "vodafone", account_id: "branch-010", level: "use" },
];

describe("vessel access levels", () => {
  it("nothing set = sees and uses everything", () => {
    expect(methodLevel([], "cash")).toBe("use");
    expect(accountLevel([], "vodafone", "x")).toBe("use");
  });

  it("an account's own rule wins over its vessel's", () => {
    expect(accountLevel(rules, "vodafone", "branch-010")).toBe("use");
    expect(accountLevel(rules, "vodafone", "owner-012")).toBe("hidden");
    expect(accountLevel(rules, "instapay", "any")).toBe("view");
  });

  it("a hidden vessel with one open number is still offered (only that number)", () => {
    expect(methodLevel(rules, "vodafone")).toBe("use");
    expect(methodLevel(rules, "instapay")).toBe("view");
    expect(methodLevel(rules, "cash")).toBe("use");
    expect(methodLevel([{ method: "bank", account_id: null, level: "hidden" }], "bank")).toBe("hidden");
  });
});

describe("rowsToSave", () => {
  it("keeps only what differs: a vessel on «use» is not stored, an account equal to its vessel is not stored", () => {
    const rows = rowsToSave(
      { cash: "use", instapay: "view", vodafone: "hidden" },
      { "vodafone:branch-010": "use", "vodafone:owner-012": "hidden", "instapay:a1": "view" },
    );
    expect(rows).toEqual([
      { method: "instapay", account_id: null, level: "view" },
      { method: "vodafone", account_id: null, level: "hidden" },
      { method: "vodafone", account_id: "branch-010", level: "use" },
    ]);
  });
});
