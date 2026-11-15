import { describe, expect, it } from "vitest";
import { etaLines, etaState, etaTotals, etaTypeLabel, type EtaDoc } from "./etaInvoices";

const doc = (o: Partial<EtaDoc>): EtaDoc => ({
  id: "1", eta_uuid: "U", internal_id: "X", type_name: "I", issuer_id: "200", issuer_name: "فريش", date_issued: "2026-11-04",
  date_received: null, net_amount: 100, total_discount: 0, total: 114, vat: 14, status: "Valid", status_reason: null,
  public_url: null, seen_at: null, cancel_requested: false, reject_requested: false, has_detail: false, linked: true,
  match_mode: null, match_note: null, match: null, ...o,
});
const m = { shipment_id: "s", number: "PO1", branch_id: "b", branch: "شلبى", contact: "فريش", date: "2026-11-09", total: 114, status: "active", diff: 0, days: 5 };

describe("etaState", () => {
  it("paired → recorded", () => expect(etaState(doc({ match: m, match_mode: "auto" }))).toBe("recorded"));
  it("linked supplier, no purchase → missing", () => expect(etaState(doc({}))).toBe("missing"));
  it("supplier not linked → unlinked", () => expect(etaState(doc({ linked: false }))).toBe("unlinked"));
  it("ignored wins over everything but a void document", () => {
    expect(etaState(doc({ match_mode: "ignored" }))).toBe("ignored");
    expect(etaState(doc({ match_mode: "ignored", status: "Cancelled" }))).toBe("void");
  });
  it("credit note without a pair → credit", () => expect(etaState(doc({ type_name: "C" }))).toBe("credit"));
  it("lower-case type still counts as an invoice", () => expect(etaState(doc({ type_name: "i" }))).toBe("missing"));
});

describe("etaTotals", () => {
  it("credit notes subtract; cancelled ones are left out", () => {
    const t = etaTotals([
      doc({ id: "a", match: m }),
      doc({ id: "b", total: 228, vat: 28 }),
      doc({ id: "c", type_name: "C", total: 57, vat: 7 }),
      doc({ id: "d", status: "Cancelled", total: 1000 }),
      doc({ id: "e", linked: false, issuer_id: "300", total: 10, vat: 1 }),
    ]);
    expect(t.count).toBe(4);
    expect(t.total).toBe(114 + 228 - 57 + 10);
    expect(t.vat).toBe(14 + 28 - 7 + 1);
    expect(t.recorded).toEqual({ count: 1, total: 114 });
    expect(t.notRecorded).toEqual({ count: 2, total: 238 });
    expect(t.unlinkedSuppliers).toBe(1);
    expect(t.credit.count).toBe(1);
  });
});

describe("etaLines", () => {
  it("reads one ETA invoice line", () => {
    const lines = etaLines({ document: { invoiceLines: [{
      description: "غسالة حوض واحد 5ك شطورة", internalCode: "000000000500001928", itemCode: "6221103003994",
      quantity: 5, unitType: "EA", unitValue: { amountEGP: 2762.28 }, discount: { amount: 0 }, itemsDiscount: 0,
      netTotal: 13811.4, total: 15745, taxableItems: [{ amount: 1933.6, rate: 14 }],
    }] } });
    expect(lines[0]).toMatchObject({ quantity: 5, price: 2762.28, net: 13811.4, vat: 1933.6, total: 15745, code: "000000000500001928" });
  });
  it("no detail → no lines", () => expect(etaLines(null)).toEqual([]));
});

it("type labels", () => {
  expect(etaTypeLabel("i")).toBe("فاتورة");
  expect(etaTypeLabel("C")).toBe("إشعار دائن");
});
