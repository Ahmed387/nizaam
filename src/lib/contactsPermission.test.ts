import { describe, expect, it } from "vitest";
import { BRANCH_PERMISSION_GROUPS, DEFAULT_ROLE_PERMISSIONS, canonicalPermKey, checkPermission } from "./roles";

// 0262 (owner 2026-11-18 «اوبشن عملاء لوحديهم وموردين لوحدين خليهم اوبشن واحد»، «الكاشير يشوف ويضيف الاتنين»)
describe("«العملاء والموردين» = one switch", () => {
  it("settings show ONE row for both", () => {
    const rows = BRANCH_PERMISSION_GROUPS.filter((g) => g.key === "customers" || g.key === "suppliers");
    expect(rows.map((g) => [g.key, g.label])).toEqual([["customers", "العملاء والموردين"]]);
    expect(rows[0].actions).toEqual(["view", "create", "update", "delete"]);
  });
  it("suppliers.* reads customers.*", () => {
    expect(canonicalPermKey("suppliers.create")).toBe("customers.create");
    expect(canonicalPermKey("part.suppliers.add_button.view")).toBe("part.suppliers.add_button.view");
    expect(canonicalPermKey("sales.create")).toBe("sales.create");
  });
  it("the cashier sees and adds suppliers too, but does not edit / archive by default", () => {
    const perms = { cashier: DEFAULT_ROLE_PERMISSIONS.cashier };
    expect(checkPermission(["cashier"], perms, "suppliers.view")).toBe(true);
    expect(checkPermission(["cashier"], perms, "suppliers.create")).toBe(true);
    expect(checkPermission(["cashier"], perms, "customers.update")).toBe(false);
    expect(checkPermission(["cashier"], perms, "suppliers.delete")).toBe(false);
  });
  it("a person's own rule opens / closes both at once, per branch", () => {
    const perms = { cashier: DEFAULT_ROLE_PERMISSIONS.cashier };
    expect(checkPermission(["cashier"], perms, "suppliers.update", { "customers.update": true })).toBe(true);
    expect(checkPermission(["cashier"], perms, "suppliers.update", { "customers.update@b1": true }, "b1")).toBe(true);
    expect(checkPermission(["cashier"], perms, "suppliers.update", { "customers.update@b1": true }, "b2")).toBe(false);
    expect(checkPermission(["branch_manager"], { branch_manager: DEFAULT_ROLE_PERMISSIONS.branch_manager }, "suppliers.delete", { "customers.delete": false })).toBe(false);
  });
  it("warehouse keeps what it had on suppliers, now on the one switch", () => {
    const perms = { warehouse: DEFAULT_ROLE_PERMISSIONS.warehouse };
    expect(checkPermission(["warehouse"], perms, "suppliers.update")).toBe(true);
    expect(checkPermission(["warehouse"], perms, "customers.create")).toBe(true);
  });
});

import { mergeRolePerms } from "./roles";
describe("role defaults are read per switch, like perm_resolve (parity check 2026-11-18)", () => {
  it("a role with saved rows still gets the default of a switch it has no row for", () => {
    const m = mergeRolePerms([{ role: "cashier", permission_key: "sales.create", allowed: true }]);
    expect(m.cashier["returns.update"]).toBe(true);        // default for every role but the viewer (0132)
    expect(m.cashier["sales.create"]).toBe(true);
    const bm = mergeRolePerms([{ role: "branch_manager", permission_key: "sales.view", allowed: true }]);
    expect(bm.branch_manager["vessel_transfers.create"]).toBe(true);
    expect(bm.branch_manager["vessel_counts.create"]).toBe(true);   // 0294, like role_permission_default
    expect(m.cashier["vessel_counts.create"]).toBeFalsy();
  });
  it("a saved row wins over the default", () => {
    const m = mergeRolePerms([{ role: "cashier", permission_key: "returns.update", allowed: false }]);
    expect(m.cashier["returns.update"]).toBe(false);
  });
  it("a role with no rows gets its defaults", () => {
    expect(mergeRolePerms([]).warehouse["inventory.update"]).toBe(true);
  });
});
