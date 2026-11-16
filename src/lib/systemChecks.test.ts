import { describe, expect, it } from "vitest";
import { checkedText, isFresh } from "./systemChecks";

describe("saved system checks (0233)", () => {
  it("fresh when there is no request or the result is newer than it", () => {
    expect(isFresh({ checked_at: "2026-11-16T07:20:00Z", requested_at: null })).toBe(true);
    expect(isFresh({ checked_at: "2026-11-16T07:21:00Z", requested_at: "2026-11-16T07:20:30Z" })).toBe(true);
    expect(isFresh({ checked_at: "2026-11-16T07:20:00Z", requested_at: "2026-11-16T07:20:30Z" })).toBe(false);
    expect(isFresh({ checked_at: null, requested_at: "2026-11-16T07:20:30Z" })).toBe(false);
  });
  it("says when the last check ran", () => {
    const now = new Date("2026-11-16T07:45:00Z");
    expect(checkedText("2026-11-16T07:20:00Z", now)).toMatch(/^آخر فحص: النهارده .* — من 25 دقيقة$/);
    expect(checkedText(null, now)).toBe("لسه ما اتعملش فحص");
    expect(checkedText("1970-01-01T00:00:00Z", now)).toBe("لسه ما اتعملش فحص");
  });
});
