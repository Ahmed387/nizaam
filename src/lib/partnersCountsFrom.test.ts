import { describe, expect, it } from "vitest";
import { archiveProblem, canDeletePartner, countsFromWarning, monthChoices, monthLabel, suggestCountsFrom } from "@/lib/partners";

describe("«يتحسب من بداية شهر» (0295)", () => {
  it("money in counts from the month after the day it came in", () => {
    expect(suggestCountsFrom("in", "2026-11-15")).toBe("2026-12-01");
    expect(suggestCountsFrom("in", "2026-12-31")).toBe("2027-01-01");
  });
  it("money out stops counting in the month it went out", () => {
    expect(suggestCountsFrom("out", "2026-11-15")).toBe("2026-11-01");
  });
  it("never before January 2026 (old money)", () => {
    expect(suggestCountsFrom("in", "2024-03-10")).toBe("2026-01-01");
    expect(suggestCountsFrom("out", "2025-06-01")).toBe("2026-01-01");
    expect(suggestCountsFrom("in", "")).toBe("");
  });
  it("another month is a warning only, never an error", () => {
    expect(countsFromWarning("in", "2026-11-15", "2026-12-01")).toBeNull();
    expect(countsFromWarning("in", "2026-11-15", "2027-01-01")).toBeNull(); // later = fair to the others
    expect(countsFromWarning("in", "2026-11-15", "2026-11-01")).toContain("ديسمبر 2026");
    expect(countsFromWarning("out", "2026-11-15", "2026-11-01")).toBeNull();
    expect(countsFromWarning("out", "2026-11-15", "2026-10-01")).toBeNull();
    expect(countsFromWarning("out", "2026-11-15", "2026-12-01")).toContain("نوفمبر 2026");
  });
  it("month list: January 2026 → the month after today, plus the current value", () => {
    const m = monthChoices("2026-03-10");
    expect(m[0]).toBe("2026-01-01");
    expect(m[m.length - 1]).toBe("2026-04-01");
    expect(monthChoices("2026-03-10", "2026-09-01")).toContain("2026-09-01");
    expect(monthLabel("2026-02-01")).toBe("فبراير 2026");
  });
});

describe("delete / archive a partner (0295)", () => {
  const zero = { contributions: 0, capital_withdrawals: 0, capital: 0, profit: 0, profit_in: 0, profit_out: 0, advances: 0 };
  it("delete only with nothing at all", () => {
    expect(canDeletePartner(zero)).toBe(true);
    expect(canDeletePartner({ ...zero, contributions: 10000, capital_withdrawals: 10000 })).toBe(false);
  });
  it("archive only when capital, profit and advances are zero", () => {
    expect(archiveProblem(zero)).toBeNull();
    expect(archiveProblem({ ...zero, capital: 5000 })).toContain("اسحبه");
    expect(archiveProblem({ ...zero, profit: -10 })).toContain("صفّيه");
    expect(archiveProblem({ ...zero, advances: 1 })).toContain("اتسدّ");
  });
});
