import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, Filter, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  BLANK, BLANK_LABEL, EMPTY_STATE, MONTH_NAMES, dayLabel, describeFilter, detectKind, facets as facetsOf, hashText,
  isActive, isSummable, loadState, normText, parseCell, saveState, sortOrder, sortWords, sumColumn, visibleRows,
  type Cell, type CellKind, type ColumnFilter, type Facet, type FilterState, type NumberOp,
} from "@/lib/tableFilter";

/**
 * Excel-like filter layer for one HTML table (owner 2026-10-26). Rendered by DataTable / PermTable next to their table:
 * an arrow in every column title (sort + values with counts / number conditions / date tree), a bar of the active
 * filters with «مسح الكل» and «ظاهر X من Y», and a totals row of the number columns for the rows still shown.
 *
 * Two modes:
 *  - page (default): the values are the TEXT the person sees in each cell, read from the table after every render;
 *    rows are hidden / reordered in the DOM (React keeps owning them; the order is re-applied after each commit).
 *  - server: the host table shows one page of a bigger list; the host filters the WHOLE list (in the database, or in
 *    memory with `useListFilter`), gives the value lists with their counts and the totals of the whole filtered list.
 * Filters are remembered per table on this device (localStorage, never required).
 */

export type ServerColumn = { kind: CellKind; label?: string; sum?: boolean; money?: boolean };
export type ServerAdapter = {
  columns: Record<string, ServerColumn>;
  state: FilterState;
  onChange: (s: FilterState) => void;
  facets: (col: string, s: FilterState) => Promise<Facet[]>;
  /** totals of the whole filtered list: a number, or the cell's text when a plain sum is not what the column shows */
  totals?: Record<string, number | string | null | undefined>;
  /** rows left by the filters (all pages) */
  shown?: number;
  /** rows before the column filters; unknown = not shown */
  total?: number;
};

type Col = {
  id: string;
  label: string;
  /** cell index in the row (0-based, header cells of the last header row) */
  index: number;
  th: HTMLTableCellElement;
  filterable: boolean;
  kind: CellKind;
  sum: boolean;
  money: boolean;
};
type DataRow = { tr: HTMLTableRowElement; cells: Cell[]; attached: HTMLTableRowElement[] };
type Measure = { cols: Col[]; heads: HTMLTableCellElement[]; rows: DataRow[]; loose: HTMLTableRowElement[]; indexCol: number };

const NO_FILTER_HEAD = /^(#|✓|☑|)$|إجراء|^تفاصيل$|^تعديل$|^مرفقات$|^الصورة$|^صورة$/;

function labelOf(th: HTMLTableCellElement) {
  const own = th.querySelector("[data-perm-label]");
  const clone = (own ?? th).cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-xf-ui],svg").forEach((n) => n.remove());
  return normText(clone.textContent);
}

function textNodes(el: Node) {
  // text of every text node, joined with spaces (a name and a phone in two lines don't stick together)
  const parts: string[] = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue && n.nodeValue.trim()) parts.push(n.nodeValue);
  return parts.join(" ");
}

function cellText(td: Element | undefined) {
  if (!td) return "";
  const el = td as HTMLElement;
  if (el.dataset.xfValue !== undefined) return el.dataset.xfValue;
  if (!el.querySelector("[data-xf-skip],input,select,textarea")) return textNodes(el);
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-xf-skip]").forEach((n) => n.remove());
  const live = el.querySelectorAll("input,textarea,select");
  clone.querySelectorAll("input,textarea,select").forEach((n, i) => {
    const src = live[i] as HTMLInputElement | HTMLSelectElement | undefined;
    const v = src instanceof HTMLSelectElement ? src.selectedOptions?.[0]?.textContent ?? "" : (src as HTMLInputElement | undefined)?.value ?? "";
    n.replaceWith(document.createTextNode(` ${v} `));
  });
  return textNodes(clone);
}

const rowCache = new WeakMap<HTMLTableRowElement, { sig: string; cells: Cell[] }>();

function measure(table: HTMLTableElement, wantCells: boolean): Measure {
  const headRows = table.querySelectorAll(":scope > thead > tr");
  const headRow = headRows[headRows.length - 1] as HTMLTableRowElement | undefined;
  const heads = headRow ? (Array.from(headRow.children) as HTMLTableCellElement[]) : [];
  const spanSum = heads.reduce((s, h) => s + (h.colSpan || 1), 0);
  const seen = new Map<string, number>();
  const cols: Col[] = [];
  let indexCol = -1;
  heads.forEach((th, index) => {
    const label = labelOf(th);
    if (label === "#" && indexCol < 0) indexCol = index;
    let id = th.dataset.xfCol || label || `col${index}`;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    if (n > 1) id = `${id}#${n}`;
    const filterable = (th.colSpan || 1) === 1 && th.dataset.xfNofilter === undefined && !NO_FILTER_HEAD.test(label);
    cols.push({ id, label: label || id, index, th, filterable, kind: "text", sum: false, money: false });
  });
  const rows: DataRow[] = [];
  const loose: HTMLTableRowElement[] = [];
  const colSig = cols.map((c) => c.index).join(",");
  const bodies = Array.from(table.querySelectorAll(":scope > tbody")) as HTMLTableSectionElement[];
  for (const tb of bodies) {
    let last: DataRow | null = null;
    for (const tr of Array.from(tb.rows)) {
      const cells = Array.from(tr.cells);
      const span = cells.reduce((s, c) => s + (c.colSpan || 1), 0);
      const isData = heads.length > 0 && cells.length === heads.length && span === spanSum && tr.dataset.xfDetail === undefined;
      if (isData) {
        let parsed: Cell[] = [];
        if (wantCells) {
          // a row whose text didn't change since the last render keeps its parsed cells (big tables stay fast)
          const sig = colSig + "\u0001" + (tr.textContent ?? "");
          const hit = rowCache.get(tr);
          if (hit && hit.sig === sig) parsed = hit.cells;
          else {
            parsed = cols.map((c) => parseCell(cellText(cells[c.index])));
            rowCache.set(tr, { sig, cells: parsed });
          }
        }
        last = { tr, cells: parsed, attached: [] };
        rows.push(last);
      } else if (last && (tr.dataset.xfDetail !== undefined || last.tr.getAttribute("aria-expanded") === "true")) {
        last.attached.push(tr);
      } else {
        loose.push(tr);
        last = null;
      }
    }
  }
  if (wantCells) {
    cols.forEach((c, ci) => {
      const colCells = rows.map((r) => r.cells[ci]);
      const forced = c.th.dataset.xfKind as CellKind | undefined;
      c.kind = forced ?? detectKind(c.label, colCells);
      c.sum = c.th.dataset.xfSum !== undefined ? c.th.dataset.xfSum !== "0" : isSummable(c.label, c.kind, colCells);
      c.money = colCells.some((x) => /ج\.?\s?م/.test(x.text));
      if (colCells.every((x) => x.blank) && rows.length) c.filterable = false;
    });
  }
  return { cols, heads, rows, loose, indexCol };
}

const fmtTotal = (n: number | string, money: boolean) =>
  typeof n === "string" ? n : `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}${money ? " ج.م" : ""}`;

type Snap = {
  key: string;
  cols: { id: string; label: string; kind: CellKind; filterable: boolean; sum: boolean; money: boolean; index: number }[];
  shown: number;
  total: number | undefined;
  totals: Record<string, number | string>;
  headCount: number;
  /** the table has its own footer (its own totals): ours shows only while filtering */
  ownFooter: boolean;
};

export function ExcelLayer({ table, storageId, server, disabled, minRows = 2, onVisibleChange }: {
  table: HTMLTableElement | null;
  /** distinguishes tables with the same columns on one page */
  storageId?: string;
  server?: ServerAdapter;
  disabled?: boolean;
  minRows?: number;
  /**
   * page mode: after every render, the `data-xf-nat` of the rows still shown, in the order shown (null = no column
   * filter / sort) — lets the host export / print what the filters leave
   */
  onVisibleChange?: (nat: number[] | null) => void;
}) {
  const [own, setOwn] = useState<FilterState>(EMPTY_STATE);
  const state = server ? server.state : own;
  const keyRef = useRef<string | null>(null);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [openCol, setOpenCol] = useState<string | null>(null);
  const measureRef = useRef<Measure | null>(null);
  const tfootRef = useRef<HTMLTableSectionElement | null>(null);
  /** one <span> of ours per column: its arrow is portaled into it, never into the <th> React owns */
  const slotsRef = useRef(new Map<string, HTMLSpanElement>());
  const wasActive = useRef(false);

  const setState = useCallback((s: FilterState) => {
    if (server) server.onChange(s);
    else {
      setOwn(s);
      if (keyRef.current) saveState(keyRef.current, s);
    }
  }, [server]);

  // after every render of the host: read the table, apply the filters, refresh what the bar / totals show
  useLayoutEffect(() => {
    if (!table || disabled) return;
    const active = isActive(state);
    const m = measure(table, !server);
    measureRef.current = m;
    const sig = m.cols.map((c) => c.id).join("|");
    const key = `xf:v1:${window.location.pathname}:${storageId ?? hashText(sig)}`;
    if (!server && keyRef.current !== key) {
      keyRef.current = key;
      const loaded = loadState(key);
      if (JSON.stringify(loaded) !== JSON.stringify(own)) {
        setOwn(loaded);
        return; // re-runs with the remembered filters
      }
    }
    let shown = m.rows.length;
    const totals: Record<string, number | string> = {};
    if (server) {
      for (const c of m.cols) {
        const sc = server.columns[c.th.dataset.xfCol ?? ""];
        c.filterable = !!sc;
        if (sc) { c.id = c.th.dataset.xfCol as string; c.kind = sc.kind; c.sum = !!sc.sum; c.money = !!sc.money; c.label = sc.label ?? c.label; }
        const t = server.totals?.[c.id];
        if (c.sum && t !== null && t !== undefined) totals[c.id] = t;
      }
      shown = server.shown ?? m.rows.length;
    } else {
      const ids = m.cols.map((c) => c.id);
      const matrix = m.rows.map((r) => r.cells);
      const vis = active ? visibleRows(matrix, ids, state) : m.rows.map(() => true);
      shown = vis.filter(Boolean).length;
      m.cols.forEach((c, ci) => { if (c.sum) totals[c.id] = sumColumn(matrix, ci, vis); });
      // remember the natural order once, before anything moves
      // remember the natural order (React's) while nothing has moved; rows that come later go to the end
      for (const tb of Array.from(table.tBodies)) {
        Array.from(tb.rows).forEach((tr, i) => {
          const mine = tr.dataset.xfNat === undefined || tr.dataset.xfNatOwn !== undefined;
          if (!mine) return;
          if (!wasActive.current) { tr.dataset.xfNat = String(i); tr.dataset.xfNatOwn = ""; }
          else if (tr.dataset.xfNat === undefined) { tr.dataset.xfNat = String(1e6 + i); tr.dataset.xfNatOwn = ""; }
        });
      }
      if (active) {
        const setHid = (tr: HTMLTableRowElement, hide: boolean) => {
          if (hide) { if (!tr.hidden) { tr.hidden = true; tr.dataset.xfHid = ""; } }
          else if (tr.dataset.xfHid !== undefined) { tr.hidden = false; delete tr.dataset.xfHid; }
        };
        m.rows.forEach((r, i) => { [r.tr, ...r.attached].forEach((tr) => setHid(tr, !vis[i])); });
        m.loose.forEach((tr) => setHid(tr, true));
        const sc = state.sort ? m.cols.findIndex((c) => c.id === state.sort!.col) : -1;
        const order = sc >= 0 ? sortOrder(matrix, sc, state.sort!.dir, m.cols[sc].kind) : m.rows.map((_, i) => i);
        if (sc >= 0) {
          const byBody = new Map<HTMLTableSectionElement, HTMLTableRowElement[]>();
          for (const i of order) {
            const r = m.rows[i];
            const tb = r.tr.parentElement as HTMLTableSectionElement;
            if (!byBody.has(tb)) byBody.set(tb, []);
            byBody.get(tb)!.push(r.tr, ...r.attached);
          }
          for (const [tb, list] of byBody) {
            const cur = Array.from(tb.rows);
            const inList = new Set(list);
            const want2 = [...list, ...cur.filter((tr) => !inList.has(tr))];
            if (cur.some((tr, i) => tr !== want2[i])) want2.forEach((tr) => tb.appendChild(tr));
          }
        } else restoreOrder(table);
        // renumber «#» in the order shown
        if (m.indexCol >= 0) {
          let n = 0;
          const shownRows = (sc >= 0 ? order : m.rows.map((_, i) => i)).map((i) => m.rows[i]).filter((r) => !r.tr.hidden);
          const origs = m.rows.map((r) => { const td = r.tr.cells[m.indexCol] as HTMLElement | undefined; return Number(normText(td?.dataset.xfOrig ?? td?.textContent)); }).filter((x) => Number.isFinite(x) && x > 0);
          const first = origs.length ? Math.min(...origs) : 1;
          for (const r of shownRows) {
            const td = r.tr.cells[m.indexCol] as HTMLElement;
            if (td.dataset.xfOrig === undefined) td.dataset.xfOrig = td.textContent ?? "";
            n += 1;
            const t = String(first - 1 + n);
            if (td.textContent !== t) td.textContent = t;
          }
        }
        wasActive.current = true;
        onVisibleChange?.((sc >= 0 ? order : m.rows.map((_, i) => i)).filter((i) => vis[i]).map((i) => Number(m.rows[i].tr.dataset.xfNat)));
      } else {
        if (wasActive.current) {
          undo(table);
          wasActive.current = false;
        }
        onVisibleChange?.(null);
      }
    }
    const next: Snap = {
      key: keyRef.current ?? key,
      cols: m.cols.map((c) => ({ id: c.id, label: c.label, kind: c.kind, filterable: c.filterable, sum: c.sum, money: c.money, index: c.index })),
      shown,
      total: server ? server.total : m.rows.length,
      totals,
      headCount: m.heads.length,
      ownFooter: Array.from(table.querySelectorAll(":scope > tfoot")).some((tf) => (tf as HTMLElement).dataset.xfTotals === undefined && tf.textContent?.trim()),
    };
    if (!snap || JSON.stringify(next) !== JSON.stringify(snap)) setSnap(next);
  });

  // the totals row lives in our own <tfoot> at the end of the table
  useLayoutEffect(() => {
    if (!table || disabled) return;
    // one element for the life of the layer (the totals portal points at it); put back at the end if moved out
    if (!tfootRef.current) {
      const tf = document.createElement("tfoot");
      tf.dataset.xfUi = "";
      tf.dataset.xfTotals = "";
      tfootRef.current = tf;
    }
    if (tfootRef.current.parentElement !== table || table.lastElementChild !== tfootRef.current) table.appendChild(tfootRef.current);
  });
  // every arrow sits in its own <span> at the end of the column title. React rewrites a title whose only child is its
  // text (e.g. «الرصيد بعد الحركة» ↔ «رصيد الوعاء بعد الحركة») by setting the <th>'s text, which drops every other
  // child: an arrow portaled straight into the <th> was lost, and removing it later threw «removeChild» (white page).
  // The span is put back after every commit, the arrow inside it never moves.
  useLayoutEffect(() => {
    if (!table || disabled) return;
    const want = new Map<string, HTMLTableCellElement>();
    measureRef.current?.cols.forEach((c) => { if (c.filterable) want.set(c.id, c.th); });
    for (const [id, slot] of slotsRef.current) {
      const th = want.get(id);
      if (!th || !slot.hasChildNodes()) { if (slot.parentNode) slot.remove(); }
      else if (slot.parentNode !== th || th.lastChild !== slot) th.appendChild(slot);
    }
  });
  useEffect(() => {
    const t = table;
    return () => {
      if (!t) return;
      // only what is still in THIS table: the layer may already have moved them into the next one
      if (tfootRef.current && t.contains(tfootRef.current)) tfootRef.current.remove();
      slotsRef.current.forEach((s) => { if (t.contains(s)) s.remove(); });
      undo(t);
    };
  }, [table]);
  const slotFor = (id: string) => {
    let s = slotsRef.current.get(id);
    if (!s) {
      s = document.createElement("span");
      s.dataset.xfUi = "";
      s.dataset.xfSlot = id;
      s.style.display = "contents";
      slotsRef.current.set(id, s);
    }
    return s;
  };

  const active = isActive(state);
  const anySum = !!snap && snap.cols.some((c) => c.sum);
  const showUi = !!snap && !disabled && ((snap.total ?? 0) >= minRows || active || !!server);

  const apply = (col: string, f: ColumnFilter | null) => {
    const filters = { ...state.filters };
    if (f) filters[col] = f;
    else delete filters[col];
    setState({ ...state, filters });
  };
  const setSort = (col: string, dir: "asc" | "desc" | null) => setState({ ...state, sort: dir ? { col, dir } : null });

  const facetsFor = useCallback(async (col: string, kind: CellKind): Promise<Facet[]> => {
    if (server) return server.facets(col, state);
    const m = measureRef.current;
    if (!m) return [];
    return facetsOf(m.rows.map((r) => r.cells), m.cols.map((c) => c.id), state, col, kind);
  }, [server, state]);

  if (!table || disabled || !snap) return null;
  const labelById = new Map(snap.cols.map((c) => [c.id, c.label]));
  // a filter on a column this person can't see (hidden by permissions) still gets its chip, so it can be removed
  if (server) for (const [k, sc] of Object.entries(server.columns)) if (!labelById.has(k) && sc.label) labelById.set(k, sc.label);

  return (
    <>
      {showUi && active && <FilterBar state={state} labels={labelById} shown={snap.shown} total={snap.total} onChange={setState} />}
      {showUi && snap.cols.filter((c) => c.filterable).map((c) => {
        const th = measureRef.current?.cols.find((x) => x.id === c.id)?.th;
        if (!th) return null;
        return createPortal(
          <HeaderArrow
            key={c.id}
            label={c.label}
            kind={c.kind}
            filter={state.filters[c.id]}
            sort={state.sort?.col === c.id ? state.sort.dir : null}
            open={openCol === c.id}
            onOpenChange={(o) => setOpenCol(o ? c.id : null)}
            loadFacets={() => facetsFor(c.id, c.kind)}
            onApply={(f) => { apply(c.id, f); setOpenCol(null); }}
            onSort={(d) => { setSort(c.id, d); setOpenCol(null); }}
          />,
          slotFor(c.id),
          `xf-${c.id}`,
        );
      })}
      {showUi && anySum && tfootRef.current && snap.shown >= 1 && (active || !snap.ownFooter) && createPortal(
        <tr className="bg-surface-2 border-t-2 border-border font-extrabold">
          {Array.from({ length: snap.headCount }, (_, i) => {
            const c = snap.cols.find((x) => x.index === i);
            const firstNonSum = snap.cols.find((x) => !x.sum && x.label !== "#" && x.label !== "✓");
            if (c && c.sum && snap.totals[c.id] !== undefined) return <td key={i} className="px-2 md:px-3 py-2.5 text-center tabular-nums whitespace-nowrap">{fmtTotal(snap.totals[c.id], c.money)}</td>;
            if (c && firstNonSum && c.id === firstNonSum.id) return <td key={i} className="px-2 md:px-3 py-2.5 text-center whitespace-nowrap">المجموع{server ? "" : ` (${snap.shown.toLocaleString("en-US")})`}</td>;
            return <td key={i} />;
          })}
        </tr>,
        tfootRef.current,
      )}
    </>
  );
}

/** the bar of active filters above a table: one chip per filter (✕ removes it), the sort, «ظاهر X من Y», «مسح الكل» */
export function FilterBar({ state, labels, shown, total, onChange }: {
  state: FilterState;
  labels: Map<string, string>;
  shown: number;
  /** rows before the filters; left out when unknown or the same as `shown` */
  total?: number;
  onChange: (s: FilterState) => void;
}) {
  const chips = Object.entries(state.filters).filter(([id]) => labels.has(id));
  const drop = (id: string) => { const f = { ...state.filters }; delete f[id]; onChange({ ...state, filters: f }); };
  return (
    <div data-xf-ui="" className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-primary/5 text-sm" role="status" aria-live="polite">
      <span className="font-bold text-foreground">الفلاتر:</span>
      {chips.map(([id, f]) => (
        <span key={id} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-background px-2.5 py-1 text-xs font-semibold">
          {describeFilter(labels.get(id) ?? id, f)}
          <button type="button" onClick={() => drop(id)} aria-label={`شيل فلتر ${labels.get(id) ?? id}`} className="rounded-full p-0.5 hover:bg-muted"><X className="w-3 h-3" aria-hidden="true" /></button>
        </span>
      ))}
      {state.sort && labels.has(state.sort.col) && (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold">
          ترتيب: {labels.get(state.sort.col)} {state.sort.dir === "asc" ? "↑" : "↓"}
          <button type="button" onClick={() => onChange({ ...state, sort: null })} aria-label="شيل الترتيب" className="rounded-full p-0.5 hover:bg-muted"><X className="w-3 h-3" aria-hidden="true" /></button>
        </span>
      )}
      <span className="text-muted-foreground tabular-nums">ظاهر {shown.toLocaleString("en-US")}{total !== undefined && total !== shown ? ` من ${total.toLocaleString("en-US")}` : ""}</span>
      <button type="button" onClick={() => onChange(EMPTY_STATE)} className="mr-auto rounded-md border border-border bg-background px-2.5 py-1 text-xs font-bold hover:bg-muted min-h-[32px]">مسح الكل</button>
    </div>
  );
}

function restoreOrder(table: HTMLTableElement) {
  for (const tb of Array.from(table.tBodies)) {
    const rows = Array.from(tb.rows);
    const sorted = [...rows].sort((a, b) => Number(a.dataset.xfNat ?? 1e9) - Number(b.dataset.xfNat ?? 1e9));
    if (rows.some((tr, i) => tr !== sorted[i])) sorted.forEach((tr) => tb.appendChild(tr));
  }
}

function undo(table: HTMLTableElement) {
  table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr[data-xf-hid]").forEach((tr) => { tr.hidden = false; delete tr.dataset.xfHid; });
  table.querySelectorAll<HTMLElement>(":scope > tbody > tr > [data-xf-orig]").forEach((td) => { td.textContent = td.dataset.xfOrig ?? ""; delete td.dataset.xfOrig; });
  restoreOrder(table);
}

// ---------------------------------------------------------------- the arrow and its menu

function HeaderArrow(p: {
  label: string;
  kind: CellKind;
  filter?: ColumnFilter;
  sort: "asc" | "desc" | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  loadFacets: () => Promise<Facet[]>;
  onApply: (f: ColumnFilter | null) => void;
  onSort: (d: "asc" | "desc" | null) => void;
}) {
  const mobile = useIsMobile();
  const on = !!p.filter || !!p.sort;
  const btn = (
    <button
      type="button"
      data-xf-ui=""
      onClick={(e) => { e.stopPropagation(); if (mobile) p.onOpenChange(!p.open); }}
      aria-label={`فلتر وترتيب عمود ${p.label}${p.filter ? " (عليه فلتر)" : ""}`}
      aria-haspopup="dialog"
      aria-expanded={p.open}
      className={`mr-1 inline-flex align-middle items-center justify-center w-7 h-7 min-w-7 rounded-md border transition-colors ${on ? "bg-primary text-primary-foreground border-primary" : "bg-background/70 text-muted-foreground border-border hover:bg-muted hover:text-foreground"}`}
    >
      {p.filter ? <Filter className="w-3.5 h-3.5" aria-hidden="true" /> : p.sort === "asc" ? <ArrowUpNarrowWide className="w-3.5 h-3.5" aria-hidden="true" /> : p.sort === "desc" ? <ArrowDownWideNarrow className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
    </button>
  );
  const body = p.open ? <ColumnMenu {...p} /> : null;
  if (mobile) {
    return (
      <>
        {btn}
        <Sheet open={p.open} onOpenChange={p.onOpenChange}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto p-4" dir="rtl" data-xf-ui="">
            <SheetHeader><SheetTitle className="text-right">{p.label}</SheetTitle></SheetHeader>
            {body}
          </SheetContent>
        </Sheet>
      </>
    );
  }
  return (
    <Popover open={p.open} onOpenChange={p.onOpenChange}>
      <PopoverTrigger asChild>{btn}</PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[92vw] p-0" dir="rtl" data-xf-ui="" onClick={(e) => e.stopPropagation()}
        onFocusOutside={(e) => e.preventDefault()}>
        <div className="px-4 pt-3 pb-1 font-extrabold text-sm text-foreground">{p.label}</div>
        {body}
      </PopoverContent>
    </Popover>
  );
}

function ColumnMenu({ kind, filter, sort, loadFacets, onApply, onSort, onOpenChange }: {
  kind: CellKind;
  filter?: ColumnFilter;
  sort: "asc" | "desc" | null;
  loadFacets: () => Promise<Facet[]>;
  onApply: (f: ColumnFilter | null) => void;
  onSort: (d: "asc" | "desc" | null) => void;
  onOpenChange: (o: boolean) => void;
}) {
  const [list, setList] = useState<Facet[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadFacets().then((l) => { if (live) setList(l); }, (e) => { if (live) setErr(e?.message ?? "حصلت مشكلة وإحنا بنجيب القيم"); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [up, down] = sortWords(kind);
  return (
    <div className="text-sm" onKeyDown={(e) => { if (e.key === "Escape") onOpenChange(false); }}>
      <div className="grid grid-cols-2 gap-2 px-4 py-2">
        <button type="button" onClick={() => onSort(sort === "asc" ? null : "asc")} aria-pressed={sort === "asc"}
          className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-bold min-h-[36px] ${sort === "asc" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
          <ArrowUpNarrowWide className="w-4 h-4" aria-hidden="true" /> {up}
        </button>
        <button type="button" onClick={() => onSort(sort === "desc" ? null : "desc")} aria-pressed={sort === "desc"}
          className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-bold min-h-[36px] ${sort === "desc" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
          <ArrowDownWideNarrow className="w-4 h-4" aria-hidden="true" /> {down}
        </button>
      </div>
      <div className="border-t border-border" />
      {err ? <div className="p-4 text-destructive text-xs">{err}</div>
        : list === null ? <div className="p-4 text-muted-foreground text-xs">بنجيب القيم…</div>
        : kind === "number" ? <NumberPane list={list} filter={filter?.kind === "number" ? filter : undefined} onApply={onApply} onCancel={() => onOpenChange(false)} hasFilter={!!filter} />
        : kind === "date" ? <DatePane list={list} filter={filter?.kind === "date" ? filter : undefined} onApply={onApply} onCancel={() => onOpenChange(false)} hasFilter={!!filter} />
        : <ValuesPane list={list} filter={filter?.kind === "values" ? filter : undefined} onApply={onApply} onCancel={() => onOpenChange(false)} hasFilter={!!filter} />}
    </div>
  );
}

function Footer({ canApply, onApply, onClear, onCancel, hasFilter }: { canApply: boolean; onApply: () => void; onClear: () => void; onCancel: () => void; hasFilter: boolean }) {
  return (
    <div className="flex items-center gap-2 border-t border-border px-4 py-3">
      <button type="button" disabled={!canApply} onClick={onApply} className="rounded-md bg-primary px-4 py-2 text-xs font-extrabold text-primary-foreground disabled:opacity-40 min-h-[36px]">تطبيق</button>
      {hasFilter && <button type="button" onClick={onClear} className="rounded-md border border-border px-3 py-2 text-xs font-bold hover:bg-muted min-h-[36px]">مسح فلتر العمود</button>}
      <button type="button" onClick={onCancel} className="mr-auto rounded-md px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-muted min-h-[36px]">إلغاء</button>
    </div>
  );
}

const SHOW_MAX = 300;

function ValuesPane({ list, filter, onApply, onCancel, hasFilter }: { list: Facet[]; filter?: Extract<ColumnFilter, { kind: "values" }>; onApply: (f: ColumnFilter | null) => void; onCancel: () => void; hasFilter: boolean }) {
  const all = useMemo(() => list.map((f) => f.value), [list]);
  const [sel, setSel] = useState<Set<string>>(() => new Set(filter ? filter.values : all));
  const [q, setQ] = useState("");
  const ql = normText(q).toLowerCase();
  const shown = ql ? list.filter((f) => f.label.toLowerCase().includes(ql)) : list;
  const cut = shown.slice(0, SHOW_MAX);
  const allShownOn = shown.length > 0 && shown.every((f) => sel.has(f.value));
  const someShownOn = shown.some((f) => sel.has(f.value));
  const toggleAll = () => {
    const n = new Set(sel);
    if (allShownOn) shown.forEach((f) => n.delete(f.value));
    else shown.forEach((f) => n.add(f.value));
    setSel(n);
  };
  const apply = () => {
    const picked = all.filter((v) => sel.has(v));
    // keep values picked earlier that this list no longer shows (other filters hide them) — Excel keeps them too
    const extra = (filter?.values ?? []).filter((v) => !all.includes(v) && sel.has(v));
    if (picked.length === all.length && !extra.length) onApply(null);
    else onApply({ kind: "values", values: [...picked, ...extra] });
  };
  return (
    <>
      <div className="px-4 pt-3">
        <label className="relative block">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر في القيم…" aria-label="دوّر في قيم العمود"
            className="w-full rounded-md border border-border bg-background py-2 pr-8 pl-2 text-sm outline-none focus:ring-2 focus:ring-primary/40" autoFocus />
        </label>
      </div>
      <div className="px-4 pt-2">
        <label className="flex items-center gap-2 py-1.5 font-bold cursor-pointer">
          <input type="checkbox" checked={allShownOn} ref={(el) => { if (el) el.indeterminate = !allShownOn && someShownOn; }} onChange={toggleAll} className="w-4 h-4 accent-[hsl(var(--primary))]" />
          {ql ? "تحديد كل نتايج البحث" : "تحديد الكل"}
        </label>
      </div>
      <ul className="max-h-64 overflow-y-auto px-4 pb-2" role="listbox" aria-multiselectable="true">
        {cut.map((f) => (
          <li key={f.value}>
            <label className="flex items-center gap-2 py-1.5 cursor-pointer rounded hover:bg-muted/60 px-1">
              <input type="checkbox" checked={sel.has(f.value)} onChange={() => { const n = new Set(sel); if (n.has(f.value)) n.delete(f.value); else n.add(f.value); setSel(n); }} className="w-4 h-4 shrink-0 accent-[hsl(var(--primary))]" />
              <span className={`flex-1 break-words ${f.value === BLANK ? "text-muted-foreground italic" : ""}`}>{f.value === BLANK ? BLANK_LABEL : f.label}</span>
              <span className="tabular-nums text-xs text-muted-foreground">({f.count.toLocaleString("en-US")})</span>
            </label>
          </li>
        ))}
        {!shown.length && <li className="py-3 text-center text-muted-foreground text-xs">مفيش قيم بالحروف دي</li>}
      </ul>
      {shown.length > SHOW_MAX && <div className="px-4 pb-2 text-xs text-muted-foreground">ظاهر أول {SHOW_MAX} من {shown.length.toLocaleString("en-US")} قيمة — اكتب حروف عشان تلاقي الباقي</div>}
      <Footer canApply={all.some((v) => sel.has(v)) || (filter?.values ?? []).some((v) => sel.has(v))} onApply={apply} onClear={() => onApply(null)} onCancel={onCancel} hasFilter={hasFilter} />
    </>
  );
}

const OPS: { op: NumberOp; label: string }[] = [
  { op: "eq", label: "يساوي" },
  { op: "gt", label: "أكبر من" },
  { op: "lt", label: "أصغر من" },
  { op: "between", label: "بين" },
  { op: "gte", label: "أكبر من أو يساوي" },
  { op: "lte", label: "أصغر من أو يساوي" },
];

function NumberPane({ list, filter, onApply, onCancel, hasFilter }: { list: Facet[]; filter?: Extract<ColumnFilter, { kind: "number" }>; onApply: (f: ColumnFilter | null) => void; onCancel: () => void; hasFilter: boolean }) {
  const [op, setOp] = useState<NumberOp>(filter?.op ?? "gt");
  const [a, setA] = useState(filter ? String(filter.a) : "");
  const [b, setB] = useState(filter?.b !== undefined ? String(filter.b) : "");
  const nums = list.filter((f) => f.num !== undefined).map((f) => f.num as number);
  const min = nums.length ? Math.min(...nums) : null;
  const max = nums.length ? Math.max(...nums) : null;
  const na = Number(a.replace(/,/g, "")), nb = Number(b.replace(/,/g, ""));
  const ok = a.trim() !== "" && Number.isFinite(na) && (op !== "between" || (b.trim() !== "" && Number.isFinite(nb)));
  return (
    <>
      <div className="px-4 py-3 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1" role="radiogroup" aria-label="الشرط">
          {OPS.map((o) => (
            <button key={o.op} type="button" role="radio" aria-checked={op === o.op} onClick={() => setOp(o.op)}
              className={`rounded-md border px-1 py-2 text-xs font-bold min-h-[36px] leading-tight ${o.op === "gte" || o.op === "lte" ? "sm:col-span-2" : ""} ${op === o.op ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>{o.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input inputMode="decimal" value={a} onChange={(e) => setA(e.target.value)} placeholder={op === "between" ? "من" : "الرقم"} aria-label={op === "between" ? "من" : "الرقم"}
            className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-primary/40" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && ok) onApply({ kind: "number", op, a: na, b: op === "between" ? nb : undefined }); }} />
          {op === "between" && (
            <input inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} placeholder="إلى" aria-label="إلى"
              className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-primary/40"
              onKeyDown={(e) => { if (e.key === "Enter" && ok) onApply({ kind: "number", op, a: na, b: nb }); }} />
          )}
        </div>
        {min !== null && max !== null && <div className="text-xs text-muted-foreground tabular-nums">القيم من {min.toLocaleString("en-US")} لـ {max.toLocaleString("en-US")} ({list.reduce((s, f) => s + f.count, 0).toLocaleString("en-US")} صف)</div>}
      </div>
      <Footer canApply={ok} onApply={() => onApply({ kind: "number", op, a: na, b: op === "between" ? nb : undefined })} onClear={() => onApply(null)} onCancel={onCancel} hasFilter={hasFilter} />
    </>
  );
}

function DatePane({ list, filter, onApply, onCancel, hasFilter }: { list: Facet[]; filter?: Extract<ColumnFilter, { kind: "date" }>; onApply: (f: ColumnFilter | null) => void; onCancel: () => void; hasFilter: boolean }) {
  const days = useMemo(() => {
    const m = new Map<string, number>();
    list.forEach((f) => { if (f.day) m.set(f.day, (m.get(f.day) ?? 0) + f.count); });
    return [...m.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
  }, [list]);
  const blanks = list.find((f) => f.value === BLANK)?.count ?? 0;
  const months = useMemo(() => {
    const m = new Map<string, { day: string; count: number }[]>();
    days.forEach(([d, c]) => { const k = d.slice(0, 7); if (!m.has(k)) m.set(k, []); m.get(k)!.push({ day: d, count: c }); });
    return [...m.entries()];
  }, [days]);
  const [from, setFrom] = useState(filter?.from ?? "");
  const [to, setTo] = useState(filter?.to ?? "");
  const [sel, setSel] = useState<Set<string>>(() => new Set(filter?.days?.length ? filter.days : days.map(([d]) => d)));
  const [open, setOpen] = useState<Set<string>>(() => new Set(months.length === 1 ? [months[0][0]] : []));
  const allOn = days.length > 0 && days.every(([d]) => sel.has(d));
  const apply = () => {
    const picked = days.map(([d]) => d).filter((d) => sel.has(d));
    const f: ColumnFilter = { kind: "date" };
    if (from) f.from = from;
    if (to) f.to = to;
    if (picked.length !== days.length) f.days = picked;
    if (!f.from && !f.to && !f.days) onApply(null);
    else onApply(f);
  };
  return (
    <>
      <div className="px-4 py-3 grid grid-cols-2 gap-2">
        <label className="text-xs font-bold text-muted-foreground">من يوم
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-bold text-muted-foreground">لحد يوم
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
        </label>
      </div>
      <div className="px-4">
        <label className="flex items-center gap-2 py-1.5 font-bold cursor-pointer">
          <input type="checkbox" checked={allOn} ref={(el) => { if (el) el.indeterminate = !allOn && sel.size > 0; }} onChange={() => setSel(allOn ? new Set() : new Set(days.map(([d]) => d)))} className="w-4 h-4 accent-[hsl(var(--primary))]" />
          كل الأيام
        </label>
      </div>
      <ul className="max-h-64 overflow-y-auto px-4 pb-2">
        {months.map(([ym, ds]) => {
          const [y, m] = ym.split("-").map(Number);
          const on = ds.every((x) => sel.has(x.day));
          const some = ds.some((x) => sel.has(x.day));
          const isOpen = open.has(ym);
          return (
            <li key={ym}>
              <div className="flex items-center gap-2 py-1.5">
                <input type="checkbox" checked={on} ref={(el) => { if (el) el.indeterminate = !on && some; }} aria-label={`${MONTH_NAMES[m]} ${y}`}
                  onChange={() => { const n = new Set(sel); ds.forEach((x) => (on ? n.delete(x.day) : n.add(x.day))); setSel(n); }} className="w-4 h-4 accent-[hsl(var(--primary))]" />
                <button type="button" onClick={() => { const n = new Set(open); if (isOpen) n.delete(ym); else n.add(ym); setOpen(n); }} aria-expanded={isOpen}
                  className="flex-1 flex items-center gap-1 text-right font-semibold hover:underline">
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? "" : "rotate-90"}`} aria-hidden="true" />
                  {MONTH_NAMES[m]} {y}
                </button>
                <span className="tabular-nums text-xs text-muted-foreground">({ds.reduce((s, x) => s + x.count, 0).toLocaleString("en-US")})</span>
              </div>
              {isOpen && (
                <ul className="pr-6">
                  {ds.map((x) => (
                    <li key={x.day}>
                      <label className="flex items-center gap-2 py-1 cursor-pointer">
                        <input type="checkbox" checked={sel.has(x.day)} onChange={() => { const n = new Set(sel); if (n.has(x.day)) n.delete(x.day); else n.add(x.day); setSel(n); }} className="w-4 h-4 accent-[hsl(var(--primary))]" />
                        <span className="flex-1">{dayLabel(x.day)}</span>
                        <span className="tabular-nums text-xs text-muted-foreground">({x.count.toLocaleString("en-US")})</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        {blanks > 0 && <li className="py-1.5 text-xs text-muted-foreground">{BLANK_LABEL}: {blanks.toLocaleString("en-US")} — مش داخلين في فلتر التاريخ</li>}
      </ul>
      <Footer canApply={sel.size > 0 || !!from || !!to} onApply={apply} onClear={() => onApply(null)} onCancel={onCancel} hasFilter={hasFilter} />
    </>
  );
}
