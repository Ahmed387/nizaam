import { describe, expect, it } from "vitest";
import { rowItems } from "@/components/table/RowActions";

const cell = (html: string) => { const td = document.createElement("td"); td.innerHTML = html; return td; };

describe("row «⋮» menu items (owner 2026-11-28)", () => {
  it("lists the row's buttons in order, the dangerous ones last", () => {
    const items = rowItems(cell(`<button title="أرشفة" data-own-confirm></button><button title="تعديل"></button><a href="/x">فتح</a><button aria-label="سند قبض"></button>`));
    expect(items.map((i) => i.label)).toEqual(["تعديل", "فتح", "سند قبض", "أرشفة"]);
    expect(items[3].danger).toBe(true);
  });
  it("a button whose own dialog asks is not asked twice; a plain cancel asks «تأكيد»", () => {
    const items = rowItems(cell(`<button title="أرشفة" data-own-confirm></button><button title="إلغاء الفاتورة"></button>`));
    expect(items.find((i) => i.label === "أرشفة")?.ownConfirm).toBe(true);
    expect(items.find((i) => i.label === "إلغاء الفاتورة")?.ownConfirm).toBe(false);
  });
  it("skips our own ⋮ holder and nested buttons", () => {
    const items = rowItems(cell(`<button title="طباعة"><span role="button">x</span></button><span data-ra-holder><button>⋮</button></span>`));
    expect(items.map((i) => i.label)).toEqual(["طباعة"]);
  });
});
