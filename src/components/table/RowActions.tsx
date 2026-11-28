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
type Item = { el: HTMLElement; label: string; icon: string; danger: boolean; disabled: boolean };

const ICON_LABEL: [RegExp, string][] = [
  [/lucide-(printer)/, "طباعة"], [/lucide-(pencil|pen|square-pen|edit)/, "تعديل"], [/lucide-(eye)\b/, "عرض"],
  [/lucide-(ban|circle-x|x-circle|x\b)/, "إلغاء"], [/lucide-(trash)/, "حذف"], [/lucide-(file-text|external-link|arrow-up-left|square-arrow-out)/, "فتح"],
  [/lucide-(paperclip)/, "المرفقات"], [/lucide-(copy)/, "نسخ"], [/lucide-(download)/, "تحميل"], [/lucide-(rotate-ccw|undo)/, "استرجاع"],
  [/lucide-(lock)/, "قفل"], [/lucide-(sticky-note|message-square|notebook-pen)/, "ملاحظات"], [/lucide-(share)/, "مشاركة"], [/lucide-(tags?)\b/, "تغيير البند"],
];
const DANGER_RE = /(^|\s)(إلغاء|الغي|حذف|امسح|مسح|أرشفة)/;

function labelOfEl(el: HTMLElement): string {
  const own = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("data-label") || (el.innerText || "").replace(/\s+/g, " ").trim();
  if (own) return own;
  const cls = el.querySelector("svg")?.getAttribute("class") ?? "";
  return ICON_LABEL.find(([re]) => re.test(cls))?.[1] ?? "إجراء";
}

/** the row's actionable elements, outermost only, in their order */
export function rowItems(td: HTMLElement): Item[] {
  const all = Array.from(td.querySelectorAll<HTMLElement>("button, a[href], [role=button]"))
    .filter((el) => !el.closest("[data-ra-holder]") && !el.parentElement?.closest("button, a[href], [role=button]"));
  const items = all.map((el) => {
    const label = labelOfEl(el);
    const cls = `${el.className} ${el.getAttribute("data-variant") ?? ""}`;
    return {
      el, label, icon: el.querySelector("svg")?.outerHTML ?? "",
      danger: /destructive/.test(cls) || DANGER_RE.test(label),
      disabled: (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true",
    };
  });
  return [...items.filter((i) => !i.danger), ...items.filter((i) => i.danger)];
}

/** run the real button: a dropdown trigger (Radix opens on pointerdown) is shown for a moment so its menu has a place */
function activate(td: HTMLElement, el: HTMLElement) {
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
  const [open, setOpen] = useState<{ td: HTMLElement; top: number; right: number; items: Item[]; confirm?: Item } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { const t = e.target as HTMLElement; if (!menuRef.current?.contains(t) && !t.closest?.("[data-ra-button]")) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    // a scroll (also the one that brought the row into view right before the click) moves the menu with its ⋮ button;
    // it closes only when the button left the screen
    const scroll = () => {
      const btn = open.td.querySelector("[data-ra-button]") as HTMLElement | null;
      const r = btn?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) { setOpen(null); return; }
      const top = Math.round(r.bottom + 2), right = Math.round(Math.max(4, window.innerWidth - r.right));
      setOpen((o) => (o && (o.top !== top || o.right !== right) ? { ...o, top, right } : o));
    };
    document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", esc); window.addEventListener("scroll", scroll, true);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", scroll, true); };
  }, [open]);
  // keep the whole menu on the screen: in RTL it opens towards the left of its ⋮, and the «إجراءات» column is the last
  // one (the left edge), so a menu wider than the space there slides right until it fits (owner «اهم حاجة تنسيق»)
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !open) return;
    const r = el.getBoundingClientRect();
    let right = open.right, top = open.top;
    if (r.left < 4) right = Math.max(4, window.innerWidth - r.width - 4);
    if (r.bottom > window.innerHeight - 4) top = Math.max(4, window.innerHeight - r.height - 4);
    if (right !== open.right || top !== open.top) setOpen({ ...open, right, top });
  }, [open]);
  const css = useMemo(() => cols.map((k) => `@media (min-width: 768px) {
  [data-cr="${uid}"] > tbody > tr > td:nth-child(${k})[data-ra]:not([data-ra-show]) > *:not([data-ra-holder]) { display: none !important; }
  [data-cr="${uid}"] > tbody > tr > td:nth-child(${k})[data-ra] { text-align: center; }
}
@media (max-width: 767px) { [data-cr="${uid}"] [data-ra-button] { display: none !important; } }
@media print { [data-cr="${uid}"] [data-ra-button] { display: none !important; } }`).join("\n"), [cols, uid]);
  const choose = (it: Item) => {
    if (!open || it.disabled) return;
    if (it.danger && open.confirm !== it) { setOpen({ ...open, confirm: it }); return; }
    const td = open.td;
    setOpen(null);
    activate(td, it.el);
  };
  return (
    <>
      <style>{css}</style>
      {cells.map((td, i) => createPortal(
        <button type="button" data-ra-button="" data-no-print="" aria-label="إجراءات الصف" aria-haspopup="menu" aria-expanded={open?.td === td}
          data-testid="row-actions"
          onClick={(e) => {
            e.stopPropagation(); e.preventDefault();
            if (open?.td === td) { setOpen(null); return; }
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setOpen({ td, top: Math.round(r.bottom + 2), right: Math.round(Math.max(4, window.innerWidth - r.right)), items: rowItems(td) });
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none text-muted-foreground hover:bg-muted hover:text-foreground">⋮</button>,
        holderOf(td, "data-ra-holder"),
        `ra-${i}`,
      ))}
      {open && createPortal(
        <div ref={menuRef} role="menu" dir="rtl" data-testid="row-actions-menu" onClick={(e) => e.stopPropagation()}
          className="fixed z-[120] min-w-44 max-w-64 rounded-lg border bg-popover p-1 text-[13px] shadow-lg"
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
        </div>, document.body)}
    </>
  );
}
