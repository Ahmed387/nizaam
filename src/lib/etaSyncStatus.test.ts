import { describe, expect, it } from "vitest";
import { etaErrorAdvice, etaSyncView, manualWait, mmss, whenLabel } from "./etaSyncStatus";

// 2026-11-15 10:25 Cairo = 08:25 UTC
const now = new Date("2026-11-15T08:25:00Z");
const base = { enabled: true, last_error: null, is_owner: true, next_sync_at: "2026-11-15T09:07:00Z" };

describe("whenLabel", () => {
  it("today / yesterday / older, Cairo time", () => {
    expect(whenLabel("2026-11-15T08:07:00Z", now)).toMatch(/^النهارده .*١٠:٠٧/);
    expect(whenLabel("2026-11-14T21:07:00Z", now)).toMatch(/^امبارح .*١١:٠٧/);
    expect(whenLabel("2026-11-13T07:07:00Z", now)).toMatch(/^13\/11 — /);
    expect(whenLabel(null, now)).toBe("لسه");
  });
  it("uses Cairo day, not UTC day (23:30 UTC on 14/11 is 15/11 in Cairo)", () => {
    expect(whenLabel("2026-11-14T23:30:00Z", now)).toMatch(/^النهارده/);
  });
});

describe("manualWait", () => {
  it("counts down to the ready time, never below 0", () => {
    expect(manualWait("2026-11-15T08:26:35Z", now)).toBe(95);
    expect(manualWait("2026-11-15T08:20:00Z", now)).toBe(0);
    expect(manualWait(null, now)).toBe(0);
    expect(mmss(95)).toBe("1:35");
  });
});

describe("etaSyncView", () => {
  it("ok: last pull today and next run", () => {
    const v = etaSyncView({ ...base, last_sync_at: "2026-11-15T08:07:03Z" }, now);
    expect(v.tone).toBe("ok");
    expect(v.problem).toBeNull();
    expect(v.last).toMatch(/^النهارده/);
    expect(v.next).toMatch(/١١:٠٧/);
  });
  it("stale: no pull for more than two hours", () => {
    const v = etaSyncView({ ...base, last_sync_at: "2026-11-15T05:07:00Z" }, now);
    expect(v.tone).toBe("warn");
    expect(v.problem?.reason).toMatch(/واقف/);
  });
  it("error wins over stale and explains", () => {
    const v = etaSyncView({ ...base, last_sync_at: "2026-11-15T05:07:00Z", last_error: "ETA search 503: down" }, now);
    expect(v.tone).toBe("error");
    expect(v.problem?.reason).toMatch(/مش بترد/);
    expect(v.problem?.todo).toMatch(/١١:٠٧/);
  });
  it("off: tells the owner where to switch it on, a manager to ask the owner", () => {
    expect(etaSyncView({ ...base, enabled: false, last_sync_at: null }, now).problem?.todo).toMatch(/^شغّله/);
    expect(etaSyncView({ ...base, enabled: false, is_owner: false, last_sync_at: null }, now).problem?.todo).toMatch(/مالك الشركة/);
  });
  it("never pulled yet", () => {
    expect(etaSyncView({ ...base, last_sync_at: null }, now).problem?.reason).toMatch(/لسه محصلش/);
  });
});

describe("etaErrorAdvice", () => {
  const n = "الساعة 11:07";
  it("wrong credentials → settings", () => {
    const a = etaErrorAdvice("Client ID أو Client Secret غلط، أو النظام مش متسجّل في بيئة «الحقيقية» على البوابة", n, true);
    expect(a.todo).toMatch(/إعدادات الربط/);
  });
  it("no permission (403)", () => {
    expect(etaErrorAdvice("ETA search 403: forbidden", n, true).reason).toMatch(/صلاحية/);
  });
  it("rate limit (429) → wait", () => {
    expect(etaErrorAdvice("ETA search 429: too many", n, true).todo).toMatch(/11:07/);
  });
  it("server down / unreachable → nothing for the user to do", () => {
    expect(etaErrorAdvice("مش قادرين نوصل لسيرفر الضرايب دلوقتي — جرّب تاني بعد شوية", n, true).reason).toMatch(/المشكلة عندهم/);
    expect(etaErrorAdvice("ETA search 500: x", n, true).reason).toMatch(/المشكلة عندهم/);
  });
  it("unknown → show it as is and send it to support if it repeats", () => {
    const a = etaErrorAdvice("something odd", n, true);
    expect(a.reason).toBe("something odd");
    expect(a.todo).toMatch(/الدعم/);
  });
});
