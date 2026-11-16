// «بحث في السيستم كله» (Ctrl+K, migration 0235, owner 2026-11-16): shapes the `global_search` hits for the palette —
// where each one opens, its group, and the order (exact number / code / name first).

export type SearchKind = "sale" | "purchase" | "sale_return" | "purchase_return" | "voucher" | "contact" | "product";

export type SearchHit = {
  kind: SearchKind; id: string; branch_id: string | null; branch: string | null;
  title: string; sub: string | null; amount: number | null; day: string | null; status: string | null;
};

export const KIND_LABEL: Record<SearchKind, string> = {
  sale: "فواتير بيع", purchase: "فواتير شراء", sale_return: "مرتجع بيع", purchase_return: "مرتجع شراء",
  voucher: "سندات", contact: "حسابات (عملاء وموردين)", product: "أصناف",
};

/** Where a hit opens. Accounts open the company file for admins, the branch file for everybody else. */
export function searchTarget(h: Pick<SearchHit, "kind" | "id" | "branch_id">, isAdmin: boolean): string | null {
  const b = h.branch_id;
  switch (h.kind) {
    case "sale": return b ? `/branch/${b}/sales/${h.id}` : null;
    case "purchase": return b ? `/branch/${b}/shipments/${h.id}` : null;
    case "sale_return": return b ? `/branch/${b}/sale-returns/${h.id}` : null;
    case "purchase_return": return b ? `/branch/${b}/purchase-returns/${h.id}` : null;
    case "voucher": return b ? `/branch/${b}/vouchers/${h.id}` : null;
    case "contact": return isAdmin || !b ? `/admin/contacts/${h.id}` : `/branch/${b}/contacts/${h.id}`;
    case "product": return b ? `/branch/${b}/inventory/${h.id}/movements` : null;
  }
}

const norm = (s: string | null | undefined) =>
  (s ?? "").trim().toLowerCase()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ");

/** A typed number / code that looks like a document ("IN05108", "5108", "RV-12") → documents first. */
export const looksLikeNumber = (q: string) => /\d/.test(q) && !/[؀-ۿ]{2,}/.test(q);

/** Exact hits («مطابق») on top, then groups: documents first for a number, accounts and items first for words. */
export function groupHits(hits: SearchHit[], q: string): { label: string; hits: SearchHit[] }[] {
  const nq = norm(q);
  const isExact = (h: SearchHit) => norm(h.title) === nq || norm(h.sub) === nq
    || (h.kind !== "contact" && h.kind !== "product" && norm(h.title).replace(/^[a-z-]+0*/, "") === nq.replace(/^0+/, ""));
  const literal = (h: SearchHit) => norm(h.title) === nq || norm(h.sub) === nq;
  // typed exactly as written (a code «1478») before a number found inside a document number («IN01478»)
  const exact = hits.filter(isExact).sort((a, b) => Number(literal(b)) - Number(literal(a)));
  const rest = hits.filter((h) => !isExact(h));
  const order: SearchKind[] = looksLikeNumber(q)
    ? ["sale", "purchase", "sale_return", "purchase_return", "voucher", "product", "contact"]
    : ["contact", "product", "sale", "purchase", "sale_return", "purchase_return", "voucher"];
  const out: { label: string; hits: SearchHit[] }[] = [];
  if (exact.length) out.push({ label: "مطابق", hits: exact });
  for (const k of order) {
    const g = rest.filter((h) => h.kind === k);
    if (g.length) out.push({ label: KIND_LABEL[k], hits: g });
  }
  return out;
}
