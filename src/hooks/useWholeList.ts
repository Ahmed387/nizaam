import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** the list is longer than the screen keeps in memory: the person narrows the period (or other filters) first */
export class TooManyRows extends Error {
  constructor(public count: number, public max: number) {
    super(`القائمة فيها ${count.toLocaleString("en-US")} صف — فلاتر الأعمدة بتشتغل على ${max.toLocaleString("en-US")} صف بالكتير. ضيّق الفترة أو الفلاتر اللي فوق الأول.`);
    this.name = "TooManyRows";
  }
}

const isAbort = (e: unknown) => {
  const x = e as { name?: string; message?: string } | null;
  return x?.name === "AbortError" || /abort/i.test(x?.message ?? "");
};

/**
 * The WHOLE list behind a paged table (Excel filters, owner 2026-10-26): read on demand — when a column filter /
 * sort is on, a column menu opens, or an export runs — and kept until `sig` (the database filters it was read under)
 * changes. `refresh()` re-reads it in place: the old list stays on screen until the new one arrives, so the table
 * never blinks. A read that is replaced is aborted.
 *
 * `read` must return every row the screen's database filters leave (read 1,000 rows at a time with a FRESH query
 * object each time — `readAll`), already enriched like the page shows it.
 */
export function useWholeList<T>(sig: string, read: (signal: AbortSignal) => Promise<T[]>, opts: { auto?: boolean; errorText?: string } = {}) {
  const [tick, setTick] = useState(0);
  const full = `${sig}|${tick}`;
  const [store, setStore] = useState<{ sig: string; rows: T[] } | null>(null);
  const [tooMany, setTooMany] = useState<{ sig: string; error: TooManyRows } | null>(null);
  const req = useRef<{ full: string; p: Promise<T[]>; ctrl: AbortController } | null>(null);
  const readRef = useRef(read);
  readRef.current = read;

  const ensure = useCallback((): Promise<T[]> => {
    if (req.current?.full === full) return req.current.p;
    req.current?.ctrl.abort();
    const ctrl = new AbortController();
    const p = readRef.current(ctrl.signal);
    req.current = { full, p, ctrl };
    p.then(
      (rows) => { if (req.current?.full === full && !ctrl.signal.aborted) { setStore({ sig, rows }); setTooMany(null); } },
      (e) => {
        if (req.current?.full !== full) return;
        req.current = null;
        if (e instanceof TooManyRows) setTooMany({ sig, error: e });
        else if (!isAbort(e)) toast.error((e as { message?: string })?.message ?? opts.errorText ?? "تعذر تحميل القائمة كلها");
      },
    );
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, sig]);

  useEffect(() => {
    if (opts.auto) ensure().catch(() => {});
  }, [opts.auto, ensure]);
  useEffect(() => () => req.current?.ctrl.abort(), []);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return {
    rows: store && store.sig === sig ? store.rows : null,
    ensure,
    refresh,
    /** the list of these filters is too long to keep: say so instead of waiting */
    tooMany: tooMany && tooMany.sig === sig ? tooMany.error : null,
  };
}

/**
 * Like `readAll`, but first counts the rows (`count()` = the same filters with `{ count: "exact", head: true }`) and
 * refuses a list longer than `max` (TooManyRows) — for logs with tens of thousands of rows a month.
 */
export async function readAllBounded<T = any>(make: () => any, count: () => any, max: number, signal?: AbortSignal): Promise<T[]> {
  let c = count();
  if (signal) c = c.abortSignal(signal);
  const { count: n, error } = await c;
  if (error) throw error;
  if ((n ?? 0) > max) throw new TooManyRows(n ?? 0, max);
  return readAll<T>(make, signal);
}

/**
 * Every row of a query, 1,000 at a time, each page from a FRESH query object (`make()`): one shared PostgREST
 * builder re-used for every page reads the offset of the LAST page asked (pages start together), which stopped the
 * documents export at 1,000 rows. `make` must order by a unique key (e.g. «…, id»).
 */
export async function readAll<T = any>(make: () => any, signal?: AbortSignal, pageSize = 1000, maxRows = 200_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    let q = make().range(from, from + pageSize - 1);
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return out;
}
