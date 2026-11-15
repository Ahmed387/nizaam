import { describe, expect, it } from "vitest";
import { candidateNet, keepAdvice, splitCandidates, type MergeCandidate } from "./mergeCandidates";

const c = (o: Partial<MergeCandidate>): MergeCandidate => ({
  id: "x", name: "نقابة المعلمين", account_no: 629, phone: null, type: "customer", branch_id: "b2", branch_name: "عبدالمنعم",
  same_branch: false, customer_balance: 0, supplier_balance: 0, net: 0, opening_balance: 0, shared_words: 2, documents: 80,
  can_merge: false, why_not: "في فرع تاني — الدمج جوه الفرع الواحد بس", ...o,
});

describe("splitCandidates", () => {
  it("same branch is mergeable, other branches are for information", () => {
    const s = splitCandidates([c({ id: "a", can_merge: true, same_branch: true, why_not: null }), c({ id: "b" })]);
    expect(s.mergeable.map((x) => x.id)).toEqual(["a"]);
    expect(s.elsewhere.map((x) => x.id)).toEqual(["b"]);
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
