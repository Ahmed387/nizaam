import { describe, expect, it } from "vitest";
import { EMPTY_DOCUMENT_FILTERS, type DocumentFilters } from "@/components/documents/UnifiedDocumentFilters";
import { barFromColumns, columnsFromBar, linkedFields, needsWholeList, periodOf, type LinkCtx } from "./documentFilterLinks";
import type { ColumnFilter } from "./tableFilter";

const ctx: LinkCtx = {
  categories: [{ id: "c1", name: "مرتبات" }, { id: "c2", name: "كهرباء" }],
  branches: [{ id: "b1", name: "معرض سكة تلة" }, { id: "b2", name: "شلبى" }],
  partyName: (id) => ({ p1: "اسامة الراعى الصالح" } as Record<string, string>)[id],
  partyId: (name) => (name === "اسامة الراعى الصالح" ? "p1" : undefined),
};
const bar = (patch: Partial<DocumentFilters> = {}): DocumentFilters => ({ ...EMPTY_DOCUMENT_FILTERS, ...patch });
type F = Record<string, ColumnFilter>;
/** the person changes the bar from what it shows now to `patch` */
const edit = (tab: Parameters<typeof barFromColumns>[0], f: F, patch: Partial<DocumentFilters>) => {
  const prev = bar(barFromColumns(tab, f, ctx));
  return columnsFromBar(tab, f, prev, { ...prev, ...patch }, ctx);
};

describe("the bar on top and the column arrows are one set of filters", () => {
  it("«حالة السداد» on top = that value ticked in the column, and back", () => {
    const f = edit("sale", {}, { payState: "paid" });
    expect(f).toEqual({ __pay_state: { kind: "values", values: ["مدفوعة بالكامل"] } });
    expect(barFromColumns("sale", f, ctx).payState).toBe("paid");
    // «الكل» on top clears the column
    expect(edit("sale", f, { payState: "" })).toEqual({});
  });

  it("two values ticked in the column: the bar says «الكل», and editing another bar field leaves them alone", () => {
    const f: F = { __pay_state: { kind: "values", values: ["سداد جزئي", "لم يتم الدفع"] } };
    expect(barFromColumns("sale", f, ctx).payState).toBe("");
    const next = edit("sale", f, { amountMin: "1000" });
    expect(next.__pay_state).toEqual(f.__pay_state);
    expect(next.total).toEqual({ kind: "number", op: "gte", a: 1000 });
  });

  it("the amount range: from only, to only, both", () => {
    expect(edit("sale", {}, { amountMin: "1000" }).total).toEqual({ kind: "number", op: "gte", a: 1000 });
    expect(edit("sale", {}, { amountMax: "5000" }).total).toEqual({ kind: "number", op: "lte", a: 5000 });
    const both = edit("sale", {}, { amountMin: "1000", amountMax: "5000" });
    expect(both.total).toEqual({ kind: "number", op: "between", a: 1000, b: 5000 });
    expect(barFromColumns("sale", both, ctx)).toMatchObject({ amountMin: "1000", amountMax: "5000" });
    // a condition set in the arrow shows in the bar
    expect(barFromColumns("sale", { total: { kind: "number", op: "gt", a: 20000 } }, ctx)).toMatchObject({ amountMin: "20000", amountMax: "" });
    expect(edit("purchase", {}, { amountMin: "10" }).total_cost).toEqual({ kind: "number", op: "gte", a: 10 });
  });

  it("«طريقة الدفع» of a sale = that method's column more than 0; another method moves it", () => {
    const cash = edit("sale", {}, { payment: "cash" });
    expect(cash).toEqual({ __b_cash: { kind: "number", op: "gt", a: 0 } });
    expect(barFromColumns("sale", cash, ctx).payment).toBe("cash");
    const bank = edit("sale", cash, { payment: "bank" });
    expect(bank).toEqual({ __b_bank: { kind: "number", op: "gt", a: 0 } });
    expect(edit("sale", bank, { payment: "" })).toEqual({});
    // «كاش أكبر من 1,000» set in the arrow is not the bar's: the bar shows «الكل» and leaves it when it changes
    const own: F = { __b_cash: { kind: "number", op: "gt", a: 1000 } };
    expect(barFromColumns("sale", own, ctx).payment).toBe("");
    expect(edit("sale", own, { payment: "instapay" })).toEqual({ ...own, __b_instapay: { kind: "number", op: "gt", a: 0 } });
    expect(edit("sale", {}, { payment: "return" })).toEqual({ __b_other: { kind: "number", op: "gt", a: 0 } });
  });

  it("the period is the date column's from / to; picked days stay", () => {
    const f = edit("sale", {}, { from: "2026-10-01", to: "2026-10-31" });
    expect(f.invoice_date).toEqual({ kind: "date", from: "2026-10-01", to: "2026-10-31" });
    const withDays: F = { invoice_date: { kind: "date", days: ["2026-10-03"], from: "2026-10-01" } };
    expect(edit("sale", withDays, { from: "2026-09-01" }).invoice_date).toEqual({ kind: "date", days: ["2026-10-03"], from: "2026-09-01" });
    expect(edit("sale", withDays, { from: "" }).invoice_date).toEqual({ kind: "date", days: ["2026-10-03"] });
    expect(edit("income", {}, { from: "2026-10-01" }).created_at).toEqual({ kind: "date", from: "2026-10-01" });
    expect(periodOf("sale", { filters: f, sort: null })).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodOf("quote", { filters: f, sort: null })).toBeNull();
  });

  it("vouchers: payment method and «نوع السند» by the words the column shows", () => {
    const f = edit("income", {}, { payment: "instapay", categoryId: "c1" });
    expect(f).toEqual({ payment_method: { kind: "values", values: ["انستاباي"] }, category: { kind: "values", values: ["مرتبات"] } });
    expect(barFromColumns("income", f, ctx)).toMatchObject({ payment: "instapay", categoryId: "c1" });
  });

  it("returns: the customer picked on top = his name in the column", () => {
    const f = edit("sale_return", {}, { partyId: "p1" });
    expect(f).toEqual({ customer: { kind: "values", values: ["اسامة الراعى الصالح"] } });
    expect(barFromColumns("sale_return", f, ctx).partyId).toBe("p1");
    expect(edit("purchase_return", {}, { partyId: "p1" })).toEqual({ supplier: { kind: "values", values: ["اسامة الراعى الصالح"] } });
  });

  it("transfers: status and the branches by name", () => {
    const f = edit("transfer", {}, { status: "confirmed", fromBranch: "b1", toBranch: "b2" });
    expect(f).toEqual({
      status: { kind: "values", values: ["مؤكد"] },
      from_branch_id: { kind: "values", values: ["معرض سكة تلة"] },
      to_branch_id: { kind: "values", values: ["شلبى"] },
    });
    expect(barFromColumns("transfer", f, ctx)).toMatchObject({ status: "confirmed", fromBranch: "b1", toBranch: "b2" });
  });

  it("search, المستلم and الملاحظات stay the bar's own", () => {
    const own = ["q", "recipient", "notes"] as const;
    for (const t of ["sale", "purchase", "sale_return", "purchase_return", "income", "expense", "transfer", "quote"] as const) {
      own.forEach((k) => expect(linkedFields(t).has(k)).toBe(false));
    }
    expect(linkedFields("quote").has("from")).toBe(false);
    expect(linkedFields("sale").has("from")).toBe(true);
  });

  it("the whole list is needed for any column filter or sort, not for the period alone", () => {
    expect(needsWholeList("sale", { filters: { invoice_date: { kind: "date", from: "2026-10-01" } }, sort: null })).toBe(false);
    expect(needsWholeList("sale", { filters: { invoice_date: { kind: "date", days: ["2026-10-03"] } }, sort: null })).toBe(true);
    expect(needsWholeList("sale", { filters: {}, sort: { col: "total", dir: "desc" } })).toBe(true);
    expect(needsWholeList("sale", { filters: { total: { kind: "number", op: "gt", a: 1 } }, sort: null })).toBe(true);
    expect(needsWholeList("quote", { filters: { valid_until: { kind: "date", from: "2026-10-01" } }, sort: null })).toBe(true);
  });
});
