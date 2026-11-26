import { describe, it, expect } from "vitest";
import { countDifference, countProblem, differenceText, treatmentOptions } from "./vesselCount";

const fmt = (n: number) => `${n} ج.م`;
const base = { method: "cash", actual: "900", isOwner: true, diff: -100, treatment: "" as const, employeeId: "", reason: "" };

describe("0294 vessel count: the difference", () => {
  it("actual − system, to the piaster", () => {
    expect(countDifference(1000, 900)).toBe(-100);
    expect(countDifference(100.1, 100.3)).toBe(0.2);
    expect(countDifference(500, 500)).toBe(0);
  });
  it("the line says shortage / surplus / equal", () => {
    expect(differenceText(-100, fmt)).toContain("عجز 100");
    expect(differenceText(50, fmt)).toContain("زيادة 50");
    expect(differenceText(0, fmt)).toContain("مطابق");
  });
});

describe("0294 vessel count: what the owner may choose", () => {
  it("a shortage: loss, on an employee, prior years", () => {
    expect(treatmentOptions(-100).map((t) => t.value)).toEqual(["loss", "employee", "prior_years"]);
  });
  it("a surplus: profit or prior years (never on an employee)", () => {
    expect(treatmentOptions(50).map((t) => t.value)).toEqual(["gain", "prior_years"]);
  });
  it("an equal count has nothing to choose", () => {
    expect(treatmentOptions(0)).toEqual([]);
  });
});

describe("0294 vessel count: before sending", () => {
  it("needs a vessel and a real amount (0 is fine, negative is not)", () => {
    expect(countProblem({ ...base, method: "" })).toContain("الوعاء");
    expect(countProblem({ ...base, actual: "" })).toContain("اكتب");
    expect(countProblem({ ...base, actual: "-5" })).toContain("اكتب");
    expect(countProblem({ ...base, actual: "0", diff: 0 })).toBeNull();
  });
  it("the owner must choose the treatment, the employee, and a reason", () => {
    expect(countProblem(base)).toContain("العجز");
    expect(countProblem({ ...base, treatment: "gain" })).toContain("العجز");
    expect(countProblem({ ...base, treatment: "employee" })).toContain("الموظف");
    expect(countProblem({ ...base, treatment: "loss" })).toContain("سبب");
    expect(countProblem({ ...base, treatment: "loss", reason: "فلوس ناقصة" })).toBeNull();
  });
  it("staff in approval mode only send the count — the owner chooses later", () => {
    expect(countProblem({ ...base, isOwner: false })).toBeNull();
  });
});
