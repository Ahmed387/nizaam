import { describe, expect, it } from "vitest";
import { canEditReturn, capsForEdit, editDiff, oldQtyByProduct } from "./returnEdit";

describe("oldQtyByProduct", () => {
  it("sums per product and skips lines without a product", () => {
    expect(oldQtyByProduct([
      { product_id: "a", quantity: 1 }, { product_id: "a", quantity: "2" }, { product_id: null, quantity: 5 }, { product_id: "b", quantity: 1 },
    ])).toEqual({ a: 3, b: 1 });
  });
});

describe("capsForEdit — sale return (SR00076: كنكة 1 + غسالة 1)", () => {
  const lines = [
    { product_id: "kanaka", doc_qty: 1, already_returned: 1 },
    { product_id: "wash", doc_qty: 1, already_returned: 1 },
    { product_id: "other", doc_qty: 2, already_returned: 0 },
  ];
  it("frees the old quantities and pre-fills them", () => {
    expect(capsForEdit(lines, { kanaka: 1, wash: 1 })).toEqual([
      { already_returned: 0, max_qty: 1, quantity: 1 },
      { already_returned: 0, max_qty: 1, quantity: 1 },
      { already_returned: 0, max_qty: 2, quantity: 0 },
    ]);
  });
  it("keeps returns by OTHER active returns counted", () => {
    const [c] = capsForEdit([{ product_id: "x", doc_qty: 5, already_returned: 3 }], { x: 1 });
    expect(c).toEqual({ already_returned: 2, max_qty: 3, quantity: 1 });
  });
  it("gives a product on two lines its old quantity once", () => {
    const caps = capsForEdit(
      [{ product_id: "p", doc_qty: 1, already_returned: 2 }, { product_id: "p", doc_qty: 2, already_returned: 2 }],
      { p: 2 },
    );
    expect(caps.map((c) => c.quantity)).toEqual([1, 1]);
    expect(caps.reduce((s, c) => s + c.quantity, 0)).toBe(2);
  });
});

describe("capsForEdit — purchase return (PR00024: كبة 5, stock 2)", () => {
  it("counts the old pieces as in stock again", () => {
    const [c] = capsForEdit([{ product_id: "k", doc_qty: 10, already_returned: 5, stock: 2 }], { k: 5 });
    expect(c).toEqual({ already_returned: 0, max_qty: 7, quantity: 5 });
  });
  it("never goes below zero", () => {
    const [c] = capsForEdit([{ product_id: "k", doc_qty: 1, already_returned: 0, stock: -3 }], {});
    expect(c.max_qty).toBe(0);
  });
});

describe("editDiff", () => {
  it("lists only what changes", () => {
    const d = editDiff({ kanaka: 1, wash: 1 }, [
      { product_id: "kanaka", product_name: "كنكة", quantity: 1 },
      { product_id: "wash", product_name: "غسالة", quantity: 0 },
      { product_id: "fan", product_name: "مروحة", quantity: 2 },
    ]);
    expect(d).toEqual([
      { product_id: "wash", name: "غسالة", before: 1, after: 0 },
      { product_id: "fan", name: "مروحة", before: 0, after: 2 },
    ]);
  });
});

describe("canEditReturn", () => {
  it("owner, active, 2026 only", () => {
    expect(canEditReturn({ status: "active", invoice_date: "2026-08-13T09:00:00Z" }, true)).toBe(true);
    expect(canEditReturn({ status: "active", invoice_date: "2026-08-13T09:00:00Z" }, false)).toBe(false);
    expect(canEditReturn({ status: "cancelled", invoice_date: "2026-08-13" }, true)).toBe(false);
    expect(canEditReturn({ status: "active", invoice_date: "2025-12-30" }, true)).toBe(false);
    expect(canEditReturn({ status: "active", invoice_date: "2026-03-01", migration_batch_id: "m" }, true)).toBe(false);
    expect(canEditReturn({ status: null, invoice_date: null, created_at: "2026-10-01" }, true)).toBe(true);
  });
});
