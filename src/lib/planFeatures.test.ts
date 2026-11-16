import { describe, expect, it } from "vitest";
import { featureOfKey, planAllows, planBanner, planReadOnly } from "./planFeatures";

describe("plan features", () => {
  it("featureOfKey", () => {
    expect(featureOfKey("sales.create")).toBe("sales");
    expect(featureOfKey("part.dashboard.sales_today.view")).toBe("dashboard");
    expect(featureOfKey("admin_eta.view")).toBe("admin_eta");
  });
  it("a closed page closes every key of it and of its tabs", () => {
    const d = new Set(["admin_finance", "employees"]);
    expect(planAllows(d, "employees.view")).toBe(false);
    expect(planAllows(d, "part.employees.x.view")).toBe(false);
    expect(planAllows(d, "admin_eta.view")).toBe(false); // tab of «المالية»
    expect(planAllows(d, "sales.create")).toBe(true);
    expect(planAllows(new Set(), "anything.view")).toBe(true);
  });
  it("banner and read-only", () => {
    expect(planBanner(null)).toBeNull();
    expect(planBanner({ has_plan: true, unlimited: true, status: "active" })).toBeNull();
    expect(planBanner({ has_plan: true, plan: "أساسي", status: "ending", days_left: 4 })!.text).toContain("بعد 4 يوم");
    expect(planBanner({ has_plan: true, plan: "أساسي", status: "grace", days_left: -2, grace_days: 7 })!.text).toContain("باقي 5 يوم");
    expect(planReadOnly({ has_plan: true, status: "expired" })).toBe(true);
    expect(planReadOnly({ has_plan: true, status: "grace" })).toBe(false);
    expect(planReadOnly({ has_plan: false })).toBe(false);
  });
});
