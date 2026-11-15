import { describe, expect, it } from "vitest";
import { candidateNet, keepAdvice, mergeBranchOptions, mergeNameOptions, mergeNameToSend, splitCandidates, type MergeCandidate } from "./mergeCandidates";

const c = (o: Partial<MergeCandidate>): MergeCandidate => ({
  id: "x", name: "نقابة المعلمين", account_no: 629, phone: null, type: "customer", branch_id: "b2", branch_name: "عبدالمنعم",
  same_branch: false, customer_balance: 0, supplier_balance: 0, net: 0, opening_balance: 0, shared_words: 2, documents: 80,
  can_merge: false, why_not: "في فرع تاني — الدمج جوه الفرع الواحد بس", ...o,
});

describe("splitCandidates", () => {
  it("groups by branch: own branch first, other branches after (both can be merged since 0229)", () => {
    const s = splitCandidates([c({ id: "a", can_merge: true, same_branch: true, why_not: null }), c({ id: "b", can_merge: true, why_not: null })]);
    expect(s.sameBranch.map((x) => x.id)).toEqual(["a"]);
    expect(s.elsewhere.map((x) => x.id)).toEqual(["b"]);
  });
});

describe("merge name / branch choices (0229)", () => {
  it("offers both names once, kept one first", () => {
    expect(mergeNameOptions("نقابة المعلمين", "النقابة المعلمين")).toEqual(["نقابة المعلمين", "النقابة المعلمين"]);
    expect(mergeNameOptions("احمد", " احمد ")).toEqual(["احمد"]);
  });
  it("offers both branches once, kept account's branch first", () => {
    expect(mergeBranchOptions({ id: "b4", name: "عبدالمنعم" }, { id: "b3", name: "سكة" })).toEqual([{ id: "b4", name: "عبدالمنعم" }, { id: "b3", name: "سكة" }]);
    expect(mergeBranchOptions({ id: "b4", name: "عبدالمنعم" }, { id: "b4", name: "عبدالمنعم" })).toHaveLength(1);
    expect(mergeBranchOptions({ id: null, name: null }, { id: "b3", name: "سكة" })).toEqual([{ id: "b3", name: "سكة" }]);
  });
  it("sends the typed name only for «اسم تاني», spaces tidied", () => {
    expect(mergeNameToSend("__custom", "  نقابة   المعلمين ")).toBe("نقابة المعلمين");
    expect(mergeNameToSend("احمد معتز", "x")).toBe("احمد معتز");
  });
});

describe("candidateNet", () => {
  it("customer side owing us = مدين (negative), supplier side = دائن (positive)", () => {
    expect(candidateNet({ customer_balance: 250622.75, supplier_balance: 0 })).toBe(-250622.75);
    expect(candidateNet({ customer_balance: 100, supplier_balance: 300 })).toBe(200);
  });
});

describe("keepAdvice", () => {
  it("keeps the account that carries an opening balance", () => {
    expect(keepAdvice(0, { opening_balance: 5000, name: "ب" }, "أ")).toMatchObject({ keepThis: false, blocked: false });
    expect(keepAdvice(5000, { opening_balance: 0, name: "ب" }, "أ")).toMatchObject({ keepThis: true, blocked: false });
  });
  it("both with an opening → blocked", () => expect(keepAdvice(10, { opening_balance: -3, name: "ب" }, "أ").blocked).toBe(true));
  it("none → keep this one, no note", () => expect(keepAdvice(0, { opening_balance: 0, name: "ب" }, "أ")).toEqual({ keepThis: true, blocked: false, note: null }));
});
