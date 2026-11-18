import { describe, it, expect } from "vitest";
import { movementMatches, methodMatches, textHas } from "./docMeta";
import { EMPTY_DOCUMENT_FILTERS as E } from "@/components/documents/UnifiedDocumentFilters";

const meta = { items: "ثلاجة توشيبا 16 قدم شاشة سينكس", method: "vodafone", recipient: "ا/محمود علاء ضيف", total: 25000, notes: "", party: "أحمد", phone: "01012345678" };
const row = { reference: "IN47906", party: "أحمد سمير", phone: "01012345678", notes: "تسليم يوم الخميس", amount: 25000 };

describe("unified filter on movement lists", () => {
  it("search: document number, item name inside the invoice (contact file), Arabic spelling rules", () => {
    expect(movementMatches(row, meta, { ...E, q: "47906" }, true)).toBe(true);
    expect(movementMatches(row, meta, { ...E, q: "ثلاجه سينكس" }, true)).toBe(true);
    expect(movementMatches(row, meta, { ...E, q: "ثلاجه" }, false)).toBe(false); // the item page searches no items
    expect(movementMatches(row, meta, { ...E, q: "0101234" }, false)).toBe(true);  // phone
  });
  it("amount from / to", () => {
    expect(movementMatches(row, meta, { ...E, amountMin: "20000", amountMax: "30000" }, true)).toBe(true);
    expect(movementMatches(row, meta, { ...E, amountMin: "26000" }, true)).toBe(false);
  });
  it("notes, recipient, payment / vessel", () => {
    expect(movementMatches(row, meta, { ...E, notes: "الخميس" }, true)).toBe(true);
    expect(movementMatches(row, meta, { ...E, recipient: "ا/محمود علاء ضيف" }, true)).toBe(true);
    expect(movementMatches(row, meta, { ...E, recipient: "كاشير تاني" }, true)).toBe(false);
    expect(movementMatches(row, meta, { ...E, payment: "vodafone" }, true)).toBe(true);
    expect(movementMatches(row, meta, { ...E, payment: "cash" }, true)).toBe(false);
  });
  it("any wallet counts as «محفظة», credit / balance as «آجل»", () => {
    expect(methodMatches("paymob", "vodafone")).toBe(true);
    expect(methodMatches("balance", "credit")).toBe(true);
    expect(methodMatches("cash", "vodafone")).toBe(false);
  });
  it("text match ignores word order", () => { expect(textHas("ثلاجة توشيبا", "توشيبا ثلاجه")).toBe(true); });
});
