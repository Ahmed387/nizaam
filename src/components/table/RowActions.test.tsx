import { describe, expect, it } from "vitest";
import { MENU_W, placeMenu, rowItems } from "@/components/table/RowActions";

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
  it("the menu is placed inside the screen before it is drawn (owner 2026-11-28 «القائمة مش باينة كلها»)", () => {
    // a ⋮ at the LEFT edge (RTL actions column): no room on its left → it opens to the right of the ⋮
    const leftEdge = placeMenu({ left: 20, right: 52, top: 300, bottom: 332 }, 6, 1440, 900);
    expect(1440 - leftEdge.right - MENU_W).toBeGreaterThanOrEqual(4);
    // a ⋮ with room on its left: the menu's right edge on the ⋮'s right edge
    expect(placeMenu({ left: 900, right: 932, top: 300, bottom: 332 }, 6, 1440, 900).right).toBe(1440 - 932);
    // near the bottom: it opens above the ⋮
    const low = placeMenu({ left: 900, right: 932, top: 850, bottom: 882 }, 6, 1440, 900);
    expect(low.top + 12 + 6 * 34).toBeLessThanOrEqual(850);
    // a phone-wide screen: never past either edge
    const phone = placeMenu({ left: 10, right: 42, top: 100, bottom: 132 }, 4, 360, 700);
    expect(phone.right).toBeGreaterThanOrEqual(4);
    expect(360 - phone.right - 176).toBeGreaterThanOrEqual(4);
  });
});
