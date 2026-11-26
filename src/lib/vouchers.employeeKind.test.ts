import { describe, it, expect } from "vitest";
import { categoryEmployeeKind, isReservedVoucherCategory, salaryDuplicateWarning, type VoucherCategory } from "./vouchers";

const cat = (id: string, o: Partial<VoucherCategory>): VoucherCategory =>
  ({ id, tenant_id: "t", name: id, type: "payment", is_system: false, is_active: true, parent_id: null, system_key: null, gl_account_code: null, ...o });
const cats = [
  cat("sal", { name: "رواتب موظفين", system_key: "salary", gl_account_code: "5200" }),
  cat("sal-bonus", { name: "حافز", parent_id: "sal" }),
  cat("adv", { name: "سلف موظفين", system_key: "advance", gl_account_code: "1450" }),
  cat("ar", { name: "رد سلف موظفين", type: "receipt", system_key: "advance_repayment", gl_account_code: "1450" }),
  cat("misc", { name: "نثريات", system_key: "other_payment" }),
];

describe("0294: the employee kind of a voucher category", () => {
  it("salary, advance, repayment — and a child takes its parent's kind", () => {
    expect(categoryEmployeeKind("sal", cats)).toBe("salary");
    expect(categoryEmployeeKind("sal-bonus", cats)).toBe("salary");
    expect(categoryEmployeeKind("adv", cats)).toBe("advance");
    expect(categoryEmployeeKind("ar", cats)).toBe("advance_repayment");
  });
  it("any other category has no employee kind", () => {
    expect(categoryEmployeeKind("misc", cats)).toBeNull();
    expect(categoryEmployeeKind(null, cats)).toBeNull();
  });
});

describe("0294: salary paid twice", () => {
  it("no payroll that month → no warning", () => {
    expect(salaryDuplicateWarning("أحمد", "2026-11", [])).toBeNull();
  });
  it("payroll paid → names the employee, the month and the amount", () => {
    const w = salaryDuplicateWarning("أحمد", "2026-11", [{ net_salary: 5000 }, { net_salary: 1500 }])!;
    expect(w).toContain("أحمد");
    expect(w).toContain("2026-11");
    expect(w).toContain("6,500");
    expect(w).toContain("مرتين");
  });
});

describe("0294: vessel-count categories are not for hand-written vouchers", () => {
  it.each(["vessel_short_loss", "vessel_short_prior", "vessel_over_gain", "vessel_over_prior"])("%s is reserved", (k) => {
    expect(isReservedVoucherCategory(cat("x", { system_key: k, name: "عجز خزنة" }))).toBe(true);
  });
});
