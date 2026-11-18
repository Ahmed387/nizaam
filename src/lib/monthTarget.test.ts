import { describe, it, expect } from "vitest";
import { targetView } from "./monthTarget";

describe("targetView", () => {
  it("no target → no card", () => {
    expect(targetView(500, 0)).toBeNull();
  });
  it("sales 201,262.50 of 1,000,000 → 20.1 %, 798,737.50 left", () => {
    const v = targetView(201262.5, 1000000)!;
    expect(v.pct).toBeCloseTo(20.13, 2);
    expect(v.remaining).toBeCloseTo(798737.5, 2);
    expect(v.onTrack).toBe(false);
  });
  it("a loss counts as 0 achieved, the whole target is left", () => {
    const v = targetView(-18063.91, 100000)!;
    expect(v.pct).toBe(0);
    expect(v.remaining).toBe(100000);
  });
  it("above the target → 100 %, reached", () => {
    const v = targetView(120000, 100000)!;
    expect(v.pct).toBe(100);
    expect(v.reached).toBe(true);
    expect(v.onTrack).toBe(true);
  });
});
