import { describe, expect, it } from "vitest";
import { avgLen, colKind, isEssential, KIND_MIN, matchCol, pickFlex, pinOffsets, scaleWidths, shortView, tableMinWidth } from "@/lib/tableLayout";

describe("column kinds and minimum widths", () => {
  it("dates, numbers, actions, check boxes, text", () => {
    expect(colKind("التاريخ", ["2026-11-27", "27/11/2026", "2026-11-01"])).toBe("date");
    expect(colKind("الإجمالي", ["50,000", "12,400.50", "316,269.95 مدين"])).toBe("number");
    expect(colKind("إجراءات", ["", ""])).toBe("actions");
    expect(colKind("", ["", ""], { hasCheckbox: true })).toBe("check");
    expect(colKind("العميل", ["أحمد", "مصنع النيل", "محل السلام"])).toBe("text");
    expect(colKind("ملاحظات", [])).toBe("text");
  });
  it("each kind has its own minimum, a date wider than a number", () => {
    expect(KIND_MIN.date).toBeGreaterThan(KIND_MIN.number);
    expect(KIND_MIN.text).toBeGreaterThan(KIND_MIN.check);
  });
});

describe("the flexible column", () => {
  it("is the text column with the LONGEST content, not the last one", () => {
    const cols = [
      { label: "العميل", kind: "text" as const, avg: avgLen(["أحمد", "مصنع النيل"]) },
      { label: "ملاحظات", kind: "text" as const, avg: avgLen(["تسليم الخميس مع فاتورة الشراء المرتبطة", ""]) },
      { label: "البيان", kind: "text" as const, avg: avgLen(["", ""]) },
      { label: "الإجمالي", kind: "number" as const, avg: 30 },
    ];
    expect(pickFlex(cols)).toBe("ملاحظات");
    expect(pickFlex(cols.map((c) => (c.label === "ملاحظات" ? { ...c, hidden: true } : c)))).toBe("العميل");
    expect(pickFlex([{ label: "الإجمالي", kind: "number", avg: 9 }])).toBeNull();
  });
});

describe("option ج: a smaller screen shrinks the saved widths in proportion", () => {
  const w = { "الفاتورة": 200, "العميل": 300, "الإجمالي": 100 };
  const mins = { "الفاتورة": 80, "العميل": 80, "الإجمالي": 56 };
  it("same or bigger screen: as saved", () => {
    expect(scaleWidths(w, 1200, 1200, mins)).toEqual(w);
    expect(scaleWidths(w, 1200, 1600, mins)).toEqual(w);
    expect(scaleWidths(w, undefined, 600, mins)).toEqual(w);
  });
  it("half the screen: half the width, never below the minimum", () => {
    expect(scaleWidths(w, 1200, 600, mins)).toEqual({ "الفاتورة": 100, "العميل": 150, "الإجمالي": 56 });
  });
  it("table minimum = shown columns", () => {
    expect(tableMinWidth(Object.keys(w), (l) => w[l as keyof typeof w], ["العميل"])).toBe(300);
  });
});

describe("pinned columns", () => {
  const width = (l: string) => ({ a: 100, b: 150, c: 80, d: 60 } as Record<string, number>)[l];
  it("each pinned column starts after the pinned ones before it, in table order", () => {
    expect(pinOffsets(["a", "b", "c", "d"], ["c", "a"], width)).toEqual({ a: 0, c: 100 });
  });
  it("a hidden pinned column takes no room", () => {
    expect(pinOffsets(["a", "b", "c"], ["a", "b", "c"], width, ["b"])).toEqual({ a: 0, c: 100 });
  });
});

describe("«الأعمدة»: groups, مختصر, search", () => {
  it("essential columns", () => {
    ["رقم الفاتورة", "العميل", "الإجمالي", "التاريخ", "الحالة", "إجراءات", "الرصيد الحالي"].forEach((l) => expect(isEssential(l)).toBe(true));
    ["الفرع / الوعاء", "ملاحظات", "المستلم", "المصدر"].forEach((l) => expect(isEssential(l)).toBe(false));
  });
  it("مختصر hides the details, never everything", () => {
    expect(shortView(["رقم الفاتورة", "ملاحظات", "الإجمالي"])).toEqual(["ملاحظات"]);
    expect(shortView(["ملاحظات", "المصدر"])).toEqual([]);
  });
  it("search forgives spelling and order", () => {
    expect(matchCol("رقم الفاتورة", "فاتوره")).toBe(true);
    expect(matchCol("طريقة الدفع", "دفع طريقه")).toBe(true);
    expect(matchCol("العميل", "مورد")).toBe(false);
  });
  it("pickFlex skips a column the user sized himself, unless he sized every text column", () => {
    const cols = [
      { label: "المورد", kind: "text" as const, avg: 30, resized: true },
      { label: "البيان", kind: "text" as const, avg: 12 },
      { label: "المبلغ", kind: "number" as const, avg: 40 },
    ];
    expect(pickFlex(cols)).toBe("البيان");
    expect(pickFlex(cols.map((c) => ({ ...c, resized: true })))).toBe("المورد");
  });
});
