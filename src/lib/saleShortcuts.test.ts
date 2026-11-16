import { describe, expect, it } from "vitest";
import { isTyping, moveIndex, saleShortcut, SALE_SHORTCUTS } from "./saleShortcuts";

const k = (key: string, o: Partial<KeyboardEvent> = {}) =>
  ({ key, code: o.code ?? "", ctrlKey: !!o.ctrlKey, metaKey: !!o.metaKey, altKey: !!o.altKey, shiftKey: !!o.shiftKey });

describe("sale screen shortcuts", () => {
  it("F-keys and Ctrl work even while typing", () => {
    expect(saleShortcut(k("F2"), true)).toBe("search");
    expect(saleShortcut(k("F9"), true)).toBe("save");
    expect(saleShortcut(k("s", { ctrlKey: true, code: "KeyS" }), true)).toBe("save");
    expect(saleShortcut(k("س", { ctrlKey: true, code: "KeyS" }), true)).toBe("save"); // Arabic keyboard
    expect(saleShortcut(k("p", { metaKey: true, code: "KeyP" }), true)).toBe("save_print");
    expect(saleShortcut(k("F10"), false)).toBe("save_print");
  });
  it("+ − Delete / ? are typing inside a text box", () => {
    expect(saleShortcut(k("+"), true)).toBeNull();
    expect(saleShortcut(k("+"), false)).toBe("qty_up");
    expect(saleShortcut(k("-", { code: "NumpadSubtract" }), false)).toBe("qty_down");
    expect(saleShortcut(k("Delete"), false)).toBe("remove_last");
    expect(saleShortcut(k("/"), false)).toBe("search");
    expect(saleShortcut(k("؟"), false)).toBe("help");
    expect(saleShortcut(k("a"), false)).toBeNull();
    expect(saleShortcut(k("k", { ctrlKey: true, code: "KeyK" }), false)).toBeNull(); // Ctrl+K is the global search
  });
  it("arrow index wraps", () => {
    expect(moveIndex(-1, 1, 3)).toBe(0);
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(0, 1, 0)).toBe(-1);
  });
  it("text boxes count as typing, a checkbox does not", () => {
    const input = document.createElement("input");
    expect(isTyping(input)).toBe(true);
    input.type = "checkbox";
    expect(isTyping(input)).toBe(false);
    expect(isTyping(document.createElement("textarea"))).toBe(true);
    expect(isTyping(document.createElement("button"))).toBe(false);
  });
  it("every taught shortcut has keys and an explanation", () => {
    for (const s of SALE_SHORTCUTS) { expect(s.keys.length).toBeGreaterThan(0); expect(s.how.length).toBeGreaterThan(10); }
  });
});
