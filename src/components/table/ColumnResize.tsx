import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { avgLen, colKind, isEssential, KIND_MIN, matchCol, pickFlex, pinOffsets, scaleWidths, shortView, tableMinWidth, type ColKind } from "@/lib/tableLayout";
import { RowActionsLayer } from "@/components/table/RowActions";
import { headLabel, holderOf } from "@/components/table/holder";
export { holderOf };

/**
 * Resizable table columns (owner 2026-11-11 «Column Resizing»), mounted once by DataTable and PermTable so every table
 * of the system gets it with no setup. A thin handle sits on the END edge of each header cell of the last header row:
 *   - drag it → that column gets wider / narrower (the page is RTL: dragging LEFT widens);
 *   - double-click it → the column goes back to its natural width.
 * Until a column is resized the table is untouched. From the first resize the widths of ALL columns are frozen at what
 * they measure, the table switches to `table-layout: fixed` with width = Σ columns (its scroll box scrolls sideways),
 * so only the dragged column changes. Double-click on the handle OR anywhere on a resized column's title = natural width again.
 * «الأعمدة» (owner 2026-11-12): a small button above the table lists its columns with ✓ — untick to hide a column for
 * yourself, tick to show it again (localStorage `colh:v1:path:tableId`, by title; print and Excel are not affected). Widths are remembered per person's browser, per page path and table id
 * (localStorage `colw:v1:<path>:<id of the table>`), keyed by the column's title; a column whose title is not saved keeps its
 * natural width. Applied with a <style> of nth-child rules (like PermTable's hidden columns), never by editing cells,
 * so React re-renders do not lose it. Nothing is sent to the server.
 * Look and feel = the ETA portal's table (owner video 2026-11-27 «اعمل زيها بالظبط»): nothing shows at rest; near the border
 * between two titles a THIN line appears with the ↔ cursor, grabbable from both sides of the border (the end of one title and
 * the start of the next); it stays lit while dragging and the column follows the pointer live; the other columns keep their
 * widths and just move; once a table was resized its cells stay on ONE line and cut with «…» (the full text on hover).
 * PDF decisions (owner 2026-11-28 «نفذ كل اللى فى PDF»): ONE flexible column (the text column with the longest content)
 * fills what the frame leaves, so a resized table never shows an empty space; each column's minimum follows its kind
 * (`KIND_MIN`); widths saved on a wider frame shrink in proportion on a narrower one (option ج, saved with `__box`); the
 * row-height handle is gone (rows have one fixed height); «الأعمدة» has search, «أساسي / تفاصيل» groups with switches and
 * «مختصر / الكل»; every title has a ⋯ menu (تثبيت العمود / ملاءمة المحتوى / إخفاء العمود / إعادة ضبط المقاس; pins in
 * `colp:v1:…`); the «إجراءات» column becomes one ⋮ menu per row (`RowActionsLayer`, on tables marked `data-row-menu` — DataTable `rowMenu`).
 */
type Head = { el: HTMLTableCellElement; idx: number; label: string };

const labelOf = headLabel;

function readHeads(t: HTMLTableElement): Head[] {
  const rows = t.querySelectorAll(":scope > thead > tr");
  const row = rows[rows.length - 1];
  const out: Head[] = [];
  if (!row) return out;
  let idx = 0;
  Array.from(row.children).forEach((cell) => {
    const th = cell as HTMLTableCellElement;
    idx += 1;
    const span = th.colSpan || 1;
    if (span === 1) out.push({ el: th, idx, label: labelOf(th) || `#${idx}` });
    idx += span - 1;
  });
  return out;
}

/** the kind of each column, from its title and the first rows' text (check box, actions, number, date, text) */
function readKinds(t: HTMLTableElement, heads: Head[]): Record<string, { kind: ColKind; avg: number }> {
  const rows = Array.from(t.querySelectorAll(":scope > tbody > tr")).slice(0, 30) as HTMLTableRowElement[];
  const out: Record<string, { kind: ColKind; avg: number }> = {};
  heads.forEach((h) => {
    const cells = rows.map((r) => r.children[h.idx - 1] as HTMLElement | undefined).filter((c): c is HTMLElement => !!c && (c as HTMLTableCellElement).colSpan === 1);
    const texts = cells.map((c) => (c.innerText ?? c.textContent ?? ""));
    const hasCheckbox = !!h.el.querySelector("input[type=checkbox],[role=checkbox]") || (cells.length > 0 && cells.every((c) => !!c.querySelector("input[type=checkbox],[role=checkbox]") && !(c.innerText ?? "").trim()));
    const kind = h.el.hasAttribute("data-actions") ? "actions" : colKind(h.label, texts, { hasCheckbox });
    out[h.label] = { kind, avg: avgLen(texts) };
  });
  return out;
}

const load = (key: string): Record<string, number> => {
  try { const v = JSON.parse(localStorage.getItem(key) || "{}") || {}; delete v.__row; return v; } catch { return {}; }
};
const save = (key: string, v: Record<string, number>) => {
  try { if (Object.keys(v).some((k) => k !== BOX)) localStorage.setItem(key, JSON.stringify(v)); else localStorage.removeItem(key); } catch { /* private mode */ }
};
const loadList = (key: string): string[] => { try { return JSON.parse(localStorage.getItem(key) || "[]") || []; } catch { return []; } };
const saveList = (key: string, v: string[]) => { try { if (v.length) localStorage.setItem(key, JSON.stringify(v)); else localStorage.removeItem(key); } catch { /* private mode */ } };
/** the width of the table's box when the widths were saved (option ج: a smaller screen scales them down) */
const BOX = "__box";

export function ColumnResizeLayer({ table, storageId }: { table: HTMLTableElement | null; storageId?: string }) {
  const pathname = typeof window === "undefined" ? "" : window.location.pathname;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [heads, setHeads] = useState<Head[]>([]);
  const [tick, setTick] = useState(0);
  const sig = heads.map((h) => h.label).join("|");
  const key = `colw:v1:${pathname}:${storageId ?? "t"}`;
  const [widths, setWidths] = useState<Record<string, number>>({});
  const drag = useRef<{ label: string; startX: number; startW: number; rtl: boolean; min: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // personal hide / show and pinning of columns
  const hideKey = `colh:v1:${pathname}:${storageId ?? "t"}`;
  const pinKey = `colp:v1:${pathname}:${storageId ?? "t"}`;
  const [hidden, setHidden] = useState<string[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);
  useEffect(() => { setHidden(loadList(hideKey)); }, [hideKey]);
  useEffect(() => { setPinned(loadList(pinKey)); }, [pinKey]);
  const setHiddenSaved = (n: string[]) => { setHidden(n); saveList(hideKey, n); };
  const toggleHidden = (label: string) => setHiddenSaved(hidden.includes(label) ? hidden.filter((x) => x !== label) : [...hidden, label]);
  const togglePinned = (label: string) => { const n = pinned.includes(label) ? pinned.filter((x) => x !== label) : [...pinned, label]; setPinned(n); saveList(pinKey, n); };
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);
  const [colMenu, setColMenu] = useState<{ label: string; top: number; right: number } | null>(null);
  // the «الأعمدة» button lives in a small host placed right before the table
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!table?.parentElement) { setHost(null); return; }
    const el = document.createElement("div");
    el.setAttribute("data-no-print", ""); el.setAttribute("data-xf-ignore", "");
    el.className = "print:hidden sticky right-0 z-20 flex justify-start h-6 w-max";
    table.parentElement.insertBefore(el, table);
    setHost(el);
    return () => { el.remove(); setHost(null); };
  }, [table]);

  // the width of the frame the table sits in (the flexible column fills it; option ج scales to it)
  const [box, setBox] = useState(0);
  useEffect(() => {
    const el = table?.parentElement;
    if (!el) return;
    setBox(Math.round(el.clientWidth));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBox(Math.round(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);

  // header cells: re-read whenever the header changes (columns shown / hidden, other data); kinds from the first rows
  const [kinds, setKinds] = useState<Record<string, { kind: ColKind; avg: number }>>({});
  useEffect(() => {
    if (!table) { setHeads([]); return; }
    let timer: number | undefined;
    const scan = () => {
      const next = readHeads(table);
      next.forEach((h) => holderOf(h.el));   // put a dropped holder back (the title's text was rewritten)
      setHeads((prev) => (prev.length === next.length && prev.every((h, i) => h.el === next[i].el && h.label === next[i].label) ? prev : next));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const k = readKinds(table, next);
        setKinds((prev) => (JSON.stringify(prev) === JSON.stringify(k) ? prev : k));
      }, 250);
    };
    scan();
    // our own handles, menus and ⋮ buttons change inside the table too: those changes are not a new header
    const ours = (n: Node) => !!(n.nodeType === 1 ? (n as HTMLElement) : n.parentElement)?.closest?.("[data-cr-holder],[data-ra-holder]");
    const mo = new MutationObserver((list) => { if (list.some((m) => !ours(m.target) && !(m.type === "childList" && [...Array.from(m.addedNodes), ...Array.from(m.removedNodes)].every(ours)))) scan(); });
    mo.observe(table, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); window.clearTimeout(timer); };
  }, [table]);

  useEffect(() => { setWidths(load(key)); }, [key]);
  useEffect(() => {
    if (!table) return;
    table.setAttribute("data-cr", uid);
    return () => table.removeAttribute("data-cr");
  }, [table, uid]);

  const kindOf = (label: string): ColKind => kinds[label]?.kind ?? "text";
  const minOf = (label: string) => KIND_MIN[kindOf(label)];
  const active = heads.some((h) => widths[h.label] != null);
  // natural widths of the columns that were not resized, measured once when resizing starts (and when the header changes)
  const natural = useRef<Record<string, number>>({});
  useEffect(() => { natural.current = {}; }, [sig]);
  const measure = useCallback(() => {
    // frozen as they are (a narrow check-box column stays narrow); the kind's minimum only limits a column being dragged
    heads.forEach((h) => { if (natural.current[h.label] == null) natural.current[h.label] = Math.max(16, Math.ceil(h.el.getBoundingClientRect().width)); });
  }, [heads]);

  // a column put back to its natural width: measure it with our widths switched off for a moment (the table is fixed by
  // then, so its own width says nothing); the other columns keep the widths they had
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const naturalAgain = (label: string) => {
    const sheet = styleRef.current?.sheet;
    if (sheet) sheet.disabled = true;
    const h = heads.find((x) => x.label === label);
    if (h) natural.current[label] = Math.max(16, Math.ceil(h.el.getBoundingClientRect().width));
    if (sheet) sheet.disabled = false;
  };

  // the flexible column: the text column with the longest content fills what is left of the frame (owner decision 1)
  const flex = useMemo(() => pickFlex(heads.map((h) => ({ label: h.label, kind: kindOf(h.label), avg: kinds[h.label]?.avg ?? 0, hidden: hidden.includes(h.label), resized: widths[h.label] != null }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig, kinds, hidden, widths]);
  // option ج: widths saved on a wider frame shrink in proportion on a narrower one
  const shown = useMemo(() => {
    const stored: Record<string, number> = {};
    heads.forEach((h) => { if (widths[h.label] != null) stored[h.label] = widths[h.label]; });
    const mins: Record<string, number> = {};
    heads.forEach((h) => { mins[h.label] = minOf(h.label); });
    return scaleWidths(stored, widths[BOX], box, mins);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widths, box, sig, kinds]);
  const widthOf = (h: Head) => Math.max(16, Math.round(shown[h.label] ?? natural.current[h.label] ?? h.el.getBoundingClientRect().width));

  const css = useMemo(() => {
    if (!active) return "";
    const order = heads.map((h) => h.label);
    const total = tableMinWidth(order, (l) => widthOf(heads.find((h) => h.label === l)!), hidden);
    const rules = heads.map((h) => {
      const px = widthOf(h);
      const cell = `[data-cr="${uid}"] > * > tr > :nth-child(${h.idx}):not([colspan])`;
      // the flexible column has no width of its own: it takes what the frame leaves (its own width is its floor in the total)
      const size = h.label === flex ? "" : `width: ${px}px !important; min-width: ${px}px !important; max-width: ${px}px !important; `;
      return `${cell} { ${size}overflow: hidden; text-overflow: ellipsis; white-space: nowrap !important; }
${cell} > div:not([class*="flex"]), ${cell} > p, ${cell} > a, ${cell} > [data-perm-label] { overflow: hidden; text-overflow: ellipsis; white-space: nowrap !important; max-width: 100%; }`;
    });
    const tableWidth = flex ? `width: 100% !important; min-width: ${total}px !important;` : `width: ${total}px !important; min-width: ${total}px !important;`;
    return `[data-cr="${uid}"] { table-layout: fixed !important; ${tableWidth} max-width: none !important; }\n${rules.join("\n")}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, shown, sig, uid, tick, hidden, flex]);
  const hideCss = heads.filter((h) => hidden.includes(h.label))
    .map((h) => `[data-cr="${uid}"] > * > tr > :nth-child(${h.idx}):not([colspan]) { display: none !important; }`).join("\n");
  // pinned columns stick at the start edge (RTL: the right), each after the pinned ones before it
  const pinCss = useMemo(() => {
    const live = heads.filter((h) => pinned.includes(h.label) && !hidden.includes(h.label));
    if (!live.length) return "";
    const offs = pinOffsets(heads.map((h) => h.label), pinned, (l) => { const h = heads.find((x) => x.label === l)!; return active ? widthOf(h) : Math.round(h.el.getBoundingClientRect().width); }, hidden);
    return live.map((h) => `[data-cr="${uid}"] > * > tr > :nth-child(${h.idx}):not([colspan]) { position: sticky !important; inset-inline-start: ${offs[h.label]}px; z-index: 3; background: hsl(var(--card)); box-shadow: inset -1px 0 0 hsl(var(--border)); }
[data-cr="${uid}"] > thead > tr > :nth-child(${h.idx}):not([colspan]) { z-index: 21; background: hsl(var(--muted)); }`).join("\n");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, hidden, sig, shown, active, tick, uid]);

  const putBack = (label: string) => {
    naturalAgain(label);
    setWidths((w) => { if (w[label] == null) return w; const n = { ...w }; delete n[label]; save(key, n); return n; });
    setTick((t) => t + 1);
  };
  // double-click anywhere on a RESIZED column's title puts it back (the thin handle alone was hard to hit)
  useEffect(() => {
    const offs = heads.map((h) => {
      const fn = (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest?.("button,input,a,[role=separator]")) return;
        putBack(h.label);
      };
      h.el.addEventListener("dblclick", fn);
      return () => h.el.removeEventListener("dblclick", fn);
    });
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heads, key]);

  // a cell cut with «…» shows its whole text on hover (only cells with no title of their own)
  useEffect(() => {
    if (!table || !active) return;
    const over = (e: MouseEvent) => {
      const cell = (e.target as HTMLElement).closest?.("td, th") as HTMLElement | null;
      if (!cell || !table.contains(cell)) return;
      const cut = [cell, ...Array.from(cell.children)].some((x) => (x as HTMLElement).scrollWidth > (x as HTMLElement).clientWidth + 1);
      if (cut && !cell.hasAttribute("title")) { cell.setAttribute("title", (cell.innerText || "").replace(/\s+/g, " ").trim()); cell.setAttribute("data-cr-title", ""); }
      else if (!cut && cell.hasAttribute("data-cr-title")) { cell.removeAttribute("title"); cell.removeAttribute("data-cr-title"); }
    };
    table.addEventListener("mouseover", over);
    return () => table.removeEventListener("mouseover", over);
  }, [table, active]);

  const saveWidths = (w: Record<string, number>) => { const n = { ...w, [BOX]: box || w[BOX] || 0 }; save(key, n); return n; };
  const start = (h: Head, e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    measure();
    const rtl = getComputedStyle(h.el).direction === "rtl";
    drag.current = { label: h.label, startX: e.clientX, startW: Math.round(h.el.getBoundingClientRect().width), rtl, min: minOf(h.label) };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setDragging(h.label);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const next = Math.max(d.min, d.startW + (d.rtl ? -dx : dx));
    // a drag on a scaled-down screen is saved at THIS frame's width (the others keep their proportion)
    setWidths((w) => (w[d.label] === next && w[BOX] === box ? w : { ...w, ...shown, [d.label]: next, [BOX]: box }));
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    document.body.style.cursor = ""; document.body.style.userSelect = "";
    setDragging(null);
    setWidths((w) => saveWidths(w));
  };
  const reset = (h: Head, e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); putBack(h.label); };
  /** «ملاءمة المحتوى»: the column gets the width of its widest cell */
  const fitContent = (label: string) => {
    const h = heads.find((x) => x.label === label);
    if (!h || !table) return;
    measure();
    const cells = Array.from(table.querySelectorAll(`:scope > * > tr > :nth-child(${h.idx}):not([colspan])`)) as HTMLElement[];
    const wide = Math.max(minOf(label), ...cells.map((c) => c.scrollWidth + 2));
    setWidths((w) => saveWidths({ ...w, ...shown, [label]: Math.min(800, Math.ceil(wide)), [BOX]: box }));
  };

  // The menu stays open until «تم», Escape or a click outside it. Scrolling (inside it, the page or the table — a touchpad
  // sends tiny scrolls just by resting a hand on it, owner 2026-11-12) only moves it so it stays under its button.
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el || !el.isConnected) { setMenu(null); return; }
    const r = el.getBoundingClientRect();
    const next = { top: Math.round(r.bottom + 2), right: Math.round(Math.max(4, window.innerWidth - r.right)) };
    setMenu((m) => (m && m.top === next.top && m.right === next.right ? m : next));
  }, []);
  const open = !!menu || !!colMenu;
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const follow = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (menu) place(); setColMenu(null); }); };
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-cols-menu],[data-col-menu],[data-cr-more]")) return;
      if (t !== btnRef.current && !btnRef.current?.contains(t)) setMenu(null);
      setColMenu(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(null); setColMenu(null); } };
    window.addEventListener("scroll", follow, true); window.addEventListener("resize", follow);
    document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", esc);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("scroll", follow, true); window.removeEventListener("resize", follow); document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc); };
  }, [open, place, menu]);
  const [q, setQ] = useState("");
  if (!table || heads.length === 0) return null;
  const labels = heads.filter((h) => kindOf(h.label) !== "check" && !/^#\d*$/.test(h.label)).map((h) => h.label);
  // a check-box or «#» column (no title) is not a column anyone hides
  const listed = heads.filter((h) => kindOf(h.label) !== "check" && !/^#\d*$/.test(h.label));
  const essential = listed.filter((h) => isEssential(h.label));
  const details = listed.filter((h) => !isEssential(h.label));
  const isShort = hidden.length > 0 && JSON.stringify([...hidden].sort()) === JSON.stringify([...shortView(labels)].sort());
  const Switch = ({ h }: { h: Head }) => {
    const on = !hidden.includes(h.label);
    return (
      <button type="button" role="switch" aria-checked={on} onClick={() => toggleHidden(h.label)} data-testid={`col-switch-${h.label}`}
        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-right hover:bg-muted">
        <span className="truncate">{h.label}{pinned.includes(h.label) ? <span className="text-[10px] text-primary ms-1">مثبّت</span> : null}</span>
        <span aria-hidden className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-muted-foreground/40"}`}>
          <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${on ? "right-0.5" : "right-3.5"}`} />
        </span>
      </button>
    );
  };
  const group = (title: string, list: Head[]) => {
    const f = list.filter((h) => !q.trim() || matchCol(h.label, q));
    if (!f.length) return null;
    return (
      <div>
        <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-bold text-muted-foreground">{title}</div>
        {f.map((h) => <Switch key={`${h.idx}-${h.label}`} h={h} />)}
      </div>
    );
  };
  const menuHead = colMenu ? heads.find((h) => h.label === colMenu.label) : undefined;
  return (
    <>
      {css && <style ref={styleRef}>{css}</style>}
      {hideCss && <style>{hideCss}</style>}
      {pinCss && <style>{pinCss}</style>}
      {host && heads.length > 1 && createPortal(
        <div>
          <button type="button" ref={btnRef} aria-expanded={!!menu} data-testid="cols-button"
            onClick={() => { if (menu) setMenu(null); else place(); }}
            className={`rounded-md border px-2 py-0.5 text-[11px] leading-5 bg-background hover:bg-muted ${hidden.length ? "text-primary font-bold" : "text-muted-foreground"}`}>
            الأعمدة{hidden.length ? ` (${hidden.length} مخفي)` : ""}
          </button>
          {menu && createPortal(
            <div className="fixed z-[100] max-h-80 w-60 overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1.5 text-[13px] shadow-lg" dir="rtl" style={{ top: menu.top, right: menu.right }} data-testid="cols-menu" data-cols-menu data-xf-ignore onPointerDown={(e) => e.stopPropagation()}>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث عن عمود" data-testid="cols-search"
                className="mb-1 h-7 w-full rounded-md border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary" />
              <div className="flex gap-1 px-0.5 pb-1">
                <button type="button" data-testid="cols-short" onClick={() => setHiddenSaved(shortView(labels))}
                  className={`rounded-md border px-2 py-0.5 text-[11px] ${isShort ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>مختصر</button>
                <button type="button" data-testid="cols-all" onClick={() => setHiddenSaved([])}
                  className={`rounded-md border px-2 py-0.5 text-[11px] ${hidden.length === 0 ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>الكل</button>
              </div>
              {group("أساسي", essential)}
              {group("تفاصيل", details)}
              <div className="mt-1 flex justify-end border-t px-2 pt-1 text-xs">
                <button type="button" className="underline" onClick={() => setMenu(null)}>تم</button>
              </div>
            </div>, document.body)}
        </div>, host)}
      <style>{`[data-cr="${uid}"] > thead > tr:last-child > *:not(.sticky) { position: relative; }
[data-cr="${uid}"] > thead > tr:last-child > *:hover [data-cr-more], [data-cr="${uid}"] [data-cr-more][aria-expanded="true"] { opacity: 1; }
@media (hover: none) { [data-cr="${uid}"] [data-cr-more] { opacity: .6; } }${active || pinned.length ? `\n*:has(> [data-cr="${uid}"]) { overflow-x: auto !important; }` : ""}`}</style>
      {heads.map((h, i) => {
        // the border between this title and the one before it is grabbable from this side too (it resizes the one before)
        const prev = heads.slice(0, i).reverse().find((x) => !hidden.includes(x.label));
        const grip = (target: Head, side: "end" | "start", w: number) => (
          <span
            role="separator" aria-orientation="vertical" aria-label={`تغيير عرض عمود ${target.label}`} title="اسحب لتغيير عرض العمود — دبل كليك يرجّعه"
            data-xf-ignore="" data-no-print="" data-cr-grip={side}
            onPointerDown={(e) => start(target, e)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
            onDoubleClick={(e) => reset(target, e)} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()} draggable={false}
            className="group/cr print:hidden absolute top-0 bottom-0 z-10 cursor-col-resize select-none touch-none"
            style={side === "end" ? { insetInlineEnd: 0, width: w } : { insetInlineStart: 0, width: w }}
          >
            <span aria-hidden className={`pointer-events-none absolute top-0 bottom-0 w-[2px] rounded-full bg-primary transition-opacity duration-75 ${dragging === target.label ? "opacity-100" : "opacity-0 group-hover/cr:opacity-90"}`}
              style={side === "end" ? { insetInlineEnd: 0 } : { insetInlineStart: -1 }} />
          </span>
        );
        const k = kindOf(h.label);
        const withMenu = k !== "check" && k !== "actions" && h.label !== "#" && !/^#\d+$/.test(h.label);
        return createPortal(
          <>
            {/* the tag and the ⋯ are drawn by CSS: a title's text (copied, exported, read by tests) stays the column's name */}
            {pinned.includes(h.label) && <span aria-label="مثبّت" className="ms-1 align-middle text-[10px] font-semibold text-primary after:content-['مثبّت']" data-cr-pin-tag="" />}
            {withMenu && (
              <button type="button" data-cr-more="" aria-label={`خيارات عمود ${h.label}`} aria-expanded={colMenu?.label === h.label}
                onClick={(e) => {
                  e.stopPropagation(); e.preventDefault();
                  if (colMenu?.label === h.label) { setColMenu(null); return; }
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setColMenu({ label: h.label, top: Math.round(r.bottom + 2), right: Math.round(Math.max(4, window.innerWidth - r.right)) });
                }}
                onMouseDown={(e) => e.stopPropagation()} draggable={false}
                className="print:hidden absolute top-1/2 -translate-y-1/2 z-[11] rounded px-0.5 text-sm leading-none text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground"
                style={{ insetInlineEnd: 9 }}><span aria-hidden className="before:content-['⋯']" /></button>
            )}
            {grip(h, "end", 7)}
            {prev && grip(prev, "start", 5)}
          </>,
          holderOf(h.el),
          `cr-${h.idx}-${h.label}`,
        );
      })}
      {colMenu && menuHead && createPortal(
        <div role="menu" dir="rtl" data-col-menu="" data-xf-ignore="" data-testid="col-menu" onPointerDown={(e) => e.stopPropagation()}
          className="fixed z-[100] w-44 rounded-lg border bg-popover p-1 text-[13px] shadow-lg" style={{ top: colMenu.top, right: colMenu.right }}>
          {[
            { t: pinned.includes(menuHead.label) ? "إلغاء التثبيت" : "تثبيت العمود", id: "pin", fn: () => togglePinned(menuHead.label) },
            { t: "ملاءمة المحتوى", id: "fit", fn: () => fitContent(menuHead.label) },
            { t: "إخفاء العمود", id: "hide", fn: () => toggleHidden(menuHead.label) },
            { t: "إعادة ضبط المقاس", id: "reset", fn: () => putBack(menuHead.label) },
          ].map((it) => (
            <button key={it.id} type="button" role="menuitem" data-testid={`col-menu-${it.id}`} onClick={() => { it.fn(); setColMenu(null); }}
              className="block w-full rounded px-2 py-1.5 text-right hover:bg-muted">{it.t}</button>
          ))}
        </div>, document.body)}
      {/* pilot (PDF part 3 step 5): the document tables first (`data-row-menu`), every other table after the owner's look */}
      {table.closest("[data-row-menu]") && heads.some((h) => kindOf(h.label) === "actions") && (
        <RowActionsLayer table={table} uid={uid} cols={heads.filter((h) => kindOf(h.label) === "actions").map((h) => h.idx)} />
      )}
    </>
  );
}

/**
 * Every OTHER table of the app (hand-written plain tables / shadcn `<Table>` — 81 of them on 2026-11-11) gets the same
 * resizing without touching its file: mounted once in App, it watches the page and gives a `ColumnResizeLayer` to each
 * table that has a header row and is not already served by DataTable / PermTable (they mark their table with `data-cr`
 * first — the scan waits a moment for that). Opt out with `data-no-resize` on the table or any parent (print layouts).
 * A table is told apart on its page by its order among the unserved tables.
 */
export function GlobalColumnResize() {
  const [tables, setTables] = useState<HTMLTableElement[]>([]);
  const mine = useRef(new Set<HTMLTableElement>());
  useEffect(() => {
    let timer: number | undefined;
    const scan = () => {
      const next = Array.from(document.querySelectorAll<HTMLTableElement>("table")).filter((t) =>
        t.isConnected && t.querySelector(":scope > thead > tr > th") && !t.closest("[data-no-resize]")
        && (mine.current.has(t) || !t.hasAttribute("data-cr")));
      mine.current = new Set(next);
      setTables((prev) => (prev.length === next.length && prev.every((t, i) => t === next[i]) ? prev : next));
    };
    const later = () => { window.clearTimeout(timer); timer = window.setTimeout(scan, 400); };
    later();
    const mo = new MutationObserver(later);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); window.clearTimeout(timer); };
  }, []);
  return <>{tables.map((t, i) => <ColumnResizeLayer key={i} table={t} storageId={`auto${i}`} />)}</>;
}
