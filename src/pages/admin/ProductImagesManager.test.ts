import { describe, it, expect } from "vitest";
import { groupProducts, norm, kb } from "./ProductImagesManager";

describe("product photos page helpers", () => {
  it("one product = every branch row with the same code", () => {
    const g = groupProducts([
      { id: "1", name: "غسالة", sku: "WM9", image: null, branch_id: "a" },
      { id: "2", name: "غسالة", sku: " wm9 ", image: "t/a/x.webp", branch_id: "b" },
      { id: "3", name: "شاشة", sku: "TV", image: null, branch_id: "a" },
    ]);
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.sku === "WM9")!.products.map((p) => p.id)).toEqual(["1", "2"]);
    expect(g.find((x) => x.sku === "WM9")!.image).toBe("t/a/x.webp");
  });
  it("Arabic search ignores أ/ا, ة/ه, ى/ي and case", () => {
    expect(norm("ثلاجة إنفرتر")).toBe(norm("ثلاجه انفرتر"));
    expect(norm("مكوى")).toBe("مكوي");
    expect(norm("ATA43")).toBe("ata43");
  });
  it("sizes", () => { expect(kb(110000)).toBe("107 KB"); expect(kb(3 * 1024 * 1024)).toBe("3.0 ميجا"); });
});
