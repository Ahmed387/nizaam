import { describe, expect, it } from "vitest";
import { invoiceProfit, isArchiveInvoice, lineProfit, returnEffect, type ReturnLine } from "./profitEngine";

// SR00083: IN04796 sold 2/3/2026 for 20,332 (cost 16,350), returned 23/5/2026 (0133 — the card's rule)
const IN04796 = {
  invoice_date: "2026-03-02T10:00:00+02:00", created_at: "2026-03-02T10:00:00+02:00", is_migrated: false, discount_amount: 0,
  invoice_items: [{ quantity: 1, returned_quantity: 1, net_quantity: 0, total: 20332, unit_cost_at_sale: 16350 }],
};
const SR00083: ReturnLine = {
  branch_id: "b", return_id: "r", return_number: "SR00083", return_day: "2026-05-23", invoice_id: "i", invoice_number: "IN04796",
  invoice_day: "2026-03-02", archive_invoice: false, product_id: "p", product_name: "x", quantity: 1, refund: 20332, unit_cost: 16350, cost: 16350,
};

describe("return lens (0133)", () => {
  it("March keeps the sale even though it came back later", () => {
    const p = invoiceProfit(IN04796);
    expect(p.revenue).toBe(20332);
    expect(p.cost).toBe(16350);
    expect(p.profit).toBe(3982);
  });
  it("May takes the return off: its money and the cost that came back", () => {
    const r = returnEffect([SR00083], (l) => l.return_day >= "2026-05-01" && l.return_day <= "2026-05-31");
    expect(r.revenue - r.cost).toBe(3982);
    expect(returnEffect([SR00083], (l) => l.return_day < "2026-05-01").revenue).toBe(0);
  });
  it("the year adds up to zero for a sale that fully came back", () => {
    const p = invoiceProfit(IN04796);
    const r = returnEffect([SR00083]);
    expect(p.revenue - r.revenue - (p.cost - r.cost)).toBe(0);
  });
  it("the bill discount comes off the invoice in full", () => {
    const p = invoiceProfit({ ...IN04796, discount_amount: 332, invoice_items: [{ quantity: 2, returned_quantity: 1, total: 20000, unit_cost_at_sale: 8000 }] });
    expect(p.revenue).toBe(19668);
    expect(p.cost).toBe(16000);
  });
  it("an archive invoice keeps its cost net of returns (no cost comes back for it)", () => {
    const old = { invoice_date: "2025-06-01T10:00:00+03:00", created_at: "2025-06-01T10:00:00+03:00", invoice_items: [{ quantity: 2, returned_quantity: 1, total: 2000, unit_cost_at_sale: 600 }] };
    expect(isArchiveInvoice(old)).toBe(true);
    const p = invoiceProfit(old);
    expect(p.revenue).toBe(2000);
    expect(p.cost).toBe(600);
  });
  it("an old date typed in 2026 is not archive", () => {
    expect(isArchiveInvoice({ invoice_date: "2025-12-20T10:00:00+02:00", created_at: "2026-02-01T10:00:00+02:00" })).toBe(false);
    expect(isArchiveInvoice({ invoice_date: "2025-12-20T10:00:00+02:00", created_at: "2026-02-01T10:00:00+02:00", is_migrated: true })).toBe(true);
  });
  it("lineProfit fullQuantity ignores returned_quantity", () => {
    const it = { quantity: 3, returned_quantity: 2, total: 300, unit_cost_at_sale: 50 };
    expect(lineProfit(it).netQty).toBe(1);
    expect(lineProfit(it, { fullQuantity: true }).revenue).toBe(300);
  });
});
