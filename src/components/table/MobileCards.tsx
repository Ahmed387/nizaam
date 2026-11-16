// Mobile card view of a wide table (owner 2026-11-16 «الجداول العريضة صعبة على الموبايل … كروت بدل جداول … متبوظش حاجة»).
// The SAME table is shown as cards below 768 px by CSS only (index.css, `table[data-mcard]`, inside `@layer mcard` so the
// column hiding of permissions / «الأعمدة» and the Excel filter's hidden rows keep winning). Here each cell only gets
// its column title as `data-label` (shown before the value on a card). Desktop is untouched: nothing here changes
// the layout above 768 px. Opt in per table: DataTable / PermTable `mobileCards`.
import { useEffect } from "react";

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Titles of the columns by position, from the last header row (colspan counted). */
export function columnTitles(table: HTMLTableElement): string[] {
  const head = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!head) return [];
  const out: string[] = [];
  for (const th of Array.from(head.cells)) {
    // the filter arrow / resize handle live inside the title cell — read only the title text
    const copy = th.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[data-xf-slot],[role=separator],button,input,svg").forEach((n) => n.remove());
    const t = clean(copy.textContent);
    for (let i = 0; i < Math.max(1, th.colSpan || 1); i++) out.push(t);
  }
  return out;
}

/** Puts each body / footer cell's column title in `data-label` (only when it changed). */
export function labelCells(table: HTMLTableElement): void {
  const titles = columnTitles(table);
  const bodies = [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])];
  for (const tb of bodies) {
    for (const tr of Array.from(tb.rows)) {
      let col = 0;
      for (const td of Array.from(tr.cells)) {
        const span = Math.max(1, td.colSpan || 1);
        const label = span > 1 ? "" : titles[col] ?? "";
        if (td.getAttribute("data-label") !== label) td.setAttribute("data-label", label);
        col += span;
      }
    }
  }
}

/** Keeps the labels right while rows / columns change (filters, paging, column order). */
export function useCardLabels(table: HTMLTableElement | null, enabled: boolean) {
  useEffect(() => {
    if (!table || !enabled) return;
    let raf = 0;
    const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => labelCells(table)); };
    labelCells(table);
    const mo = new MutationObserver((list) => {
      // our own data-label writes are attribute changes — only rows / cells / titles changing need a new pass
      if (list.some((m) => m.type === "childList" || m.type === "characterData")) run();
    });
    mo.observe(table, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, [table, enabled]);
}
