import { useSyncExternalStore } from "react";

/** Documents opened together («فتح الكل») shown as tabs above every page of this browser tab. */
export type OpenDoc = { path: string; label: string };

const KEY = "nizam.openDocs";
const MAX = 30;
const subs = new Set<() => void>();

function read(): OpenDoc[] {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
let docs: OpenDoc[] = read();

function commit(next: OpenDoc[]) {
  docs = next;
  try { sessionStorage.setItem(KEY, JSON.stringify(docs)); } catch { /* private mode: tabs live in memory */ }
  subs.forEach((f) => f());
}

export function openDocs(list: OpenDoc[]) {
  const seen = new Set(docs.map((d) => d.path));
  commit([...docs, ...list.filter((d) => !seen.has(d.path) && (seen.add(d.path), true))].slice(-MAX));
}
export const closeDoc = (path: string) => commit(docs.filter((d) => d.path !== path));
export const closeAllDocs = () => commit([]);
export const OPEN_DOCS_MAX = MAX;

export function useOpenDocs(): OpenDoc[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => docs);
}
