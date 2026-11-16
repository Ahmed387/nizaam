import { describe, expect, it } from "vitest";
import { rtlPieces, money, etaMessage, docSummary, dayTitle, timeText } from "../../supabase/functions/telegram/format.ts";

describe("telegram format", () => {
  it("rtlPieces keeps numbers and codes in reading order, right to left", () => {
    expect(rtlPieces("IN05108")).toEqual(["IN05108"]);
    const p = rtlPieces("فاتورة IN05108 بـ 14,500.25 جنيه");
    expect(p).toContain("IN05108");
    expect(p).toContain("14,500.25");
    expect(p[0].startsWith("فاتورة")).toBe(true);
    // Arabic pieces never start with a Latin letter (fontkit would read them left to right)
    for (const x of p) expect(/^[A-Za-z]/.test(x) && /[؀-ۿ]/.test(x)).toBe(false);
  });
  it("brackets are mirrored in Arabic text", () => {
    expect(rtlPieces("(3 قطع)").join("|")).toContain("3");
    expect(rtlPieces("صفحة (اختبار)")).toEqual(["صفحة )اختبار", "("]);
  });
  it("money", () => {
    expect(money(186400)).toBe("186,400");
    expect(money(14500.5)).toBe("14,500.50");
    expect(money(-1200)).toBe("-1,200");
    expect(money(null)).toBe("0");
  });
  it("dates in Cairo", () => {
    expect(dayTitle("2026-11-16")).toBe("الاثنين 16/11/2026");
    expect(timeText("2026-11-16T07:12:00Z")).toBe("9:12 ص");
    expect(timeText("2026-11-16T20:48:00Z")).toBe("10:48 م");
  });
  it("e-invoice message", () => {
    const m = etaMessage({
      id: "x", internal_id: "FR-1", type_name: "I", issuer_id: "123", issuer_name: "123 الفريش", date_issued: "2026-11-16T10:00:00Z",
      total_sales: 100, total_discount: 0, net_amount: 87719.3, total: 100000, matched_number: "PO1478", match_mode: "auto", ref_internal_id: null,
      detail: { document: { invoiceLines: [{ description: "غسالة <10ك>", quantity: 5, total: 1 }] } },
    }, "https://app");
    expect(m).toContain("فاتورة إلكترونية جديدة");
    expect(m).toContain("المورد: <b>الفريش</b>");
    expect(m).toContain("الإجمالي: 100,000");
    expect(m).toContain("الضريبة: 12,280.70");
    expect(m).toContain("غسالة &lt;10ك&gt; × 5");
    expect(m).toContain("مربوطة بفاتورة شراء PO1478");
    const c = etaMessage({ id: "y", internal_id: "CN-1", type_name: "C", issuer_id: null, issuer_name: "x", date_issued: null,
      total_sales: 0, total_discount: 0, net_amount: 0, total: 50, detail: null, matched_number: null, match_mode: null, ref_internal_id: "FR-1" });
    expect(c).toContain("إشعار دائن");
    expect(c).toContain("على فاتورة: FR-1");
    expect(c).not.toContain("في السيستم");
  });
  it("doc summary", () => {
    expect(docSummary({ doc_type: "sale", action: "create", n: 14, total: 186400 })).toBe("عمل 14 فاتورة بيع — إجمالي 186,400");
    expect(docSummary({ doc_type: "receipt", action: "cancel", n: 1, total: null })).toBe("ألغى 1 سند قبض");
  });
});
