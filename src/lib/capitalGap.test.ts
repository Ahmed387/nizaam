import { describe, expect, it } from "vitest";
import { gapItems, gapLeft, lineText } from "./capitalGap";

// the owner's example: ناصر 6M + محمد 4M = 10M, books 4,845,828.43 → 5,154,171.57
describe("«الفرق ده راح فين؟»", () => {
  it("what is left to place = the difference − loss − drawings", () => {
    expect(gapLeft(5154171.57, { loss: "4000000", drawings: [{ partner_id: "n", amount: "1000000", keep_share: false }] })).toBe(154171.57);
    expect(gapLeft(5154171.57, { loss: "4000000", drawings: [{ partner_id: "n", amount: "1154171.57", keep_share: true }] })).toBe(0);
  });

  it("sends only what was filled, the drawing with the owner's own choice about the %", () => {
    expect(gapItems({ loss: "4000000", drawings: [{ partner_id: "n", amount: "1154171.57", keep_share: false }, { partner_id: "", amount: "", keep_share: null }] }))
      .toEqual([{ kind: "loss", amount: 4000000 }, { kind: "drawing", partner_id: "n", amount: 1154171.57, keep_share: false }]);
    expect(gapItems({ loss: "", drawings: [] })).toEqual([]);
  });

  it("explains each line of the entry in words, never an account code", () => {
    expect(lineText({ account_code: "3950", debit: 4845828.43, credit: 0, description: "" })).toMatch(/صافي الملك.*بيتنقل/);
    expect(lineText({ account_code: "3100", debit: 0, credit: 6000000, description: "رأس مال الحاج ناصر" })).toMatch(/رأس مال الحاج ناصر/);
    expect(lineText({ account_code: "3800", debit: 4000000, credit: 0, description: "" })).toMatch(/خسائر قبل السيستم/);
    expect(lineText({ account_code: "3800", debit: 0, credit: 1845828.43, description: "" })).toMatch(/أرباح محتجزة/);
    expect(lineText({ account_code: "3200", debit: 1000, credit: 0, description: "مسحوبات قبل السيستم — الحاج ناصر" })).toMatch(/مسحوبات قبل السيستم — الحاج ناصر/);
    for (const c of ["3950", "3100", "3800", "3200"]) expect(lineText({ account_code: c, debit: 1, credit: 0, description: "" })).not.toMatch(/\d{4}/);
  });
});
