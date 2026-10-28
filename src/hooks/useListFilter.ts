import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServerAdapter } from "@/components/table/ExcelFilter";
import {
  buildMatrix, effectiveState, facets as facetsOf, isActive, loadState, saveState, sortOrder, sumColumn, visibleRows,
  type FilterState, type ListColumn,
} from "@/lib/tableFilter";

/**
 * A table's Excel filters remembered on this device under `key` («زي ما سبتها», owner 2026-10-26).
 * Switching to another key (another tab of the screen) shows that key's own filters.
 */
export function useRememberedFilter(key: string, initial?: () => FilterState): [FilterState, (s: FilterState) => void] {
  // nothing remembered (first visit, or everything was cleared last time): the screen's starting filters, if any
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const read = useCallback((k: string) => {
    const s = loadState(k);
    return !isActive(s) && initialRef.current ? initialRef.current() : s;
  }, []);
  const [store, setStore] = useState(() => ({ key, state: read(key) }));
  // the render that switches key reads the new key straight away (never one render with the old tab's filters)
  const state = useMemo(() => (store.key === key ? store.state : read(key)), [store, key, read]);
  useEffect(() => {
    if (store.key !== key) setStore({ key, state: read(key) });
  }, [key, store.key, read]);
  const set = useCallback((s: FilterState) => {
    setStore({ key, state: s });
    saveState(key, s);
  }, [key]);
  return [state, set];
}

export type ListFilterResult<T> = {
  /** rows left by the column filters AND `extra`, in the order shown (sorted when a column is sorted) */
  rows: T[];
  /** rows left by the column filters only, in the list's own order (what summary cards add up) */
  colRows: T[];
  totals: Record<string, number | string>;
};

/**
 * Excel filters on a list kept in memory («data mode»): a screen that shows one page of a longer list gives the WHOLE
 * list (`rows`, null while it loads) and says what each column shows (`columns`). Filters, the value lists with their
 * counts, sorting and the totals then cover every row, not only the page on screen. The returned `adapter` goes to
 * the table (`DataTable excel={{ server: adapter }}`); the host pages `result.rows` itself.
 *
 * `extra` is another filter of the host (e.g. a clicked summary card): it narrows the rows and the value lists, but
 * not `colRows`. `ensureRows` loads the list when a column menu needs it before the host loaded it.
 */
export function useListFilter<T>({ rows, columns, state, onChange, ensureRows, extra }: {
  rows: T[] | null;
  columns: ListColumn<T>[];
  state: FilterState;
  onChange: (s: FilterState) => void;
  ensureRows: () => Promise<T[]>;
  extra?: ((row: T) => boolean) | null;
}): {
  result: ListFilterResult<T> | null;
  adapter: ServerAdapter;
  state: FilterState;
  /** the rows a list (e.g. one just read for an export) leaves under the current filters, in the order shown */
  apply: (list: T[]) => T[];
} {
  const keys = useMemo(() => columns.map((c) => c.key), [columns]);
  const eff = useMemo(() => effectiveState(state, keys), [state, keys]);
  const matrix = useMemo(() => (rows ? buildMatrix(rows, columns) : null), [rows, columns]);
  // the menu of an open column may outlive a render: it always reaches the latest loader
  const ensureRef = useRef(ensureRows);
  ensureRef.current = ensureRows;

  const result = useMemo<ListFilterResult<T> | null>(
    () => (rows && matrix ? run(rows, matrix, columns, keys, eff, extra ?? null) : null),
    [rows, matrix, keys, eff, extra, columns],
  );
  const apply = useCallback((list: T[]) => run(list, buildMatrix(list, columns), columns, keys, eff, extra ?? null).rows, [columns, keys, eff, extra]);

  const facets = useCallback(async (col: string, s: FilterState) => {
    let all = rows;
    let m = rows ? matrix : null;
    if (!all) {
      try { all = await ensureRef.current(); }
      catch (e) {
        // the list was reloaded under the menu (new filters / a refresh): read the new one
        if ((e as { name?: string })?.name !== "AbortError") throw e;
        all = await ensureRef.current();
      }
      m = null;
    }
    const mm = m ?? buildMatrix(all, columns);
    const pick = extra ? all.map((r) => extra(r)) : null;
    const base = pick ? mm.filter((_, i) => pick[i]) : mm;
    const c = columns.find((x) => x.key === col);
    return c ? facetsOf(base, keys, effectiveState(s, keys), col, c.kind) : [];
  }, [rows, matrix, columns, keys, extra]);

  const adapter = useMemo<ServerAdapter>(() => ({
    columns: Object.fromEntries(columns.map((c) => [c.key, { kind: c.kind, label: c.label, sum: !!c.sum, money: !!c.money }])),
    state: eff,
    onChange,
    facets,
    totals: result?.totals,
    shown: result?.rows.length,
    total: rows?.length,
  }), [columns, eff, onChange, facets, result, rows]);

  return { result, adapter, state: eff, apply };
}

function run<T>(rows: T[], matrix: ReturnType<typeof buildMatrix>, columns: ListColumn<T>[], keys: string[], eff: FilterState, extra: ((row: T) => boolean) | null): ListFilterResult<T> {
  const vis = visibleRows(matrix, keys, eff);
  const keep = extra ? vis.map((v, i) => v && extra(rows[i])) : vis;
  const sc = eff.sort ? keys.indexOf(eff.sort.col) : -1;
  const base = sc >= 0 ? sortOrder(matrix, sc, eff.sort!.dir, columns[sc].kind) : rows.map((_, i) => i);
  const order = base.filter((i) => keep[i]);
  const shown = order.map((i) => rows[i]);
  const totals: Record<string, number | string> = {};
  columns.forEach((c, ci) => {
    if (c.sum) totals[c.key] = c.total ? c.total(shown) : sumColumn(matrix, ci, keep);
  });
  return { rows: shown, colRows: rows.filter((_, i) => vis[i]), totals };
}

/**
 * Any small value remembered on this device under `key` (e.g. the filter bar of one tab). `read` turns what was
 * stored into a value (never trusts it), `isEmpty` says when there is nothing worth keeping (the key is removed).
 */
export function useRemembered<T>(key: string, read: (raw: unknown) => T, isEmpty: (v: T) => boolean): [T, (v: T | ((p: T) => T)) => void] {
  const load = useCallback((k: string): T => {
    try {
      const raw = window.localStorage.getItem(k);
      return read(raw ? JSON.parse(raw) : null);
    } catch {
      return read(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [store, setStore] = useState(() => ({ key, value: load(key) }));
  const value = useMemo(() => (store.key === key ? store.value : load(key)), [store, key, load]);
  useEffect(() => {
    if (store.key !== key) setStore({ key, value: load(key) });
  }, [key, store.key, load]);
  const valueRef = useRef(value);
  valueRef.current = value;
  const set = useCallback((v: T | ((p: T) => T)) => {
    const next = typeof v === "function" ? (v as (p: T) => T)(valueRef.current) : v;
    valueRef.current = next;
    setStore({ key, value: next });
    try {
      if (isEmpty(next)) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* private window / blocked storage: not remembered */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [value, set];
}

/**
 * The rows each table of a screen shows after its Excel filters (`DataTable onView`), by a name of the screen's
 * choosing — so a screen's Excel / PDF sheets export what the person sees: `(views.docs ?? docs)`.
 */
export function useTableViews<K extends string>() {
  const [views, setViews] = useState<Partial<Record<K, any[] | null>>>({});
  const on = useCallback((k: K) => (rows: any[] | null) => setViews((p) => (p[k] === rows ? p : { ...p, [k]: rows })), []);
  return [views, on] as const;
}
