import { describe, it, expect } from "vitest";
import { checkPermission, DEFAULT_ROLE_PERMISSIONS } from "./roles";
import {
  allowAllPage, clearExtras, diffOverrides, effective, keyLabel, pageChanged, resetPage, setOverride, sidebarPreview, toRows,
} from "./permissionModel";
import { PERMISSION_CATALOG } from "./permissionCatalog";

const rp = { cashier: { ...DEFAULT_ROLE_PERMISSIONS.cashier } } as Record<string, Record<string, boolean>>;
const page = (k: string) => PERMISSION_CATALOG.flatMap((s) => s.pages).find((p) => p.key === k)!;

describe("checkPermission with parts", () => {
  it("a part with no rule follows its page", () => {
    expect(checkPermission(["cashier"], rp, "part.dashboard.sales_today.view", {})).toBe(true);
    expect(checkPermission(["cashier"], rp, "part.treasury.balance.view", {})).toBe(false); // cashier has no treasury.view
  });
  it("a part override wins over the page", () => {
    expect(checkPermission(["cashier"], rp, "part.dashboard.till_balance.view", { "part.dashboard.till_balance.view": false })).toBe(false);
  });
  it("closing the page closes its parts", () => {
    expect(checkPermission(["cashier"], rp, "part.dashboard.sales_today.view", { "dashboard.view": false })).toBe(false);
  });
  it("a role row for a part wins over the page", () => {
    const withRow = { cashier: { ...rp.cashier, "part.dashboard.till_balance.view": false } };
    expect(checkPermission(["cashier"], withRow, "part.dashboard.till_balance.view", {})).toBe(false);
  });
  it("owner / admin see every part", () => {
    expect(checkPermission(["owner"], {}, "part.dashboard.till_balance.view", {})).toBe(true);
    expect(checkPermission(["admin"], {}, "part.anything.x.view", {})).toBe(true);
  });
  it("old sub-section inheritance still works", () => {
    const m = { accountant: { "admin_finance.view": true } };
    expect(checkPermission(["accountant"], m, "admin_finance_vouchers.view", {})).toBe(true);
  });
});

describe("overrides model", () => {
  it("a value equal to the template is never stored", () => {
    let o = setOverride("cashier", rp, {}, "sales.create", true); // template already allows
    expect(o).toEqual({});
    o = setOverride("cashier", rp, o, "sales.create", false);
    expect(o).toEqual({ "sales.create": false });
    o = setOverride("cashier", rp, o, "sales.create", true); // back to template → override dropped
    expect(o).toEqual({});
  });

  it("hiding one card only stores that card", () => {
    const o = setOverride("cashier", rp, {}, "part.dashboard.till_balance.view", false);
    expect(o).toEqual({ "part.dashboard.till_balance.view": false });
    expect(effective("cashier", rp, o, "part.dashboard.sales_today.view")).toBe(true);
  });

  it("extra vs revoked, and «شيل الزيادة بس» keeps the restrictions", () => {
    const o = { "treasury.view": true, "sales.create": false };
    expect(diffOverrides("cashier", rp, o)).toEqual({ extra: ["treasury.view"], revoked: ["sales.create"] });
    expect(clearExtras("cashier", rp, o)).toEqual({ "sales.create": false });
  });

  it("«الكل مسموح» opens the page, its actions and its parts; «رجّعها للقالب» clears them", () => {
    const p = page("shipments");
    const o = allowAllPage("cashier", rp, p, {});
    expect(o["shipments.view"]).toBe(true);
    expect(o["shipments.delete"]).toBe(true);
    expect(pageChanged(p, o)).toBe(true);
    expect(resetPage(p, o)).toEqual({});
  });

  it("sidebar preview follows the switches", () => {
    const before = sidebarPreview("cashier", rp, {});
    expect(before.find((s) => s.id === "general")!.items).toContain("الرئيسية");
    const after = sidebarPreview("cashier", rp, { "dashboard.view": false });
    expect(after.find((s) => s.id === "general")!.items).not.toContain("الرئيسية");
    expect(before.map((s) => s.label)).toEqual(["عام", "العمليات", "المالية", "الإدارة"]);
  });

  it("labels and rows for saving", () => {
    expect(keyLabel("part.dashboard.till_balance.view")).toBe("الرئيسية ← رصيد الخزنة");
    expect(keyLabel("sales.delete")).toBe("المبيعات — يلغي");
    expect(toRows({ "a.view": true })).toEqual([{ key: "a.view", allowed: true }]);
  });
});
