import { describe, expect, it } from "vitest";
import { groupHits, looksLikeNumber, searchTarget, type SearchHit } from "./globalSearch";

const h = (kind: SearchHit["kind"], title: string, sub: string | null = null): SearchHit =>
  ({ kind, id: title, branch_id: "b1", branch: "شلبى", title, sub, amount: null, day: null, status: null });

describe("global search (Ctrl+K)", () => {
  it("each kind opens its own page", () => {
    expect(searchTarget(h("sale", "x"), false)).toBe("/branch/b1/sales/x");
    expect(searchTarget(h("purchase", "x"), false)).toBe("/branch/b1/shipments/x");
    expect(searchTarget(h("product", "x"), false)).toBe("/branch/b1/inventory/x/movements");
    expect(searchTarget(h("contact", "x"), true)).toBe("/admin/contacts/x");
    expect(searchTarget(h("contact", "x"), false)).toBe("/branch/b1/contacts/x");
  });
  it("a number puts documents first, the exact one on top", () => {
    expect(looksLikeNumber("5108")).toBe(true);
    expect(looksLikeNumber("نقابه")).toBe(false);
    const g = groupHits([h("contact", "محمد 5108"), h("sale", "IN15108"), h("sale", "IN05108")], "5108");
    expect(g[0]).toEqual({ label: "مطابق", hits: [expect.objectContaining({ title: "IN05108" })] });
    expect(g[1].label).toBe("فواتير بيع");
  });
  it("words put accounts first; a product code typed exactly is on top", () => {
    const g = groupHits([h("sale", "IN01478"), h("product", "مروحة", "1478")], "1478");
    expect(g[0].hits[0].kind).toBe("product");
    const w = groupHits([h("product", "غسالة نقابة"), h("contact", "نقابة المعلمين")], "نقابه");
    expect(w[0].label).toBe("حسابات (عملاء وموردين)");
  });
});
