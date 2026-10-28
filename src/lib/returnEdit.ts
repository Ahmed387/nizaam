// «تعديل المرتجع» (migration 0131): the edit screen is the new-return screen opened with ?edit=<return id>.
// The server cancels the old return and records the new one on the old day (edit_sale_return / edit_purchase_return),
// so on screen the old return's quantities count as still available and are pre-filled.

export interface ReturnLineLike {
  product_id: string;
  /** quantity on the source invoice line (sold / received) */
  doc_qty: number;
  /** already returned on this invoice by active returns — INCLUDING the return being edited */
  already_returned: number;
  /** pieces in stock now (purchase returns only; a sale return puts pieces back, it never needs stock) */
  stock?: number;
}

export interface EditCaps {
  already_returned: number;
  max_qty: number;
  quantity: number;
}

/** Sum of the old return's quantities per product. */
export function oldQtyByProduct(items: Array<{ product_id: string | null; quantity: number | string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items ?? []) {
    if (!it.product_id) continue;
    out[it.product_id] = (out[it.product_id] ?? 0) + Number(it.quantity ?? 0);
  }
  return out;
}

/**
 * Caps of every line while editing: the old return no longer counts as «already returned», its pieces count as in
 * stock again (the cancel puts them back first), and its quantity is pre-filled. A product on two lines gets the old
 * quantity line by line, never twice.
 */
export function capsForEdit(lines: ReturnLineLike[], oldQty: Record<string, number>): EditCaps[] {
  const left: Record<string, number> = { ...oldQty };
  return lines.map((l) => {
    const old = oldQty[l.product_id] ?? 0;
    const already = Math.max(0, Number(l.already_returned ?? 0) - old);
    let max = Math.max(0, Number(l.doc_qty ?? 0) - already);
    if (l.stock !== undefined && l.stock !== null) max = Math.min(max, Math.max(0, Number(l.stock) + old));
    // old pieces of this product still to place on a line
    const remaining = left[l.product_id] ?? 0;
    const quantity = Math.min(remaining, max);
    left[l.product_id] = remaining - quantity;
    return { already_returned: already, max_qty: max, quantity };
  });
}

export interface EditDiffRow {
  product_id: string;
  name: string;
  before: number;
  after: number;
}

/** What changes per product (for the «قبل / بعد» box). Products with no change are left out. */
export function editDiff(
  oldQty: Record<string, number>,
  newLines: Array<{ product_id: string; product_name: string; quantity: number }>,
  names: Record<string, string> = {},
): EditDiffRow[] {
  const after: Record<string, number> = {};
  const label: Record<string, string> = { ...names };
  for (const l of newLines) {
    after[l.product_id] = (after[l.product_id] ?? 0) + Number(l.quantity ?? 0);
    label[l.product_id] = label[l.product_id] ?? l.product_name;
  }
  const ids = Array.from(new Set([...Object.keys(oldQty), ...Object.keys(after)]));
  return ids
    .map((id) => ({ product_id: id, name: label[id] ?? "—", before: oldQty[id] ?? 0, after: after[id] ?? 0 }))
    .filter((r) => r.before !== r.after);
}

/** A return can be edited by the owner while it is active and dated 2026 or later (archive returns stay as they are). */
export function canEditReturn(ret: { status?: string | null; invoice_date?: string | null; created_at?: string | null; migration_batch_id?: string | null } | null | undefined, isOwner: boolean): boolean {
  if (!ret || !isOwner) return false;
  if ((ret.status ?? "active") !== "active") return false;
  if (ret.migration_batch_id) return false;
  const d = String(ret.invoice_date ?? ret.created_at ?? "");
  return d >= "2026-01-01";
}
