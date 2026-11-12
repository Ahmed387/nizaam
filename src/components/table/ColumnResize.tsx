import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Resizable table columns (owner 2026-11-11 «Column Resizing»), mounted once by DataTable and PermTable so every table
 * of the system gets it with no setup. A thin handle sits on the END edge of each header cell of the last header row:
 *   - drag it → that column gets wider / narrower (the page is RTL: dragging LEFT widens);
 *   - double-click it → the column goes back to its natural width.
 * Until a column is resized the table is untouched. From the first resize the widths of ALL columns are frozen at what
 * they measure, the table switches to `table-layout: fixed` with width = Σ columns (its scroll box scrolls sideways),
 * so only the dragged column changes. Widths are remembered per person's browser, per page path and table
 * (localStorage `colw:v1:<path>:<id of the table>`), keyed by the column's title; a column whose title is not saved keeps its
 * natural width. Applied with a <style> of nth-child rules (like PermTable's hidden columns), never by editing cells,
 * so React re-renders do not lose it. Nothing is sent to the server.
 */
const MIN = 60;
type Head = { el: HTMLTableCellElement; idx: number; label: string };

const labelOf = (th: HTMLTableCellElement) =>
  (th.querySelector("[data-perm-label]")?.textContent ?? th.textContent ?? "").replace(/\s+/g, " ").trim();

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

/**
 * The handles are NOT portalled straight into the <th>: React rewrites a text-only title by setting the cell's text, which
 * drops any foreign child, and unmounting the portal afterwards threw «removeChild» — a white page (owner 2026-11-12).
 * Each header cell gets a holder element we own (`display: contents`, so the handles still position against the cell);
 * the portals live in the holder, and the holder is put back whenever the cell lost it.
 */
const holders = new WeakMap<HTMLTableCellElement, HTMLSpanElement>();
function holderOf(th: HTMLTableCellElement): HTMLSpanElement {
  let h = holders.get(th);
  if (!h) {
    h = document.createElement("span");
    h.setAttribute("data-cr-holder", ""); h.setAttribute("data-xf-ignore", ""); h.setAttribute("data-no-print", "");
    h.style.display = "contents";
    holders.set(th, h);
  }
  if (h.parentNode !== th) th.appendChild(h);
  return h;
}

const load = (key: string): Record<string, number> => {
  try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch { return {}; }
};
const save = (key: string, v: Record<string, number>) => {
  try { if (Object.keys(v).length) localStorage.setItem(key, JSON.stringify(v)); else localStorage.removeItem(key); } catch { /* private mode */ }
};

export function ColumnResizeLayer({ table, storageId }: { table: HTMLTableElement | null; storageId?: string }) {
  const pathname = typeof window === "undefined" ? "" : window.location.pathname;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [heads, setHeads] = useState<Head[]>([]);
  const [tick, setTick] = useState(0);
  const sig = heads.map((h) => h.label).join("|");
  const key = `colw:v1:${pathname}:${storageId ?? "t"}`;
  const [widths, setWidths] = useState<Record<string, number>>({});
  const drag = useRef<{ label: string; startX: number; startW: number; rtl: boolean } | null>(null);
  // row height (owner 2026-11-11 «محتاج انفذه على الصفوف بردو»): ONE height for all body rows of the table, dragged from
  // the bottom edge of the header; saved with the widths under "__row". Double-click = natural height again.
  const ROW = "__row";
  const rowDrag = useRef<{ startY: number; startH: number } | null>(null);
  const rowH = widths[ROW];
  const startRow = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const first = table?.querySelector(":scope > tbody > tr") as HTMLElement | null;
    rowDrag.current = { startY: e.clientY, startH: Math.round(first?.getBoundingClientRect().height ?? 40) };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    document.body.style.cursor = "row-resize"; document.body.style.userSelect = "none";
  };
  const moveRow = (e: React.PointerEvent) => {
    const d = rowDrag.current; if (!d) return;
    const next = Math.max(22, Math.min(160, d.startH + (e.clientY - d.startY)));
    setWidths((w) => (w[ROW] === next ? w : { ...w, [ROW]: next }));
  };
  const endRow = () => {
    if (!rowDrag.current) return;
    rowDrag.current = null; document.body.style.cursor = ""; document.body.style.userSelect = "";
    setWidths((w) => { save(key, w); return w; });
  };
  const resetRow = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setWidths((w) => { const n = { ...w }; delete n[ROW]; save(key, n); return n; });
  };
  const rowCss = rowH ? `[data-cr="${uid}"] > tbody > tr > * { height: ${rowH}px !important; padding-top: ${Math.max(1, Math.min(14, Math.round((rowH - 22) / 2)))}px !important; padding-bottom: ${Math.max(1, Math.min(14, Math.round((rowH - 22) / 2)))}px !important; }` : "";

  // header cells: re-read whenever the header changes (columns shown / hidden, other data)
  useEffect(() => {
    if (!table) { setHeads([]); return; }
    const scan = () => {
      const next = readHeads(table);
      next.forEach((h) => holderOf(h.el));   // put a dropped holder back (the title's text was rewritten)
      setHeads((prev) => (prev.length === next.length && prev.every((h, i) => h.el === next[i].el && h.label === next[i].label) ? prev : next));
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(table, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [table]);

  useEffect(() => { setWidths(load(key)); }, [key]);
  useEffect(() => {
    if (!table) return;
    table.setAttribute("data-cr", uid);
    return () => table.removeAttribute("data-cr");
  }, [table, uid]);

  const active = heads.some((h) => widths[h.label] != null);
  // natural widths of the columns that were not resized, measured once when resizing starts (and when the header changes)
  const natural = useRef<Record<string, number>>({});
  useEffect(() => { natural.current = {}; }, [sig]);
  const measure = useCallback(() => {
    heads.forEach((h) => { if (natural.current[h.label] == null) natural.current[h.label] = Math.max(MIN, Math.round(h.el.getBoundingClientRect().width)); });
  }, [heads]);

  const css = useMemo(() => {
    if (!active) return "";
    const w = (h: Head) => Math.max(MIN, Math.round(widths[h.label] ?? natural.current[h.label] ?? h.el.getBoundingClientRect().width));
    const total = heads.reduce((s, h) => s + w(h), 0);
    const rules = heads.map((h) => {
      const px = w(h);
      return `[data-cr="${uid}"] > * > tr > :nth-child(${h.idx}):not([colspan]) { width: ${px}px !important; min-width: ${px}px !important; max-width: ${px}px !important; overflow: hidden; text-overflow: ellipsis; }`;
    });
    return `[data-cr="${uid}"] { table-layout: fixed !important; width: ${total}px !important; min-width: ${total}px !important; max-width: none !important; }\n${rules.join("\n")}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, widths, sig, uid, tick]);

  const start = (h: Head, e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    measure();
    const rtl = getComputedStyle(h.el).direction === "rtl";
    drag.current = { label: h.label, startX: e.clientX, startW: Math.round(h.el.getBoundingClientRect().width), rtl };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const next = Math.max(MIN, d.startW + (d.rtl ? -dx : dx));
    setWidths((w) => (w[d.label] === next ? w : { ...w, [d.label]: next }));
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    document.body.style.cursor = ""; document.body.style.userSelect = "";
    setWidths((w) => { save(key, w); return w; });
  };
  const reset = (h: Head, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setWidths((w) => { const n = { ...w }; delete n[h.label]; save(key, n); return n; });
    natural.current = {};
    setTick((t) => t + 1);
  };

  if (!table || heads.length === 0) return null;
  return (
    <>
      {css && <style>{css}</style>}
      {rowCss && <style>{rowCss}</style>}
      <style>{`[data-cr="${uid}"] > thead > tr:last-child > *:not(.sticky) { position: relative; }${active ? `\n*:has(> [data-cr="${uid}"]) { overflow-x: auto !important; }` : ""}`}</style>
      {heads.map((h) => createPortal(
        <span
          role="separator" aria-orientation="vertical" aria-label={`تغيير عرض عمود ${h.label}`} title="اسحب لتغيير عرض العمود — دبل كليك يرجّعه"
          data-xf-ignore="" data-no-print=""
          onPointerDown={(e) => start(h, e)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
          onDoubleClick={(e) => reset(h, e)} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()} draggable={false}
          className="print:hidden absolute top-0 bottom-0 z-10 w-2 cursor-col-resize select-none touch-none hover:bg-primary/40 active:bg-primary/60"
          style={{ insetInlineEnd: 0 }}
        />,
        holderOf(h.el),
        `cr-${h.idx}-${h.label}`,
      ))}
      {heads.map((h) => createPortal(
        <span
          role="separator" aria-orientation="horizontal" aria-label="تغيير ارتفاع الصفوف" title="اسحب لتحت أو لفوق لتغيير ارتفاع الصفوف — دبل كليك يرجّعه"
          data-xf-ignore="" data-no-print="" draggable={false}
          onPointerDown={startRow} onPointerMove={moveRow} onPointerUp={endRow} onPointerCancel={endRow}
          onDoubleClick={resetRow} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()}
          className="print:hidden absolute bottom-0 z-10 h-1.5 cursor-row-resize select-none touch-none hover:bg-primary/40 active:bg-primary/60"
          style={{ insetInlineStart: 0, insetInlineEnd: 8 }}
        />,
        holderOf(h.el),
        `rr-${h.idx}-${h.label}`,
      ))}
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
