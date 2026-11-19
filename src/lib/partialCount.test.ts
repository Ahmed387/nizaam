import { describe, it, expect } from "vitest";
import { pickByWords, scopeLabel, partialProblem } from "./partialCount";

const items = [
  { id: "1", name: "غسالة فريش 8 ك", sku: "1613" },
  { id: "2", name: "غساله توشيبا 10 ك", sku: "2201" },
  { id: "3", name: "شاشة سينكس 32", sku: "1105" },
];

describe("partial count (0271)", () => {
  it("«غسالة» picks every washer, ة = ه", () => {
    expect(pickByWords(items, "غسالة").map((p) => p.id)).toEqual(["1", "2"]);
    expect(pickByWords(items, "غساله فريش").map((p) => p.id)).toEqual(["1"]);
    expect(pickByWords(items, "")).toEqual([]);
  });
  it("labels the count in the sessions list", () => {
    expect(scopeLabel(null)).toBe("جرد كامل");
    expect(scopeLabel({ mode: "words", words: "غسالة", count: 40 })).toBe("جرد جزئي: «غسالة» — 40 صنف");
    expect(scopeLabel({ mode: "moved", from: "2026-11-14", to: "2026-11-19", count: 60 })).toBe("جرد جزئي: اتحركت من 2026-11-14 لـ 2026-11-19 — 60 صنف");
    expect(scopeLabel({ mode: "items", count: 5 })).toBe("جرد جزئي: أصناف مختارة — 5 صنف");
  });
  it("refuses an empty choice", () => {
    expect(partialProblem("words", [], { words: "" })).toContain("اكتب");
    expect(partialProblem("moved", ["1"], { from: "2026-11-19", to: "2026-11-14" })).toContain("قبل");
    expect(partialProblem("items", [], {})).toContain("مفيش أصناف");
    expect(partialProblem("items", ["1"], {})).toBeNull();
  });
});
