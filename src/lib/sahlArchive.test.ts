import { describe, it, expect } from "vitest";
import { matchKnownBranch, parseInvoiceSheet, parseVoucherSheet, sahlBranchFromName, sahlKind, withBranch, planCounts } from "./historicalExcelImporter";

// rows exactly as the owner's «سهل» files read (sahl4.zip, 10–15/11/2026), dates as Excel day numbers
const D15 = 46341; // 2026-11-15
const sale = [
  ["بيع"],
  ["التاريخ :   11/10/2026 - 11/15/2026"],
  [null, "التاريخ", "الوقت", "رقم الفاتورة", "الحساب", "طريقة السداد", "كمية", "خصم", "النهائى", "درج النقدية", "فودافون كاش", "انستاباي", "الخزينة", "مسدد نقدا", "الآجل", "المخزن", "مندوب البيع", "إضافة المستخدم", "وقت الإضافة", "تعديل المستخدم", "وقت التعديل", "المستحق", "ربح"],
  [1, D15, 0.87, 1305, "مادونا ابو قرقاص", "نقدي", 2, 0, 23800, 0, 0, 23800, 0, 23800, 0, "المخزن الرئيسي", null, "مدير النظام", null, null, null, 0, 6300],
  [null, "رقم الصنف", "اسم الصنف", "وحدة", "المتاح", "كمية", "السعر", "الخصم", "ربح", "النهائى"],
  [null, 1856, "عجان فريش 8لتر 1900 وات", null, -1, 1, 6000, 0, 6000, 6000],
  [null, 512, "غسالة اطباق بيكو 5 برنامج", null, 1, 1, 17800, 0, 300, 17800],
  [null, null, null, null, null, 2, null, 0, 6300, 23800],
  [2, D15, 0.76, 1304, "يسري عبدالناصر", "آجل", 1, 0, 15200, 0, 0, 0, 0, 0, 15200, "المخزن الرئيسي", null, "مدير النظام", null, null, null, 5700, 100],
];
const ret = [
  ["مرتجع بيع"],
  ["التاريخ :   11/10/2026 - 11/15/2026"],
  [null, "التاريخ", "الوقت", "رقم الفاتورة", "الفاتورة المرتجعة", "الحساب", "طريقة السداد", "كمية", "خصم", "النهائى", "درج النقدية", "انستاباي / ح البنك الاهلي للشركة", "فودافون كاش", "الخزينة", "درج النقدية القديم", "المستحق", "ربح", "المخزن", "مندوب البيع", "إضافة المستخدم", "وقت الإضافة", "تعديل المستخدم", "وقت التعديل", "مسدد نقدا", "الآجل"],
  [1, D15, 0.7, 1289, 8524, "معرض سكة تلة (حساب خاص)", "آجل", 1, 0, -5450, 0, 0, 0, 0, 0, -5450, -50, "المخزن الرئيسي (1)", null, "ا/محمد طه", null, null, null, 0, -5450],
];
const expense = [
  ["صرف"],
  ["التاريخ :   11/10/2026 - 11/15/2026"],
  [null, "التاريخ", "الوقت", "الحركة", "رقم الحركة", "المرجع", "القيمة", "البند", "الحساب", "الخزينة", "درج النقدية", "انستاباي", "فودافون كاش", "الخزينة", "درج النقدية القديم", "إضافة المستخدم", "وقت الإضافة", "تعديل المستخدم", "وقت التعديل", "ملاحظات"],
  [1, D15, 0.88, "صرف", 14631, null, 2500, null, "ابراهيم الندي", "فودافون كاش", 0, 0, 2500, 0, 0, "ا/محمد طه", null, null, null, "من رقم محمود علاء"],
  [2, D15, 0.86, "صرف", 14630, null, 50, "9- اكراميات العمال", null, "درج النقدية", 50, 0, 0, 0, 0, "ا/محمد طه", null, null, null, "سواق فريش"],
];

describe("«سهل» files in the archive (0272)", () => {
  it("reads the type from the sheet and the branch from the file name", () => {
    expect(sahlKind(sale)).toBe("sales");
    expect(sahlKind(ret)).toBe("sales_returns");
    expect(sahlKind(expense)).toBe("expense");
    expect(sahlKind([["x"]], "تقرير فواتير مرتجع الشراء ل مخزن شلبى سنة 2026.xlsx")).toBe("purchase_returns");
    expect(sahlBranchFromName("تقرير فواتير البيع ل معرض سكة تلة سنة 2025.xlsx")).toBe("معرض سكة تلة");
    expect(sahlBranchFromName("sahl2.zip#تقرير فواتير البيع ل معرض سكة تلةمن 28-10-2026 الى 10-11-2026.xlsx")).toBe("معرض سكة تلة");
    expect(sahlBranchFromName("تقرير فواتير البيع ل ممعرض عبدالمنعم من 28-10-2026 الى 10-11-2026.xlsx")).toBe("معرض عبدالمنعم");
    expect(sahlBranchFromName("تقرير فواتير صرف ل مخزن شلبي من 10-11-2026 الى 15-11-2026.xlsx")).toBe("مخزن شلبي");
  });

  it("sale: party from «الحساب», paid = «مسدد نقدا» (not the cash drawer), day without time-zone shift", () => {
    const p = parseInvoiceSheet(sale, "معرض سكة تلة", "sales");
    expect(p.invoices).toHaveLength(2);
    const a = p.invoices.find((x) => x.invoice.invoice_no === "1305")!;
    expect(a.invoice.date).toBe("2026-11-15");
    expect(a.invoice.party_name).toBe("مادونا ابو قرقاص");
    expect(a.invoice.paid_cash).toBe(23800);
    expect(a.invoice.total_amount).toBe(23800);
    expect(a.items.map((i) => [i.item_code, i.qty, i.total])).toEqual([["1856", 1, 6000], ["512", 1, 17800]]);
    const b = p.invoices.find((x) => x.invoice.invoice_no === "1304")!;
    expect(b.invoice.credit).toBe(15200);
  });

  it("return: the document number is «رقم الفاتورة», not the report's row number", () => {
    const p = parseInvoiceSheet(ret, "مخزن شلبي", "sales_returns");
    expect(p.invoices[0].invoice.invoice_no).toBe("1289");
    expect(p.invoices[0].invoice.returned_invoice_no).toBe("8524");
  });

  it("voucher: number = «رقم الحركة», party = «الحساب», category = «البند»", () => {
    const p = parseVoucherSheet(expense, "مخزن شلبي", "expense");
    expect(p.vouchers.map((v) => [v.voucher_no, v.party_name, v.amount, v.category])).toEqual([
      ["14631", "ابراهيم الندي", 2500, "غير مبوّب"],
      ["14630", null, 50, "9- اكراميات العمال"],
    ]);
  });

  it("changing the branch before upload changes every row", () => {
    const plan = { fileName: "x.xlsx", sha256: "a", kind: "sales" as const, branch: "معرض سكة تلة", dateFrom: "2026-11-15", dateTo: "2026-11-15",
      parsed: parseInvoiceSheet(sale, "معرض سكة تلة", "sales") };
    const p2 = withBranch(plan, "سكة تلة");
    expect(p2.parsed.invoices.every((i) => i.invoice.branch_name === "سكة تلة" && i.items.every((it) => it.branch_name === "سكة تلة"))).toBe(true);
    expect(planCounts(p2)).toEqual({ docs: 2, items: 2, total: 39000 });
  });

  it("a branch spelled differently joins the one already in the archive", () => {
    const known = ["مخزن شلبي", "معرض عبد المنعم", "معرض سكة تلة"];
    expect(matchKnownBranch("مخزن شلبى", known)).toBe("مخزن شلبي");
    expect(matchKnownBranch("معرض عبدالمنعم", known)).toBe("معرض عبد المنعم");
    expect(matchKnownBranch("معرض سكة تله", known)).toBe("معرض سكة تلة");
    expect(matchKnownBranch("فرع جديد", known)).toBe("فرع جديد");
  });
});
