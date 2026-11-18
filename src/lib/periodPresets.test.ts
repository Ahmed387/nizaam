import { describe, it, expect } from "vitest";
import { periodRange, presetOf, weekStartSat, PERIOD_PRESETS } from "./periodPresets";

// Wednesday 18 Nov 2026
const T = "2026-11-18";

describe("period presets (week starts Saturday)", () => {
  it("week start is the Saturday on or before", () => {
    expect(weekStartSat("2026-11-18")).toBe("2026-11-14"); // Wed → Sat 14
    expect(weekStartSat("2026-11-14")).toBe("2026-11-14"); // Sat itself
    expect(weekStartSat("2026-11-20")).toBe("2026-11-14"); // Fri → same week
    expect(weekStartSat("2026-11-21")).toBe("2026-11-21"); // next Sat
  });
  it("days and weeks", () => {
    expect(periodRange("today", T)).toEqual({ from: T, to: T });
    expect(periodRange("yesterday", T)).toEqual({ from: "2026-11-17", to: "2026-11-17" });
    expect(periodRange("thisWeek", T)).toEqual({ from: "2026-11-14", to: T });
    expect(periodRange("lastWeek", T)).toEqual({ from: "2026-11-07", to: "2026-11-13" });
    expect(periodRange("weekBefore", T)).toEqual({ from: "2026-10-31", to: "2026-11-06" });
  });
  it("months (across the year boundary too)", () => {
    expect(periodRange("thisMonth", T)).toEqual({ from: "2026-11-01", to: T });
    expect(periodRange("lastMonth", T)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("monthBefore", T)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodRange("lastMonth", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("monthBefore", "2026-03-05")).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });
  it("years and the single days", () => {
    expect(periodRange("thisYear", T)).toEqual({ from: "2026-01-01", to: T });
    expect(periodRange("lastYear", T)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(periodRange("yearBefore", T)).toEqual({ from: "2024-01-01", to: "2024-12-31" });
    expect(periodRange("startThisYear", T)).toEqual({ from: "2026-01-01", to: "2026-01-01" });
    expect(periodRange("startLastYear", T)).toEqual({ from: "2025-01-01", to: "2025-01-01" });
    expect(periodRange("endLastYear", T)).toEqual({ from: "2025-12-31", to: "2025-12-31" });
  });
  it("presetOf finds the chosen preset, null for a custom range", () => {
    expect(presetOf("2026-11-07", "2026-11-13", T)).toBe("lastWeek");
    expect(presetOf("2026-11-02", "2026-11-13", T)).toBeNull();
    expect(PERIOD_PRESETS).toHaveLength(14);
  });
});
