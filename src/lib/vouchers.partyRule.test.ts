import { describe, it, expect } from "vitest";
import { categoryPartyRule, partyRuleProblem, type VoucherCategory } from "./vouchers";

const cat = (id: string, o: Partial<VoucherCategory>): VoucherCategory =>
  ({ id, tenant_id: "t", name: id, type: "payment", is_system: false, is_active: true, parent_id: null, system_key: null, gl_account_code: null, ...o });
const cats = [
  cat("sp", { name: "مدفوعات موردين", system_key: "supplier_payment", gl_account_code: "2100" }),
  cat("rs", { name: "مقبوضات من موردين", type: "receipt", gl_account_code: "2100" }),
  cat("in", { name: "تحصيل أقساط عملاء", type: "receipt", system_key: "installment", gl_account_code: "1200" }),
  cat("pc", { name: "مدفوعات لعملاء", gl_account_code: "1200" }),
  cat("sal", { name: "رواتب موظفين", system_key: "salary", gl_account_code: "5200" }),
  cat("sal-bonus", { name: "حافز", parent_id: "sal" }),
  cat("ar", { name: "رد سلف موظفين", type: "receipt", system_key: "advance_repayment", gl_account_code: "1450" }),
  cat("misc", { name: "نثريات", system_key: "other_payment", gl_account_code: "5900" }),
  cat("misc-tea", { name: "ضيافة", parent_id: "misc" }),
];

describe("0293: the category decides who the voucher is for", () => {
  it("customer / supplier categories", () => {
    expect(categoryPartyRule("sp", cats)).toBe("supplier");
    expect(categoryPartyRule("rs", cats)).toBe("supplier");
    expect(categoryPartyRule("in", cats)).toBe("customer");
    expect(categoryPartyRule("pc", cats)).toBe("customer");
  });
  it("employee categories, a sub-item follows its parent", () => {
    expect(categoryPartyRule("sal", cats)).toBe("employee");
    expect(categoryPartyRule("sal-bonus", cats)).toBe("employee");
    expect(categoryPartyRule("ar", cats)).toBe("employee");
  });
  it("everything else stays optional", () => {
    expect(categoryPartyRule("misc", cats)).toBeNull();
    expect(categoryPartyRule("misc-tea", cats)).toBeNull();
    expect(categoryPartyRule("", cats)).toBeNull();
  });
  it("says what is missing", () => {
    expect(partyRuleProblem("supplier", "مدفوعات موردين", "", "")).toBe("التصنيف «مدفوعات موردين» لازم تختار له المورد");
    expect(partyRuleProblem("supplier", "مدفوعات موردين", "customer", "c1")).toContain("المورد");
    expect(partyRuleProblem("customer", "تحصيل أقساط عملاء", "customer", "")).toContain("العميل");
    expect(partyRuleProblem("employee", "رواتب موظفين", "employee", "")).toContain("الموظفين الشغالين");
    expect(partyRuleProblem("supplier", "x", "supplier", "s1")).toBeNull();
    expect(partyRuleProblem(null, "x", "", "")).toBeNull();
  });
});
