import { describe, expect, it } from "vitest";
import { afterDiscount, countdownText, groupFeatures, limitText, periodEnd, statusLabel } from "./plans";

describe("plans helpers", () => {
  it("discount", () => {
    expect(afterDiscount(2200, 10)).toBe(1980);
    expect(afterDiscount(990, 0)).toBe(990);
  });
  it("period end like Postgres (start + 1 month / year − 1 day)", () => {
    expect(periodEnd("2026-11-16", "monthly")).toBe("2026-12-15");
    expect(periodEnd("2026-11-16", "yearly")).toBe("2027-11-15");
    expect(periodEnd("2026-01-31", "monthly")).toBe("2026-02-27"); // Postgres: 2026-02-28 − 1
    expect(periodEnd("2026-12-01", "monthly")).toBe("2026-12-31");
    expect(periodEnd("2026-11-16", "unlimited")).toBeNull();
  });
  it("texts", () => {
    expect(limitText(null)).toBe("بلا حد");
    expect(statusLabel("grace")).toBe("فترة سماح");
    expect(countdownText(12)).toBe("باقي 12 يوم");
    expect(countdownText(0)).toBe("بيخلص النهارده");
    expect(countdownText(-3)).toBe("خلص من 3 يوم");
    expect(countdownText(null)).toBe("مفتوح");
  });
  it("tabs sit under their page", () => {
    const g = groupFeatures([
      { key: "a", label: "A", section: "S", parent: null, kind: "page" },
      { key: "b", label: "B", section: "S", parent: null, kind: "page" },
      { key: "a1", label: "A1", section: "S", parent: "a", kind: "page" },
      { key: "a2", label: "A2", section: "S", parent: "a", kind: "page" },
    ]);
    expect(g[0].items.map((x) => x.key)).toEqual(["a", "a1", "a2", "b"]);
  });
});
