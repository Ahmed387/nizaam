import { describe, it, expect } from "vitest";
import { computePayroll } from "./AttendanceBoard";

// محمد ياسر, Sept 2026, Friday off, base 4,000 → 26 working days, 153.85 a day (same case as drizzle/tests/0269_checks.sql)
const emp = { id: "e1", base_salary: 4000, work_days: [0, 1, 2, 3, 4, 6] };
const row = (date: string, status: string, extra = false) => ({ employee_id: "e1", date, status, paid_extra: extra });

describe("computePayroll (0269: only working days count)", () => {
  it("ignores a Friday «إجازة» and a Friday «غياب»", () => {
    const p = computePayroll(emp, "2026-09", [
      row("2026-09-04", "leave"), row("2026-09-10", "absent"), row("2026-09-11", "absent"), row("2026-09-12", "absent"),
    ], "2026-09-30");
    expect(p.workDays).toBe(26);
    expect(p.counts.absent).toBe(2);
    expect(p.counts.leave).toBe(0);
    expect(p.attendanceAmount).toBe(Math.round((4000 / 26) * 24));
  });

  it("pays a worked day off only when marked «يتحسب يوم شغل زيادة»", () => {
    const plain = computePayroll(emp, "2026-09", [row("2026-09-18", "present")], "2026-09-30");
    const marked = computePayroll(emp, "2026-09", [row("2026-09-18", "present", true)], "2026-09-30");
    expect(plain.attendanceAmount).toBe(4000);
    expect(marked.extraDays).toBe(1);
    expect(marked.attendanceAmount).toBe(4000 + Math.round(4000 / 26));
  });
});
