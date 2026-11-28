/**
 * The handles are NOT portalled straight into the <th>: React rewrites a text-only title by setting the cell's text, which
 * drops any foreign child, and unmounting the portal afterwards threw «removeChild» — a white page (owner 2026-11-12).
 * Each cell gets a holder element we own (`display: contents`, so the handles still position against the cell); the
 * portals live in the holder, and the holder is put back whenever the cell lost it.
 */
const holders = new WeakMap<HTMLElement, HTMLSpanElement>();
export function holderOf(cell: HTMLElement, attr = "data-cr-holder"): HTMLSpanElement {
  let h = holders.get(cell);
  if (!h) {
    h = document.createElement("span");
    h.setAttribute(attr, ""); h.setAttribute("data-xf-ignore", ""); h.setAttribute("data-xf-ui", "");   // never part of a title or cell text h.setAttribute("data-no-print", "");
    h.style.display = "contents";
    holders.set(cell, h);
  }
  if (h.parentNode !== cell) cell.appendChild(h);
  return h;
}

/** a column's name from its title cell, without our own handles / menus / tags (they live in `[data-xf-ui]` holders) —
 * widths, hidden columns and column permissions are all keyed by it, so it must not change when a handle is added */
export function headLabel(th: HTMLElement): string {
  const own = th.querySelector("[data-perm-label]");
  const clone = (own ?? th).cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-xf-ui]").forEach((n) => n.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}
