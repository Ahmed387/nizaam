import { describe, expect, it } from "vitest";
import { ACTIVE_ONLY, documentListColumns, returnClass, returnSplit, sourceText } from "./documentListColumns";
import { buildMatrix, cellOf, effectiveState, valueKey } from "./tableFilter";

const ctx = { branchName: (id?: string | null) => (id === "b1" ? "معرض سكة تلة" : "—"), transferValue: (id: string) => (id === "t1" ? 1500 : undefined) };
const cellsOf = (tab: Parameters<typeof documentListColumns>[0], row: any, view: "active" | "cancelled" = "active") => {
  const cols = documentListColumns(tab, view, ctx);
  const m = buildMatrix([row], cols)[0];
  return Object.fromEntries(cols.map((c, i) => [c.key, m[i].blank ? null : (m[i].num ?? m[i].day ?? m[i].text)]));
};

describe("what each column of the documents screen shows", () => {
  it("a sale: words of the badges, money columns, the Cairo day of its date", () => {
    const row = {
      invoice_number: "IN05108", contacts: { name: "اسامة الراعى الصالح" }, total: 70600, status: "active",
      __class: "credit", __remaining: 20600, __paid: 50000, __payState: "partial",
      __byBucket: { cash: 50000, instapay: 0, wallet: 0, bank: 0, account: 0, other: 0 },
      recipient_name: "", notes: "تسليم المخزن", invoice_date: "2026-10-01T22:30:00+00:00",
    };
    expect(cellsOf("sale", row)).toMatchObject({
      invoice_number: "IN05108", customer: "اسامة الراعى الصالح", total: 70600, __class: "آجل",
      __paid_rem: 20600, __pay_state: "سداد جزئي", __b_cash: 50000, __b_instapay: null, status: "نشطة",
      __recipient: null, __notes: "تسليم المخزن",
      // 22:30 UTC on Oct 1 is 01:30 on Oct 2 in Cairo (UTC+3 in October 2026)
      invoice_date: "2026-10-02",
    });
    // a walk-in sale shows «نقدي» as its customer
    expect(cellsOf("sale", { ...row, contacts: null }).customer).toBe("نقدي");
  });

  it("a cancelled document: the payment columns are «—», and the cancelled view drops them", () => {
    const row = { invoice_number: "IN1", status: "cancelled", total: 10, __class: "cash", __payState: "paid", invoice_date: "2026-10-01" };
    expect(cellsOf("sale", row)).toMatchObject({ __class: null, __paid_rem: null, __pay_state: null, status: "ملغاة" });
    const keys = documentListColumns("sale", "cancelled", ctx).map((c) => c.key);
    keys.forEach((k) => expect(ACTIVE_ONLY.has(k)).toBe(false));
    expect(keys).toContain("__b_cash");
  });

  it("the totals cell of «المدفوع / المتبقي» says both", () => {
    const col = documentListColumns("sale", "active", ctx).find((c) => c.key === "__paid_rem")!;
    expect(col.total!([{ status: "active", __paid: 100, __remaining: 50 }, { status: "active", __paid: 0.5, __remaining: 1000 }]))
      .toBe("مدفوع 100.5 ج.م · متبقي 1,050 ج.م");
  });

  it("a return: its class and how the refund went", () => {
    const r = { refund_cash_amount: 200, refund_transfer_amount: 300, refund_method: "instapay", refund_balance_amount: 0, status: "active" };
    expect(returnSplit(r)).toEqual({ out: 500, account: 0, buckets: { cash: 200, instapay: 300, wallet: 0, bank: 0 } });
    expect(returnClass(r)).toBe("نقدي");
    expect(returnClass({ refund_balance_amount: 90 })).toBe("على الحساب");
    expect(returnClass({ refund_cash_amount: 10, refund_balance_amount: 90 })).toBe("نقدي + حساب");
    expect(cellsOf("sale_return", { ...r, return_number: "RT1", total_refund: 500, invoices: { invoice_number: "IN9", contacts: null } }))
      .toMatchObject({ customer: "نقدي", inv: "IN9", __class: "نقدي", __refund_split: 500, __m_cash: 200, __m_instapay: 300, __m_bank: null, __r_account: null, status: "نشط" });
  });

  it("a voucher: its account, method, source and date", () => {
    expect(sourceText({ src_type: "sale", src_id: "x", src_number: "IN05108" }, "auto")).toBe("فاتورة بيع IN05108");
    expect(sourceText({ cancelled_voucher_number: "RV-0667" })).toBe("إلغاء سند RV-0667");
    expect(sourceText(null, "manual")).toBe("يدوي");
    expect(sourceText(null, "auto")).toBe("تلقائي");
    expect(cellsOf("income", {
      voucher_number: "RV-0001", __account: "جارحي", amount: 2500, category: "—", payment_method: "vodafone_cash",
      voucher_date: "2026-10-05", created_at: "2026-10-05", status: "cancelled", __link: null, source: "manual", description: "دفعة",
    })).toMatchObject({ __account: "جارحي", amount: 2500, category: null, payment_method: "محفظة", created_at: "2026-10-05", status: "ملغي", __source: "يدوي" });
  });

  it("a transfer: branch names and its value", () => {
    expect(cellsOf("transfer", { id: "t1", from_branch_id: "b1", to_branch_id: "b9", status: "confirmed", transfer_date: "2026-10-04" }))
      .toMatchObject({ from_branch_id: "معرض سكة تلة", to_branch_id: null, status: "مؤكد", __value: 1500, created_at: "2026-10-04" });
  });
});

describe("cells from known values", () => {
  it("numbers, days and blanks", () => {
    expect(cellOf("number", 1234.5)).toMatchObject({ num: 1234.5, text: "1,234.5", blank: false });
    expect(cellOf("number", null).blank).toBe(true);
    expect(cellOf("date", "2026-06-03")).toMatchObject({ day: "2026-06-03", text: "3 يونيو 2026" });
    expect(cellOf("date", "")).toMatchObject({ blank: true });
    expect(valueKey(cellOf("text", "—"))).toBe(valueKey(cellOf("text", "")));
  });
  it("a hidden column's filter waits", () => {
    const s = { filters: { a: { kind: "values" as const, values: ["x"] }, b: { kind: "values" as const, values: ["y"] } }, sort: { col: "b", dir: "asc" as const } };
    expect(effectiveState(s, ["a"])).toEqual({ filters: { a: s.filters.a }, sort: null });
    expect(effectiveState(s, ["a", "b"])).toBe(s);
  });
});
