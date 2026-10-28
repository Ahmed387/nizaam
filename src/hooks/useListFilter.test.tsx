import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useListFilter, useRemembered, useRememberedFilter } from "./useListFilter";
import { EMPTY_STATE, type FilterState, type ListColumn } from "@/lib/tableFilter";

type Row = { id: string; customer: string | null; total: number; day: string };
// 120 sales over 3 pages of 50: the filters must cover all of them, not the page on screen
const rows: Row[] = Array.from({ length: 120 }, (_, i) => ({
  id: `r${i}`,
  customer: i % 3 === 0 ? "اسامة" : i % 3 === 1 ? "جارحي" : null,
  total: (i + 1) * 100,
  day: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
}));
const columns: ListColumn<Row>[] = [
  { key: "customer", label: "العميل", kind: "text", get: (r) => r.customer },
  { key: "total", label: "المبلغ", kind: "number", get: (r) => r.total, sum: true, money: true },
  { key: "day", label: "التاريخ", kind: "date", get: (r) => r.day },
];

function setup(initial: FilterState = EMPTY_STATE, extra: ((r: Row) => boolean) | null = null, list: Row[] | null = rows) {
  let state = initial;
  const hook = renderHook(({ s, e, l }) => useListFilter({ rows: l, columns, state: s, onChange: (n) => { state = n; }, ensureRows: async () => rows, extra: e }), {
    initialProps: { s: initial, e: extra, l: list },
  });
  return { hook, get state() { return state; } };
}

describe("Excel filters on the whole list (data mode)", () => {
  it("filters, sorts and totals every row, not one page", () => {
    const { hook } = setup({ filters: { customer: { kind: "values", values: ["اسامة"] }, total: { kind: "number", op: "gt", a: 6000 } }, sort: { col: "total", dir: "desc" } });
    const res = hook.result.current.result!;
    // اسامة = every 3rd row; total > 6,000 = rows 60.. → 60, 63, … 117 = 20 rows
    expect(res.rows).toHaveLength(20);
    expect(res.rows[0].total).toBe(11800);
    expect(res.rows.at(-1)!.total).toBe(6100);
    expect(res.totals.total).toBe(res.rows.reduce((s, r) => s + r.total, 0));
    expect(hook.result.current.adapter.shown).toBe(20);
    expect(hook.result.current.adapter.total).toBe(120);
  });

  it("each list shows what the other filters leave, with counts; blanks are a value", async () => {
    const { hook } = setup({ filters: { total: { kind: "number", op: "lte", a: 900 } }, sort: null });
    const f = await hook.result.current.adapter.facets("customer", hook.result.current.state);
    expect(f.map((x) => [x.label, x.count])).toEqual([["اسامة", 3], ["جارحي", 3], ["(فاضي)", 3]]);
  });

  it("another filter of the screen (a clicked card) narrows rows and lists, not what the cards add up", async () => {
    const big = (r: Row) => r.total > 11000;
    const { hook } = setup(EMPTY_STATE, big);
    const res = hook.result.current.result!;
    expect(res.rows).toHaveLength(10);
    expect(res.colRows).toHaveLength(120);
    const f = await hook.result.current.adapter.facets("customer", EMPTY_STATE);
    expect(f.reduce((s, x) => s + x.count, 0)).toBe(10);
  });

  it("a menu opened before the list arrived reads it", async () => {
    const { hook } = setup(EMPTY_STATE, null, null);
    expect(hook.result.current.result).toBeNull();
    const f = await hook.result.current.adapter.facets("day", EMPTY_STATE);
    expect(f).toHaveLength(28);
    // and a list read for an export gets the same filters
    expect(hook.result.current.apply(rows)).toHaveLength(120);
  });

  it("a filter on a column the view doesn't have waits", () => {
    const { hook } = setup({ filters: { gone: { kind: "values", values: ["x"] } }, sort: null });
    expect(hook.result.current.result!.rows).toHaveLength(120);
    expect(hook.result.current.state.filters).toEqual({});
  });
});

describe("remembered on this device («زي ما سبتها»)", () => {
  beforeEach(() => window.localStorage.clear());

  it("each key (tab) keeps its own filters", () => {
    const { result, rerender } = renderHook(({ k }) => useRememberedFilter(k), { initialProps: { k: "xf:v1:/x:sale" } });
    const s: FilterState = { filters: { total: { kind: "number", op: "gt", a: 5 } }, sort: null };
    act(() => result.current[1](s));
    expect(JSON.parse(window.localStorage.getItem("xf:v1:/x:sale")!)).toEqual(s);
    rerender({ k: "xf:v1:/x:purchase" });
    expect(result.current[0]).toEqual(EMPTY_STATE);
    rerender({ k: "xf:v1:/x:sale" });
    expect(result.current[0]).toEqual(s);
    act(() => result.current[1](EMPTY_STATE));
    expect(window.localStorage.getItem("xf:v1:/x:sale")).toBeNull();
  });

  it("a screen's starting filters when nothing is remembered (main till: the last 30 days)", () => {
    const start = (): FilterState => ({ filters: { d: { kind: "date", from: "2026-09-29", to: "2026-10-28" } }, sort: null });
    const { result, unmount } = renderHook(() => useRememberedFilter("xf:v1:/main:normal", start));
    expect(result.current[0]).toEqual(start());
    // not written until the person changes something
    expect(window.localStorage.getItem("xf:v1:/main:normal")).toBeNull();
    // cleared: everything for now; the next visit starts from the 30 days again
    act(() => result.current[1](EMPTY_STATE));
    expect(result.current[0]).toEqual(EMPTY_STATE);
    unmount();
    expect(renderHook(() => useRememberedFilter("xf:v1:/main:normal", start)).result.current[0]).toEqual(start());
    // what he left is what he finds
    const left: FilterState = { filters: { d: { kind: "date", from: "2026-01-01" } }, sort: null };
    window.localStorage.setItem("xf:v1:/main:normal", JSON.stringify(left));
    expect(renderHook(() => useRememberedFilter("xf:v1:/main:normal", start)).result.current[0]).toEqual(left);
  });

  it("a small value: functional updates, empty removes it, bad storage is ignored", () => {
    window.localStorage.setItem("k", "{not json");
    const read = (raw: unknown) => (raw && typeof raw === "object" && typeof (raw as any).q === "string" ? { q: (raw as any).q } : { q: "" });
    const { result } = renderHook(() => useRemembered("k", read, (v) => !v.q));
    expect(result.current[0]).toEqual({ q: "" });
    act(() => result.current[1]((p) => ({ q: p.q + "IN05" })));
    expect(result.current[0]).toEqual({ q: "IN05" });
    expect(JSON.parse(window.localStorage.getItem("k")!)).toEqual({ q: "IN05" });
    act(() => result.current[1]({ q: "" }));
    expect(window.localStorage.getItem("k")).toBeNull();
  });
});
