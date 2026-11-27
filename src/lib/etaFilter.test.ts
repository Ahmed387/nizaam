import { describe, expect, it } from "vitest";
import { EMPTY_ETA_FILTERS, etaFilter, etaFilterCount, type EtaDoc } from "@/lib/etaInvoices";

const doc = (o: Partial<EtaDoc>): EtaDoc => ({
  id: "x", eta_uuid: "u", internal_id: "INV-1", type_name: "I", issuer_id: "100", issuer_name: "شركة فريش", date_issued: "2026-11-01",
  date_received: null, net_amount: 100, total_discount: 0, total: 114, vat: 14, status: "Valid", status_reason: null, public_url: null,
  seen_at: null, cancel_requested: false, reject_requested: false, has_detail: false, linked: true, match_mode: null, match_note: null, match: null, ...o,
});
const docs = [
  doc({ id: "a", internal_id: "F-7788", issuer_name: "شركة فريش للأجهزة", issuer_id: "200", total: 50000 }),
  doc({ id: "b", internal_id: "K-12", issuer_name: "كريازي جروب", issuer_id: "300", total: 1200, type_name: "C" }),
  doc({ id: "c", internal_id: "Q-9", issuer_name: "قنوات", issuer_id: "400", total: 9000, status: "Cancelled",
    match: { shipment_id: "s", number: "PO24914", branch_id: "b", branch: "شلبى", contact: "قنوات", date: "2026-11-01", total: 9000, status: "active", diff: 0, days: 0 } }),
];
const ids = (f: Partial<typeof EMPTY_ETA_FILTERS>) => etaFilter(docs, { ...EMPTY_ETA_FILTERS, ...f }).map((d) => d.id);

describe("received e-invoices filter box", () => {
  it("nothing chosen → every row", () => expect(ids({})).toEqual(["a", "b", "c"]));
  it("search: any word in any order, Arabic spelling rules, our purchase number", () => {
    expect(ids({ q: "الاجهزه فريش" })).toEqual(["a"]);
    expect(ids({ q: "po24914" })).toEqual(["c"]);
    expect(ids({ q: "7788" })).toEqual(["a"]);
    expect(ids({ q: "300" })).toEqual(["b"]);
  });
  it("supplier, type, ETA status", () => {
    expect(ids({ issuer: "400" })).toEqual(["c"]);
    expect(ids({ type: "C" })).toEqual(["b"]);
    expect(ids({ etaStatus: "Valid" })).toEqual(["a", "b"]);
  });
  it("amount from / to on the total", () => {
    expect(ids({ amountMin: "5000" })).toEqual(["a", "c"]);
    expect(ids({ amountMin: "1000", amountMax: "9000" })).toEqual(["b", "c"]);
  });
  it("counts the fields in use", () => expect(etaFilterCount({ ...EMPTY_ETA_FILTERS, q: "x", type: "I" })).toBe(2));
});
