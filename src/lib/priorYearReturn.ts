/**
 * «مرتجع فاتورة قبل 2026» (migration 0145): the owner types the lines; this file adds them up and checks them before
 * `record_prior_year_return` runs. The difference price − cost goes to «أرباح السنين اللي فاتت», never to 2026 profit.
 */
export type PyrLine = { product_id: string | null; name: string; quantity: number; price: number; cost: number };

export function pyrTotals(lines: PyrLine[]) {
  const ok = lines.filter((l) => l.product_id && l.quantity > 0);
  const price = ok.reduce((s, l) => s + Math.round(l.quantity * l.price * 100) / 100, 0);
  const cost = ok.reduce((s, l) => s + Math.round(l.quantity * l.cost * 100) / 100, 0);
  return { price: Math.round(price * 100) / 100, cost: Math.round(cost * 100) / 100, priorYears: Math.round((price - cost) * 100) / 100, lines: ok.length };
}

/** The first problem with what was typed, or null. */
export function pyrProblem(lines: PyrLine[], mode: "refund" | "account" | null, contactId: string | null, date: string): string | null {
  if (!lines.some((l) => l.product_id && l.quantity > 0)) return "ضيف صنف واحد على الأقل";
  if (lines.some((l) => l.product_id && (l.quantity <= 0 || l.price < 0 || l.cost < 0))) return "الكمية والسعر والتكلفة لازم تكون أرقام صح";
  if (!date || date < "2026-01-01") return "تاريخ المرتجع نفسه لازم يكون 2026 أو بعده";
  if (!mode) return "اختار: الفلوس ترجع دلوقتي ولا تفضل على حسابه";
  if (mode === "account" && !contactId) return "«على حسابه» محتاج اسم العميل";
  return null;
}
