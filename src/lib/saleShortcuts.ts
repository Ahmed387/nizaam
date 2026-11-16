// Keyboard shortcuts of the sale screen (owner 2026-11-16 «اختصارات كيبورد في شاشة البيع … نفذها»).
// ONE list: the sale screen reads `saleShortcut()` and the «اختصارات» tab of the guide (and the «?» window on the
// sale screen) show `SALE_SHORTCUTS` — so what is taught is exactly what works.

export type SaleAction =
  | "search" | "customer" | "payment" | "save" | "save_print" | "qty_up" | "qty_down" | "remove_last" | "help";

export type ShortcutInfo = { keys: string[]; action: SaleAction | "pick" | "close" | "global"; title: string; how: string };

export const SALE_SHORTCUTS: ShortcutInfo[] = [
  { keys: ["F2", "/"], action: "search", title: "البحث عن صنف",
    how: "يودّيك لخانة البحث من أي مكان في الشاشة. اكتب جزء من الاسم أو الكود." },
  { keys: ["↓", "↑", "Enter"], action: "pick", title: "اختيار صنف من النتايج",
    how: "الأسهم بتنقل بين النتايج (المختار عليه إطار). Enter يضيفه للفاتورة ويفضّي البحث عشان تكتب الصنف اللي بعده. لو كتبت الكود كامل أو مسحت الباركود، Enter يضيفه على طول." },
  { keys: ["+"], action: "qty_up", title: "زوّد الكمية", how: "بيزوّد كمية آخر صنف اتضاف قطعة. بيشتغل وخانة البحث فاضية، أو والمؤشر برّه أي خانة." },
  { keys: ["-"], action: "qty_down", title: "قلّل الكمية", how: "بيقلّل كمية آخر صنف قطعة (أقل حاجة 1)." },
  { keys: ["Delete"], action: "remove_last", title: "شيل آخر صنف", how: "بيشيل آخر صنف اتضاف من الفاتورة." },
  { keys: ["F4"], action: "customer", title: "اختيار العميل", how: "بيفتح قايمة العملاء واكتب الاسم أو التليفون، الأسهم وEnter للاختيار." },
  { keys: ["F8"], action: "payment", title: "طرق الدفع", how: "بيفتح دفعة لو مفيش ويودّيك لخانة المبلغ. من غير دفعة الفاتورة كلها كاش." },
  { keys: ["Ctrl+S", "F9"], action: "save", title: "حفظ الفاتورة", how: "زي زرار «إنشاء» بالظبط، بنفس الشروط والأسئلة، وبعدها بتفتح الفاتورة." },
  { keys: ["Ctrl+P", "F10"], action: "save_print", title: "حفظ وطباعة", how: "بيحفظ وبعدين يطبع إيصال 80 مم لوحده." },
  { keys: ["Esc"], action: "close", title: "قفل / مسح البحث", how: "يقفل أي نافذة مفتوحة. في خانة البحث: أول مرة يفضّيها، وتاني مرة يطلّعك منها عشان + و − و Delete يشتغلوا." },
  { keys: ["?"], action: "help", title: "الاختصارات", how: "يفتح الشرح ده جوه شاشة البيع." },
  { keys: ["Ctrl+K"], action: "global", title: "بحث في السيستم كله", how: "من أي صفحة: رقم فاتورة أو اسم عميل أو كود صنف، وEnter يفتحه." },
];

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** The sale-screen action for a key press, or null. `typing` = the focus is in a text box (then + − Delete / ? are typing). */
export function saleShortcut(e: KeyLike, typing: boolean): SaleAction | null {
  const mod = e.ctrlKey || e.metaKey;
  if (e.altKey) return null;
  if (mod && (e.code === "KeyS" || e.key.toLowerCase() === "s" || e.key === "س")) return "save";
  if (mod && (e.code === "KeyP" || e.key.toLowerCase() === "p" || e.key === "ح")) return "save_print";
  if (mod) return null;
  switch (e.key) {
    case "F2": return "search";
    case "F4": return "customer";
    case "F8": return "payment";
    case "F9": return "save";
    case "F10": return "save_print";
  }
  if (typing) return null;
  if (e.key === "/") return "search";
  if (e.key === "+" || e.code === "NumpadAdd") return "qty_up";
  if (e.key === "-" || e.code === "NumpadSubtract") return "qty_down";
  if (e.key === "Delete") return "remove_last";
  if (e.key === "?" || e.key === "؟") return "help";
  return null;
}

/** A text box has the focus (input that takes text, textarea, select, contenteditable). */
export function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (tag !== "INPUT") return false;
  const t = ((el as HTMLInputElement).type || "text").toLowerCase();
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(t);
}

/** Next highlighted result for ↑ / ↓ (wraps around; −1 when there are none). */
export function moveIndex(cur: number, dir: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  if (cur < 0) return dir === 1 ? 0 : count - 1;
  return (cur + dir + count) % count;
}
