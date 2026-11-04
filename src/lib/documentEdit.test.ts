import { describe, it, expect } from "vitest";
import { chainSteps, stepsOf, excessAfterEdit, returnEditEffect, submitMessage } from "./documentEdit";

describe("documentEdit (0141 / 0141b)", () => {
  it("chains the lines and the date into one request", () => {
    const p = chainSteps(
      [{ rpc: "edit_invoice", args: { _invoice_id: "i" } }, null, { rpc: "update_invoice_date_sovereign", args: { p_invoice_id: "i" } }],
      { diff: ["الكمية 2 ← 1"], return_ids: ["r"] },
    )!;
    expect(stepsOf(p)).toEqual(["edit_invoice", "update_invoice_date_sovereign"]);
    expect(p.diff).toEqual(["الكمية 2 ← 1"]);
    expect(p.return_ids).toEqual(["r"]);
    expect(p.then?.diff).toBeUndefined();
  });

  it("no step → nothing to send", () => {
    expect(chainSteps([null, undefined, false])).toBeNull();
  });

  it("money paid above the new total", () => {
    expect(excessAfterEdit(3080, 3180)).toBe(100);
    expect(excessAfterEdit(3180, 3180)).toBe(0);
    expect(excessAfterEdit(4000, 3180)).toBe(0);
  });

  it("sale kept return: 5 fridges, 2 back, edited to 1", () => {
    const m = returnEditEffect("sale", [{ name: "تلاجة", oldQty: 5, newQty: 1, returnedQty: 2 }], { newTotal: 10000, paid: 50000, returned: 20000 });
    expect(m[0]).toBe("هيرجع للمخزن 1 «تلاجة» زيادة عن اللي اتباع");
    expect(m[1]).toContain("العميل هيبقى ليه");
  });

  it("purchase kept return: 10 screens, 4 back, stock 6, edited to 3 → stock −1, supplier owes 1,000", () => {
    const m = returnEditEffect("purchase", [{ name: "شاشة", oldQty: 10, newQty: 3, returnedQty: 4, stock: 6 }], { newTotal: 3000, paid: 0, returned: 4000 });
    expect(m[0]).toBe("المخزن هيقل 7 «شاشة» كمان ويبقى −1");
    expect(m[1]).toContain("المورد هيبقى عليه لنا");
    expect(m[1]).toContain("1,000");
  });

  it("the toast says whether it ran or waits for the owner", () => {
    expect(submitMessage({ mode: "requested" }, "فاتورة IN1")).toContain("للمالك");
    expect(submitMessage({ mode: "applied" }, "فاتورة IN1")).toBe("اتعدّل «فاتورة IN1»");
  });
});

import { lineDiff } from "./documentEdit";
describe("lineDiff", () => {
  it("before ← after per product", () => {
    const d = lineDiff(
      [{ product_id: "a", name: "تلاجة", qty: 2, price: 20000 }, { product_id: "b", name: "غسالة", qty: 1, price: 9000 }],
      [{ product_id: "a", name: "تلاجة", qty: 1, price: 19500 }, { product_id: "c", name: "بوتاجاز", qty: 1, price: 7000 }],
    );
    expect(d).toEqual([
      "اتشال «غسالة» (كان 1 × 9,000)",
      "كمية «تلاجة»: 2 ← 1",
      "سعر «تلاجة»: 20,000 ← 19,500",
      "اتضاف «بوتاجاز»: 1 × 7,000",
    ]);
  });
});

import { restoreMoneyLeft, restorePayload } from "./documentEdit";
describe("restore from «الملغاة» (0142)", () => {
  it("money that left: cash given back or voided payments; credit / nothing = 0", () => {
    expect(restoreMoneyLeft({ refund_method: "cash", refund_amount: 1250 })).toBe(1250);
    expect(restoreMoneyLeft({ refund_method: "void", total_paid_before_cancel: 1285 })).toBe(1285);
    expect(restoreMoneyLeft({ refund_method: "credit", refund_amount: 1050 })).toBe(0);
    expect(restoreMoneyLeft({ refund_method: "none" })).toBe(0);
  });
  it("the request carries the owner's answer", () => {
    const p = restorePayload("invoice", "i1", { action: "collect", method: "cash" }, 1250);
    expect(p.rpc).toBe("restore_invoice");
    expect((p.args as any).p_money).toEqual({ action: "collect", method: "cash" });
    expect(p.diff?.[1]).toContain("هيدفع");
    expect(restorePayload("voucher", "v1", null).args).toEqual({ p_voucher_id: "v1" });
  });
});

describe("restore from «الملغاة» — returns and purchases (0146)", () => {
  it("sends each kind to its own server step", () => {
    expect(restorePayload("sale_return", "r1", null)).toMatchObject({ rpc: "restore_sale_return", args: { p_return_id: "r1" } });
    expect(restorePayload("purchase_return", "r2", null)).toMatchObject({ rpc: "restore_purchase_return", args: { p_return_id: "r2" } });
    expect(restorePayload("shipment", "s1", { action: "as_before" })).toMatchObject({ rpc: "restore_shipment", args: { p_shipment_id: "s1", p_money: { action: "as_before" } } });
  });
  it("a purchase asks only when money left at the cancellation", async () => {
    const { shipmentRestoreQuestion } = await import("./documentEdit");
    expect(shipmentRestoreQuestion({ money_action: "refund", refund_amount: 200 })).toBe("refund");
    expect(shipmentRestoreQuestion({ money_action: "void" })).toBe("void");
    expect(shipmentRestoreQuestion({ money_action: "credit", refund_amount: 0 })).toBeNull();
    expect(shipmentRestoreQuestion({ money_action: null })).toBeNull();
  });
  it("the request card says what happens to the money", () => {
    expect(restorePayload("shipment", "s1", { action: "pay" }).diff).toContain("الفلوس هتطلع للمورد النهارده");
    expect(restorePayload("shipment", "s1", { action: "debt" }).diff).toContain("الفلوس تفضل علينا للمورد");
  });
});
