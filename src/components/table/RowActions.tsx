import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { holderOf } from "@/components/table/holder";

/**
 * «إجراءات الصف: قائمة ⋮» (owner PDF 2026-11-28, decision 3): on every table, the buttons of the «إجراءات» column become ONE
 * ⋮ button per row that opens a menu (a row with ONE button keeps it as it is). Nothing is rewritten per table: the row's own buttons stay mounted (hidden), so the
 * same permissions, branch rules and dialogs apply — a menu item clicks the real button, and its dialog opens outside the
 * menu. Dangerous items (إلغاء / حذف) come last, in red, and ask «تأكيد …؟» first. Below 768 px (mobile cards) the row keeps
 * its own buttons. Print never shows the ⋮.
 */
export type Item = { el: HTMLElement; label: string; icon: string; danger: boolean; disabled: boolean; ownConfirm: boolean };

const ICON_LABEL: [RegExp, string][] = [
  [/lucide-(printer)/, "طباعة"], [/lucide-(pencil|pen|square-pen|edit)/, "تعديل"], [/lucide-(eye)\b/, "عرض"],
  [/lucide-(ban|circle-x|x-circle|x\b)/, "إلغاء"], [/lucide-(trash)/, "حذف"], [/lucide-(file-text|external-link|arrow-up-left|square-arrow-out)/, "فتح"],
  [/lucide-(paperclip)/, "المرفقات"], [/lucide-(copy)/, "نسخ"], [/lucide-(download)/, "تحميل"], [/lucide-(rotate-ccw|undo)/, "استرجاع"],
  [/lucide-(lock)/, "قفل"], [/lucide-(sticky-note|message-square|notebook-pen)/, "ملاحظات"], [/lucide-(share)/, "مشاركة"], [/lucide-(tags?)\b/, "تغيير البند"],
];
const DANGER_RE = /(^|\s)(إلغاء|الغي|حذف|امسح|مسح|أرشفة)/;

function labelOfEl(el: HTMLElement): string {
  // the SHORTEST name the button has: «سند قبض» (title) rather than «إنشاء سند قبض لـ أ/ منتصر صالح» (aria-label)
  const names = [el.getAttribute("data-label"), el.getAttribute("title"), el.getAttribute("aria-label")].map((x) => (x ?? "").trim()).filter(Boolean);
  if (names.length) return names.sort((a, b) => a.length - b.length)[0];
  const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  if (text) return text;
  const cls = el.querySelector("svg")?.getAttribute("class") ?? "";
  return ICON_LABEL.find(([re]) => re.test(cls))?.[1] ?? "إجراء";
}

/** the row's actionable elements, outermost only, in their order */
export function rowItems(td: HTMLElement): Item[] {
  const all = Array.from(td.querySelectorAll<HTMLElement>("button, a[href], [role=button]"))
    .filter((el) => !el.closest("[data-ra-holder],[data-am-skip]") && !el.parentElement?.closest("button, a[href], [role=button]"));
  const items = all.map((el) => {
    const label = labelOfEl(el);
    const cls = `${el.className} ${el.getAttribute("data-variant") ?? ""}`;
    return {
      el, label, icon: el.querySelector("svg")?.outerHTML ?? "",
      // by what it DOES (its name / a destructive variant), never by a red colour: «سند صرف» is red and harmless
      danger: /(^|\s)bg-destructive(\s|$)/.test(cls) || el.hasAttribute("data-danger") || DANGER_RE.test(label),
      disabled: (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true",
      // a button whose own dialog already asks («أرشفة …؟») is not asked twice (`data-own-confirm`)
      ownConfirm: el.hasAttribute("data-own-confirm"),
    };
  });
  return [...items.filter((i) => !i.danger), ...items.filter((i) => i.danger)];
}

/** run the real button: a dropdown trigger (Radix opens on pointerdown) is shown for a moment so its menu has a place */
export function activate(td: HTMLElement, el: HTMLElement) {
  const popup = el.getAttribute("aria-haspopup");
  if (popup && popup !== "dialog") {
    td.setAttribute("data-ra-show", "");
    const off = (e: PointerEvent) => {
      if ((e.target as HTMLElement)?.closest?.("[role=menu],[data-radix-popper-content-wrapper]")) return;
      td.removeAttribute("data-ra-show"); document.removeEventListener("pointerdown", off, true);
    };
    setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
    requestAnimationFrame(() => {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" }));
      el.click();
    });
    return;
  }
  el.click();
}

/**
 * The ⋮ menu itself (shared by the table rows and `ActionsMenu` in page headers): opens under its button, follows it on
 * scroll, stays on the screen, closes on Escape / a click outside; danger items ask «تأكيد …؟» unless the real button
 * asks itself.
 */
export type MenuOpen = { box: HTMLElement; btn: HTMLElement; top: number; right: number; items: Item[]; confirm?: Item };

/**
 * Where the menu goes, decided BEFORE it is drawn (owner 2026-11-28: «القائمة مش باينة كلها»): in RTL it opens towards the
 * left of its ⋮; when there is no room on the left (the «إجراءات» column is the last one, next to the screen's edge) it
 * opens towards the right instead, and above the ⋮ when there is no room below. The layout effect then fixes it to the
 * pixel with the menu's real size.
 */
export const MENU_W = 264;
export function placeMenu(r: { top: number; bottom: number; left: number; right: number }, itemCount: number, vw = window.innerWidth, vh = window.innerHeight) {
  const h = Math.min(vh - 8, 12 + Math.max(1, itemCount) * 34);
  let right = Math.round(vw - r.right);                       // the menu's right edge on the ⋮'s right edge
  if (r.right - MENU_W < 4) right = Math.round(Math.max(4, vw - (r.left + MENU_W)));   // no room on the left → open to the right
  right = Math.max(4, Math.min(right, vw - 4 - 176));                                    // its narrowest (176) still fits
  let top = Math.round(r.bottom + 2);
  if (top + h > vh - 4) top = Math.round(Math.max(4, r.top - h - 2));                 // no room below → above the ⋮
  return { top, right };
}
export function useActionMenu(testId = "row-actions-menu") {
  const [open, setOpen] = useState<MenuOpen | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { const t = e.target as HTMLElement; if (!menuRef.current?.contains(t) && !t.closest?.("[data-ra-button]")) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    // a scroll (also the one that brought the row into view right before the click) moves the menu with its ⋮ button;
    // it closes only when the button left the screen
    const scroll = () => {
      const r = open.btn.isConnected ? open.btn.getBoundingClientRect() : null;
      if (!r || r.bottom < 0 || r.top > window.innerHeight) { setOpen(null); return; }
      const { top, right } = placeMenu(r, open.items.length);
      setOpen((o) => (o && (o.top !== top || o.right !== right) ? { ...o, top, right } : o));
    };
    document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", esc); window.addEventListener("scroll", scroll, true);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", scroll, true); };
  }, [open]);
  // keep the whole menu on the screen: in RTL it opens towards the left of its ⋮, so a menu wider than the space there
  // slides right until it fits (owner «اهم حاجة تنسيق»)
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !open) return;
    const r = el.getBoundingClientRect();
    let right = open.right, top = open.top;
    if (r.left < 4) right = Math.max(4, window.innerWidth - r.width - 4);
    if (r.right > window.innerWidth - 4) right = 4;
    if (r.bottom > window.innerHeight - 4) top = Math.max(4, window.innerHeight - r.height - 4);
    if (r.top < 4) top = 4;
    right = Math.round(right); top = Math.round(top);
    if (right !== open.right || top !== open.top) setOpen({ ...open, right, top });
  }, [open]);
  const toggle = (box: HTMLElement, btn: HTMLElement) => {
    if (open?.box === box) { setOpen(null); return; }
    const items = rowItems(box);
    setOpen({ box, btn, ...placeMenu(btn.getBoundingClientRect(), items.length), items });
  };
  const choose = (it: Item) => {
    if (!open || it.disabled) return;
    if (it.danger && !it.ownConfirm && open.confirm !== it) { setOpen({ ...open, confirm: it }); return; }
    const box = open.box;
    setOpen(null);
    activate(box, it.el);
  };
  const panel = open && createPortal(
    <div ref={menuRef} role="menu" dir="rtl" data-testid={testId} onClick={(e) => e.stopPropagation()}
      className="fixed z-[120] min-w-44 max-w-[min(16.5rem,calc(100vw-8px))] max-h-[calc(100vh-8px)] overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 text-[13px] shadow-lg"
      style={{ top: open.top, right: open.right }}>
      {open.items.length === 0 && <div className="px-2 py-1.5 text-muted-foreground">مفيش إجراءات</div>}
      {open.items.map((it, i) => (
        <div key={i}>
          {it.danger && (i === 0 || !open.items[i - 1].danger) && i > 0 && <div className="my-1 border-t" />}
          <button type="button" role="menuitem" disabled={it.disabled} data-testid={`row-action-${it.label}`} onClick={() => choose(it)}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-right disabled:opacity-40 ${it.danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-muted"}`}>
            {it.icon ? <span aria-hidden className="inline-flex h-4 w-4 shrink-0 [&>svg]:h-4 [&>svg]:w-4" dangerouslySetInnerHTML={{ __html: it.icon }} /> : <span className="w-4" />}
            <span className="truncate">{it.label}</span>
          </button>
          {open.confirm === it && (
            <div className="m-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs leading-5" data-testid="row-action-confirm">
              <div className="text-destructive font-semibold">تأكيد {it.label}؟</div>
              <div className="text-muted-foreground">الحركة بتفضل ظاهرة في السجلات كـ «ملغية».</div>
              <div className="mt-1.5 flex gap-1.5">
                <button type="button" className="rounded bg-destructive px-2 py-0.5 text-destructive-foreground" data-testid="row-action-confirm-yes" onClick={() => choose(it)}>تأكيد</button>
                <button type="button" className="rounded border px-2 py-0.5" onClick={() => setOpen({ ...open, confirm: undefined })}>رجوع</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>, document.body);
  return { open, toggle, panel };
}

export function RowActionsLayer({ table, uid, cols }: { table: HTMLTableElement; uid: string; cols: number[] }) {
  const [cells, setCells] = useState<HTMLTableCellElement[]>([]);
  const colsSig = cols.join(",");
  useEffect(() => {
    let timer: number | undefined;
    const scan = () => {
      const next: HTMLTableCellElement[] = [];
      table.querySelectorAll(":scope > tbody > tr").forEach((tr) => {
        cols.forEach((k) => {
          const td = tr.children[k - 1] as HTMLTableCellElement | undefined;
          if (!td || td.tagName !== "TD" || (td.colSpan || 1) !== 1) return;
          // ONE button stays as it is; two or more become the ⋮ menu
          if (rowItems(td).length >= 2) { next.push(td); td.setAttribute("data-ra", ""); } else td.removeAttribute("data-ra");
        });
      });
      next.forEach((td) => holderOf(td, "data-ra-holder"));
      table.querySelectorAll(":scope > tbody > tr > td[data-ra]").forEach((td) => { if (!next.includes(td as HTMLTableCellElement)) td.removeAttribute("data-ra"); });
      setCells((prev) => (prev.length === next.length && prev.every((c, i) => c === next[i]) ? prev : next));
    };
    const later = () => { window.clearTimeout(timer); timer = window.setTimeout(scan, 60); };
    scan();
    const mo = new MutationObserver((m) => { if (m.some((r) => !(r.target as HTMLElement).closest?.("[data-ra-holder]"))) later(); });
    mo.observe(table, { childList: true, subtree: true });
    return () => { mo.disconnect(); window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, colsSig]);
  const menu = useActionMenu();
  const css = useMemo(() => cols.map((k) => `@media (min-width: 768px) {
  [data-cr="${uid}"] > tbody > tr > td:nth-child(${k})[data-ra]:not([data-ra-show]) > *:not([data-ra-holder]) { display: none !important; }
  [data-cr="${uid}"] > tbody > tr > td:nth-child(${k})[data-ra] { text-align: center; }
}
@media (max-width: 767px) { [data-cr="${uid}"] [data-ra-button] { display: none !important; } }
@media print { [data-cr="${uid}"] [data-ra-button] { display: none !important; } }`).join("\n"), [cols, uid]);
  return (
    <>
      <style>{css}</style>
      {cells.map((td, i) => createPortal(
        <button type="button" data-ra-button="" data-no-print="" aria-label="إجراءات الصف" aria-haspopup="menu" aria-expanded={menu.open?.box === td}
          data-testid="row-actions"
          onClick={(e) => {
            e.stopPropagation(); e.preventDefault();
            menu.toggle(td, e.currentTarget as HTMLElement);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none text-muted-foreground hover:bg-muted hover:text-foreground">⋮</button>,
        holderOf(td, "data-ra-holder"),
        `ra-${i}`,
      ))}
      {menu.panel}
    </>
  );
}
