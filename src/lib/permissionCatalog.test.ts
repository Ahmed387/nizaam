import { describe, it, expect } from "vitest";
import {
  ADMIN_NAV_PERMISSION_GROUPS, ADMIN_SUBSECTION_PERMISSION_GROUPS, BRANCH_PERMISSION_GROUPS, SENSITIVE_PERMISSION_GROUPS, SUBSECTION_PARENT,
} from "./roles";
import { PERMISSION_CATALOG, allCatalogKeys, pageForPath, searchCatalog, partKey, PAGE_PARTS } from "./permissionCatalog";

const oldKeys = [
  ...BRANCH_PERMISSION_GROUPS, ...ADMIN_NAV_PERMISSION_GROUPS, ...ADMIN_SUBSECTION_PERMISSION_GROUPS, ...SENSITIVE_PERMISSION_GROUPS,
].flatMap((g) => g.actions.map((a) => `${g.key}.${a}`));

describe("permission catalogue (grouped like the sidebar)", () => {
  it("has the five sidebar sections in order", () => {
    expect(PERMISSION_CATALOG.map((s) => s.label)).toEqual(["عام", "العمليات", "المالية", "الإدارة", "المصاريف الشخصية"]);
  });

  it("keeps EVERY permission that exists today — nothing lost", () => {
    const keys = new Set(allCatalogKeys());
    const missing = oldKeys.filter((k) => !keys.has(k));
    expect(missing).toEqual([]);
  });

  it("lists every key once — nothing doubled", () => {
    const keys = allCatalogKeys();
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("puts each admin sub-section under its parent page as a tab", () => {
    Object.entries(SUBSECTION_PARENT).forEach(([child, parent]) => {
      const page = PERMISSION_CATALOG.flatMap((s) => s.pages).find((p) => p.key === parent)!;
      expect(page.children.map((c) => c.key)).toContain(child);
    });
  });

  it("places pages in the right section", () => {
    const sectionOf = (k: string) => PERMISSION_CATALOG.find((s) => s.pages.some((p) => p.key === k))!.label;
    expect(sectionOf("dashboard")).toBe("عام");
    expect(sectionOf("admin_home")).toBe("عام");
    expect(sectionOf("sales")).toBe("العمليات");
    expect(sectionOf("treasury")).toBe("المالية");
    expect(sectionOf("net_profit")).toBe("المالية");
    expect(sectionOf("admin_settings")).toBe("الإدارة");
    expect(PERMISSION_CATALOG.find((s) => s.id === "personal")!.pages).toHaveLength(0);
  });

  it("part keys have the shape the database understands", () => {
    Object.entries(PAGE_PARTS).forEach(([page, parts]) => parts.forEach((p) => {
      expect(partKey(page, p.id)).toMatch(/^part\.[a-z0-9_]+\.[a-z0-9_]+\.view$/);
    }));
  });

  it("finds the page of a route for the customize bar", () => {
    expect(pageForPath("/branch/abc-123/dashboard")?.key).toBe("dashboard");
    expect(pageForPath("/admin/dashboard")?.key).toBe("admin_home");
    expect(pageForPath("/branch/abc/invoices")).toBeNull();
  });

  it("search finds pages by a card name too", () => {
    expect(searchCatalog("رصيد الخزنة").map((r) => r.page.key)).toContain("dashboard");
    expect(searchCatalog("صافي الربح").map((r) => r.page.key)).toContain("net_profit");
    expect(searchCatalog("   ")).toEqual([]);
  });
});
