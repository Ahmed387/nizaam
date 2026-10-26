import { describe, expect, it } from "vitest";
import {
  BLANK, EMPTY_STATE, cellMatches, describeFilter, detectKind, facets, isSummable, parseCell, parseDate, parseNumber,
  sortOrder, sumColumn, visibleRows, type FilterState,
} from "./tableFilter";

describe("parsing what the person sees", () => {
  it("reads money, negatives and percents", () => {
    expect(parseNumber("70,600 ج.م")).toBe(70600);
    expect(parseNumber("1,234.50")).toBe(1234.5);
    expect(parseNumber("−1,200")).toBe(-1200);
    expect(parseNumber("(350)")).toBe(-350);
    expect(parseNumber("12.5%")).toBe(12.5);
    expect(parseNumber("١٢٣")).toBe(123);
    expect(parseNumber("1,000 / 500")).toBeUndefined();
    expect(parseNumber("IN04506")).toBeUndefined();
  });
  it("reads the app's dates", () => {
    expect(parseDate("3 يونيو 2026")?.day).toBe("2026-06-03");
    expect(parseDate("3 يونيو 2026 في 1:00 م")!.ts).toBeGreaterThan(parseDate("3 يونيو 2026 في 9:00 ص")!.ts);
    expect(parseDate("2026-10-01")?.day).toBe("2026-10-01");
    expect(parseDate("01/10/2026")?.day).toBe("2026-10-01");
    expect(parseDate("منذ 5 دقائق")).toBeUndefined();
    expect(parseDate("3 يونيو 2026 فاتورة")).toBeUndefined();
  });
  it("treats dashes and empty as blank", () => {
    expect(parseCell("—").blank).toBe(true);
    expect(parseCell("  ").blank).toBe(true);
    expect(parseCell("نشطة").blank).toBe(false);
  });
  it("detects the column kind, keeping phones and codes as text", () => {
    expect(detectKind("المبلغ", ["1,000 ج.م", "—", "250"].map(parseCell))).toBe("number");
    expect(detectKind("التليفون", ["01012345678", "01122233344"].map(parseCell))).toBe("text");
    expect(detectKind("الكمية", ["05", "3"].map(parseCell))).toBe("text");
    expect(detectKind("التاريخ", ["3 يونيو 2026", "2026-06-04"].map(parseCell))).toBe("date");
    expect(detectKind("العميل", ["أسامة", "جارحي"].map(parseCell))).toBe("text");
  });
  it("sums amounts but never balances, prices or percents", () => {
    const cells = ["1", "2"].map(parseCell);
    expect(isSummable("المبلغ", "number", cells)).toBe(true);
    expect(isSummable("الرصيد الجاري", "number", cells)).toBe(false);
    expect(isSummable("سعر الوحدة", "number", cells)).toBe(false);
    expect(isSummable("الهامش %", "number", cells)).toBe(false);
  });
});

// the live example shown to the owner: sales of سكة تلة, June 2026 (cut down)
const cols = ["العميل", "التصنيف", "المبلغ", "التاريخ", "الملاحظات"];
const raw = [
  ["اسامة الراعى الصالح", "آجل", "70,600 ج.م", "3 يونيو 2026", "—"],
  ["اسامة الراعى الصالح", "آجل", "12,000 ج.م", "5 يونيو 2026", "تسليم المخزن"],
  ["اسامة الراعى الصالح", "آجل", "58,600 ج.م", "9 يونيو 2026", ""],
  ["جارحي", "نقدي", "21,000 ج.م", "9 يونيو 2026", "—"],
  ["المخزن الرئيسي", "آجل", "4,500 ج.م", "12 يونيو 2026", "—"],
  ["جارحي", "آجل", "30,000 ج.م", "15 يونيو 2026", "تسليم المخزن"],
];
const rows = raw.map((r) => r.map(parseCell));
const st = (filters: FilterState["filters"], sort: FilterState["sort"] = null): FilterState => ({ filters, sort });

describe("filters like Excel", () => {
  it("one column: OR inside it", () => {
    const v = visibleRows(rows, cols, st({ العميل: { kind: "values", values: ["جارحي", "المخزن الرئيسي"] } }));
    expect(v.filter(Boolean)).toHaveLength(3);
  });
  it("several columns: AND between them", () => {
    const v = visibleRows(rows, cols, st({
      العميل: { kind: "values", values: ["اسامة الراعى الصالح"] },
      المبلغ: { kind: "number", op: "gt", a: 20000 },
    }));
    expect(v).toEqual([true, false, true, false, false, false]);
  });
  it("number conditions", () => {
    expect(cellMatches(parseCell("20,000"), { kind: "number", op: "eq", a: 20000 })).toBe(true);
    expect(cellMatches(parseCell("20,000"), { kind: "number", op: "between", a: 25000, b: 15000 })).toBe(true);
    expect(cellMatches(parseCell("—"), { kind: "number", op: "lt", a: 5 })).toBe(false);
  });
  it("dates: chosen days and a from–to range", () => {
    expect(visibleRows(rows, cols, st({ التاريخ: { kind: "date", days: ["2026-06-09"] } })).filter(Boolean)).toHaveLength(2);
    expect(visibleRows(rows, cols, st({ التاريخ: { kind: "date", from: "2026-06-05", to: "2026-06-12" } })).filter(Boolean)).toHaveLength(4);
  });
  it("blanks are a value of their own", () => {
    const v = visibleRows(rows, cols, st({ الملاحظات: { kind: "values", values: [BLANK] } }));
    expect(v.filter(Boolean)).toHaveLength(4);
  });
  it("each list shows only what the other filters leave, with counts", () => {
    const s = st({ العميل: { kind: "values", values: ["اسامة الراعى الصالح"] } });
    expect(facets(rows, cols, s, "التصنيف", "text").map((f) => [f.label, f.count])).toEqual([["آجل", 3]]);
    // its own filter does not shrink its own list
    expect(facets(rows, cols, s, "العميل", "text").map((f) => f.label)).toEqual(["اسامة الراعى الصالح", "المخزن الرئيسي", "جارحي"]);
  });
  it("sorts numbers, dates and text, blanks last, stable", () => {
    expect(sortOrder(rows, 2, "desc", "number")).toEqual([0, 2, 5, 3, 1, 4]);
    expect(sortOrder(rows, 3, "asc", "date")).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sortOrder(rows, 4, "asc", "text").slice(-4)).toEqual([0, 2, 3, 4]);
  });
  it("totals add only the rows still shown", () => {
    const v = visibleRows(rows, cols, st({ العميل: { kind: "values", values: ["اسامة الراعى الصالح"] }, المبلغ: { kind: "number", op: "gt", a: 20000 } }));
    expect(sumColumn(rows, 2, v)).toBe(129200);
  });
  it("chips text", () => {
    expect(describeFilter("المبلغ", { kind: "number", op: "gt", a: 20000 })).toBe("المبلغ أكبر من 20,000");
    expect(describeFilter("العميل", { kind: "values", values: ["أ", "ب", "ج"] })).toBe("العميل: أ، ب و1 كمان");
    expect(visibleRows(rows, cols, EMPTY_STATE).every(Boolean)).toBe(true);
  });
});
