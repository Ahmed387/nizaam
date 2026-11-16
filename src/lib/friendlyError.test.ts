import { describe, expect, it } from "vitest";
import { friendlyError, installFriendlyToasts } from "./friendlyError";

describe("friendlyError", () => {
  it("statement timeout → Arabic with what to do", () => {
    expect(friendlyError("canceling statement due to statement timeout")).toMatch(/^العملية أخدت وقت/);
    expect(friendlyError("x", "57014")).toMatch(/^العملية أخدت وقت/);
  });
  it("network, session, permission, duplicate", () => {
    expect(friendlyError("TypeError: Failed to fetch")).toMatch(/مفيش اتصال/);
    expect(friendlyError("JWT expired")).toMatch(/الجلسة انتهت/);
    expect(friendlyError("new row violates row-level security policy for table \"x\"")).toMatch(/صلاحية/);
    expect(friendlyError("duplicate key value violates unique constraint \"a\"")).toMatch(/مكرر/);
  });
  it("our Arabic messages pass through", () => {
    expect(friendlyError("الحساب ده مش متاح")).toBe("الحساب ده مش متاح");
  });
  it("keeps an Arabic lead-in and translates the server part", () => {
    expect(friendlyError("فشل الحفظ: canceling statement due to statement timeout")).toMatch(/^فشل الحفظ: العملية أخدت وقت/);
  });
  it("unknown English gets an Arabic wrapper with the original kept", () => {
    expect(friendlyError("something odd")).toMatch(/^حصل خطأ غير متوقع.*something odd$/);
  });
  it("wraps toast.error once", () => {
    const seen: unknown[] = [];
    const t = { error: (m: unknown) => seen.push(m) };
    installFriendlyToasts(t); installFriendlyToasts(t);
    t.error("Failed to fetch");
    expect(seen).toEqual([expect.stringMatching(/مفيش اتصال/)]);
  });
});
