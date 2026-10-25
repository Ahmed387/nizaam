import { describe, it, expect } from "vitest";
import { checkPermission, DEFAULT_ROLE_PERMISSIONS } from "./roles";
import {
  allowAllPage, clearExtras, diffOverrides, effective, keyLabel, pageChanged, resetPage, setOverride, toRows, fromRows, branchOverrides, parseKey,
} from "./permissionModel";
import { PERMISSION_CATALOG } from "./permissionCatalog";

const rp = { cashier: { ...DEFAULT_ROLE_PERMISSIONS.cashier } } as Record<string, Record<string, boolean>>;
const C = ["cashier"];
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
    let o = setOverride(C, rp, {}, "sales.create", true); // template already allows
    expect(o).toEqual({});
    o = setOverride(C, rp, o, "sales.create", false);
    expect(o).toEqual({ "sales.create": false });
    o = setOverride(C, rp, o, "sales.create", true); // back to template → override dropped
    expect(o).toEqual({});
  });

  it("hiding one card only stores that card", () => {
    const o = setOverride(C, rp, {}, "part.dashboard.till_balance.view", false);
    expect(o).toEqual({ "part.dashboard.till_balance.view": false });
    expect(effective(C, rp, o, "part.dashboard.sales_today.view")).toBe(true);
  });

  it("extra vs revoked, and «شيل الزيادة بس» keeps the restrictions", () => {
    const o = { "treasury.view": true, "sales.create": false };
    expect(diffOverrides(C, rp, o)).toEqual({ extra: ["treasury.view"], revoked: ["sales.create"] });
    expect(clearExtras(C, rp, o)).toEqual({ "sales.create": false });
  });

  it("«الكل مسموح» opens the page, its actions and its parts; «رجّعها للقالب» clears them", () => {
    const p = page("shipments");
    const o = allowAllPage(C, rp, p, {});
    expect(o["shipments.view"]).toBe(true);
    expect(o["shipments.delete"]).toBe(true);
    expect(pageChanged(p, o)).toBe(true);
    expect(resetPage(p, o)).toEqual({});
  });

  it("labels and rows for saving", () => {
    expect(keyLabel("part.dashboard.till_balance.view")).toBe("الرئيسية ← رصيد الخزنة");
    expect(keyLabel("sales.delete")).toBe("المبيعات — يلغي");
    expect(toRows({ "a.view": true })).toEqual([{ key: "a.view", allowed: true }]);
  });

  it("rows keep their branch both ways", () => {
    const o = { "sales.create": false, "sales.create@b2": true };
    expect(toRows(o)).toEqual([{ key: "sales.create", allowed: false }, { key: "sales.create", allowed: true, branch: "b2" }]);
    expect(fromRows([{ permission_key: "sales.create", allowed: false }, { permission_key: "sales.create", allowed: true, branch_id: "b2" }])).toEqual(o);
    expect(parseKey("sales.create@b2")).toEqual({ key: "sales.create", branch: "b2" });
  });
});

describe("per-branch overrides (owner decision ب 2026-10-24)", () => {
  it("sells in سكة تلة, only looks + receipt in عبدالمنعم الغربي", () => {
    let o = setOverride(C, rp, {}, "sales.create", false, "b2");
    expect(o).toEqual({ "sales.create@b2": false });
    expect(effective(C, rp, o, "sales.create", "b1")).toBe(true);
    expect(effective(C, rp, o, "sales.create", "b2")).toBe(false);
    o = setOverride(C, rp, o, "receipt_vouchers.create", true, "b2");
    expect(branchOverrides(o, "b2").sort()).toEqual(["receipt_vouchers.create@b2", "sales.create@b2"].filter((k) => k in o).sort());
    expect(branchOverrides(o, null)).toEqual([]);
  });
  it("a branch rule beats the every-branch rule; dropping it falls back", () => {
    let o = setOverride(C, rp, {}, "treasury.view", true);           // every branch
    o = setOverride(C, rp, o, "treasury.view", false, "b2");         // but not b2
    expect(effective(C, rp, o, "treasury.view", "b1")).toBe(true);
    expect(effective(C, rp, o, "treasury.view", "b2")).toBe(false);
    o = setOverride(C, rp, o, "treasury.view", true, "b2");          // same as the base now → dropped
    expect(o).toEqual({ "treasury.view": true });
  });
  it("hiding a card in one branch only", () => {
    const o = setOverride(C, rp, {}, "part.dashboard.till_balance.view", false, "b1");
    expect(effective(C, rp, o, "part.dashboard.till_balance.view", "b1")).toBe(false);
    expect(effective(C, rp, o, "part.dashboard.till_balance.view", "b2")).toBe(rp.cashier["dashboard.view"] === true);
    expect(resetPage(page("dashboard"), o, "b1")).toEqual({});
  });
});

describe("managers and partners can be restricted, the owner never", () => {
  it("admin is full by default but an override takes a key away", () => {
    expect(effective(["admin"], {}, {}, "treasury.view")).toBe(true);
    expect(effective(["admin"], {}, { "treasury.view": false }, "treasury.view")).toBe(false);
    expect(effective(["admin"], {}, { "part.dashboard.till_balance.view@b1": false }, "part.dashboard.till_balance.view", "b1")).toBe(false);
    expect(effective(["admin"], {}, { "part.dashboard.till_balance.view@b1": false }, "part.dashboard.till_balance.view", "b2")).toBe(true);
  });
  it("owner and super admin ignore overrides", () => {
    expect(effective(["owner"], {}, { "treasury.view": false }, "treasury.view")).toBe(true);
    expect(effective(["super_admin"], {}, { "sales.create@b1": false }, "sales.create", "b1")).toBe(true);
  });
});

import { withCompanyRole, roleName } from "./companyRoles";
describe("company roles (migration 0115) — same order as perm_resolve", () => {
  const tpl = { id: "t1", name: "مندوب مبيعات", base_role: "cashier", perms: { "treasury.view": false, "receipt_vouchers.create": true } };
  const rp2 = { cashier: { ...DEFAULT_ROLE_PERMISSIONS.cashier, "treasury.view": true, "receipt_vouchers.create": false } } as Record<string, Record<string, boolean>>;
  it("the company role wins over its ready role, for everyone on it", () => {
    const e = withCompanyRole(["cashier"], rp2, tpl);
    expect(checkPermission(e.roles as any, e.permsByRole, "treasury.view", {})).toBe(false);
    expect(checkPermission(e.roles as any, e.permsByRole, "receipt_vouchers.create", {})).toBe(true);
    // what he doesn't change comes from «كاشير»
    expect(checkPermission(e.roles as any, e.permsByRole, "sales.create", {})).toBe(checkPermission(["cashier"], rp2, "sales.create", {}));
    // a plain cashier is untouched
    expect(checkPermission(["cashier"], rp2, "treasury.view", {})).toBe(true);
  });
  it("one employee may still differ from his company role", () => {
    const e = withCompanyRole(["cashier"], rp2, tpl);
    expect(checkPermission(e.roles as any, e.permsByRole, "treasury.view", { "treasury.view": true })).toBe(true);
  });
  it("a closed page in the company role closes its cards", () => {
    const e = withCompanyRole(["cashier"], rp2, { ...tpl, perms: { "dashboard.view": false } });
    expect(checkPermission(e.roles as any, e.permsByRole, "part.dashboard.sales_today.view", {})).toBe(false);
  });
  it("renamed ready roles", () => {
    expect(roleName("warehouse", [{ role: "warehouse", hidden: false, label: "مسؤول المخزن" }])).toBe("مسؤول المخزن");
    expect(roleName("cashier", [])).toBe("كاشير");
  });
});

describe("per-branch level and template (migration 0122) — same order as perm_resolve", () => {
  const rp = {
    cashier: { "sales.view": true, "sales.create": true, "sales.delete": false, "treasury.view": true, "receipt_vouchers.create": false, "payment_vouchers.create": false, "admin_settings.view": false },
    warehouse: { "inventory.update": true, "sales.create": false },
    "tpl:t1": { "sales.view": true, "sales.create": true, "sales.delete": false, "treasury.view": false, "receipt_vouchers.create": true },
  } as any;
  const roles = ["cashier"];
  const rules = {
    b1: { full: true }, b2: { role: "tpl:t1" }, b3: { read: true }, b4: { role: "warehouse" },
  };
  const eff = (k: string, b: string | null, o = {}) => effective(roles, rp, o, k, b, rules);

  it("«إدارة كاملة»: everything in that branch, never the company pages", () => {
    expect(eff("sales.delete", "b1")).toBe(true);
    expect(eff("payment_vouchers.create", "b1")).toBe(true);
    expect(eff("part.dashboard.gross_profit_today.view", "b1")).toBe(true);
    expect(eff("admin_settings.view", "b1")).toBe(false);
  });
  it("«إدارة جزئية» on a company role in شلبى, on a ready role in the 4th branch", () => {
    expect(eff("treasury.view", "b2")).toBe(false);
    expect(eff("receipt_vouchers.create", "b2")).toBe(true);
    expect(eff("inventory.update", "b4")).toBe(true);
    expect(eff("sales.create", "b4")).toBe(false);
  });
  it("«عرض فقط»: views, never writes — not even with his own change", () => {
    expect(eff("sales.view", "b3")).toBe(true);
    expect(eff("sales.create", "b3")).toBe(false);
    expect(eff("sales.create", "b3", { "sales.create@b3": true })).toBe(false);
  });
  it("outside a branch he is his main role; his change in a branch beats its level / template", () => {
    expect(eff("treasury.view", null)).toBe(true);
    expect(eff("treasury.view", "b2", { "treasury.view@b2": true })).toBe(true);
    expect(eff("sales.delete", "b1", { "sales.delete@b1": false })).toBe(false);
  });
  it("setOverride stores nothing when the branch already gives it", () => {
    expect(setOverride(roles, rp, {}, "sales.delete", true, "b1", rules)).toEqual({});
    expect(setOverride(roles, rp, {}, "treasury.view", true, "b2", rules)).toEqual({ "treasury.view@b2": true });
  });
});
