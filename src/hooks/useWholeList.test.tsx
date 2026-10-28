import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readAll, readAllBounded, TooManyRows, useWholeList } from "./useWholeList";

/** a fake PostgREST query: answers range(from, to) of `total` rows, remembers the offsets asked */
function fakeQuery(total: number, asked: number[]) {
  return () => {
    let from = 0, to = 0;
    const q: any = {
      range(a: number, b: number) { from = a; to = b; return q; },
      abortSignal() { return q; },
      then(res: (v: unknown) => void) {
        asked.push(from);
        const n = Math.max(0, Math.min(to - from + 1, total - from));
        return Promise.resolve({ data: Array.from({ length: n }, (_, i) => ({ id: from + i })), error: null }).then(res);
      },
    };
    return q;
  };
}

describe("reading a whole list", () => {
  it("every row, 1,000 at a time, each page from a fresh query (the old export stopped at 1,000)", async () => {
    const asked: number[] = [];
    const rows = await readAll(fakeQuery(2_345, asked));
    expect(rows).toHaveLength(2_345);
    expect(asked).toEqual([0, 1000, 2000]);
    expect(new Set(rows.map((r: any) => r.id)).size).toBe(2_345);
  });
  it("a list longer than the screen keeps says so instead of loading", async () => {
    const count = () => ({ abortSignal() { return this; }, then: (res: (v: unknown) => void) => Promise.resolve({ count: 43_000, error: null }).then(res) });
    await expect(readAllBounded(fakeQuery(43_000, []), count, 10_000)).rejects.toBeInstanceOf(TooManyRows);
  });
  it("keeps the list of the same filters, re-reads in place on refresh, says «too many»", async () => {
    let reads = 0;
    const { result, rerender } = renderHook(({ sig, many }) => useWholeList(sig, async () => {
      reads += 1;
      if (many) throw new TooManyRows(20_000, 10_000);
      return [{ id: sig }];
    }, { auto: true }), { initialProps: { sig: "a", many: false } });
    await waitFor(() => expect(result.current.rows).toEqual([{ id: "a" }]));
    act(() => result.current.refresh());
    // the old list stays on screen while the new one comes
    expect(result.current.rows).toEqual([{ id: "a" }]);
    await waitFor(() => expect(reads).toBe(2));
    rerender({ sig: "b", many: true });
    await waitFor(() => expect(result.current.tooMany?.count).toBe(20_000));
    expect(result.current.rows).toBeNull();
  });
});
