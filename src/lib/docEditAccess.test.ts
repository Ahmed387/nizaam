import { describe, it, expect } from "vitest";
import { checkPermission, isOwnerOnlyKey } from "./roles";
import { DOC_EDIT_KEY } from "./docEditAccess";

const B1 = "11111111-1111-1111-1111-111111111111";
const B2 = "22222222-2222-2222-2222-222222222222";
const K = DOC_EDIT_KEY.sale_return;

describe("«تعديل المستندات» — owner-granted only (0257, same order as perm_resolve)", () => {
  it("the keys are owner-only", () => {
    expect(Object.values(DOC_EDIT_KEY).every(isOwnerOnlyKey)).toBe(true);
    expect(isOwnerOnlyKey("returns.update")).toBe(false);
  });
  it("the owner always has them", () => {
    expect(checkPermission(["owner"], {}, K, {}, B1)).toBe(true);
  });
  it("a manager («admin») does not get them from his role", () => {
    expect(checkPermission(["admin"], {}, K, {}, B1)).toBe(false);
  });
  it("a role / template map that says true is ignored", () => {
    expect(checkPermission(["branch_manager"], { branch_manager: { [K]: true } }, K, {}, B1)).toBe(false);
  });
  it("«إدارة كاملة» in a branch does not open them", () => {
    expect(checkPermission(["cashier"], {}, K, {}, B1, { full: true } as any)).toBe(false);
  });
  it("the employee's own rule for one branch opens that branch only", () => {
    const ov = { [`${K}@${B1}`]: true };
    expect(checkPermission(["cashier"], {}, K, ov, B1)).toBe(true);
    expect(checkPermission(["cashier"], {}, K, ov, B2)).toBe(false);
  });
  it("a rule for every branch, closed in one", () => {
    const ov = { [K]: true, [`${K}@${B2}`]: false };
    expect(checkPermission(["cashier"], {}, K, ov, B1)).toBe(true);
    expect(checkPermission(["cashier"], {}, K, ov, B2)).toBe(false);
  });
  it("a «عرض فقط» branch never has them", () => {
    expect(checkPermission(["cashier"], {}, K, { [K]: true }, B1, { read: true } as any)).toBe(false);
  });
});
