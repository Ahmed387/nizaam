// «استبعاد الصفر» (owner 2026-11-15): a checkbox on the customers / suppliers lists and the inventory lists that hides
// accounts whose balance is zero and items whose quantity is zero. ON by default, remembered per page on the device
// until the owner unticks it. Excel / print follow what is on screen. Pure helpers here, tested in hideZero.test.ts.
import { useState } from "react";

const KEY = (page: string) => `hz:v1:${page}`;
const isZero = (v: unknown) => Math.abs(Number(v) || 0) <= 0.005;

/** Remembered checkbox, default true. */
export function useHideZero(page: string): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY(page)) !== "0"; } catch { return true; }
  });
  const set = (v: boolean) => {
    setOn(v);
    try { localStorage.setItem(KEY(page), v ? "1" : "0"); } catch { /* private mode */ }
  };
  return [on, set];
}

/**
 * Balance chips sent to `contacts_page` (OR-ed on the server). With the box on and no chip chosen = مدين + دائن (no zero).
 * A chip the owner picks himself wins: «صفر» chosen = he asked to see the zeros.
 */
export function balanceFiltersFor<T extends string>(chips: T[], hide: boolean): T[] {
  if (!hide || chips.length > 0) return chips;
  return ["debit", "credit"] as T[];
}

/** Rows filtered in the page: an account whose net balance is zero / an item whose quantity is zero is left out. */
export function dropZero<R>(rows: R[], hide: boolean, value: (r: R) => unknown, explicitZero = false): R[] {
  if (!hide || explicitZero) return rows;
  return rows.filter((r) => !isZero(value(r)));
}
