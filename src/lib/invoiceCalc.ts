/**
 * Unified invoice totals calculator.
 * Single source of truth for computing subtotal / discount / VAT / total / remaining
 * across NewSale, EditSaleInvoice, and any other invoice surface.
 *
 * Rounding: Math.round(x * 100) / 100 applied consistently at each stage,
 * so create-then-edit of the same invoice yields the exact same total (0.00 drift).
 *
 * Order of operations:
 *   1. gross         = Σ (qty * selling_price)
 *   2. lineDiscounts = Σ min(line_discount, qty * selling_price)   ← clamped per line
 *   3. subtotal      = gross - lineDiscounts
 *   4. invoiceDiscount = clamp( pct? subtotal*pct/100 : amount , 0, subtotal )
 *   5. netAfterDiscount = subtotal - invoiceDiscount
 *   6. taxAmount     = netAfterDiscount * taxRate / 100
 *   7. total         = netAfterDiscount + taxAmount
 *   8. remaining     = total - paid
 */

export type InvoiceCalcItem = {
  quantity: number | string | null | undefined;
  selling_price: number | string | null | undefined;
  line_discount?: number | string | null | undefined;
};

export type DiscountType = "amount" | "percent";

export const round2 = (n: number): number =>
  Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type InvoiceTotals = {
  /** Σ qty*price before any discount */
  grossSubtotal: number;
  /** Σ clamped line discounts */
  lineDiscounts: number;
  /** gross - lineDiscounts (matches server's `subtotal` convention) */
  subtotal: number;
  /** Invoice-level discount actually applied (after clamp) */
  invoiceDiscount: number;
  /** lineDiscounts + invoiceDiscount */
  discountAmount: number;
  /** subtotal - invoiceDiscount */
  netAfterDiscount: number;
  /** VAT / tax amount */
  taxAmount: number;
  /** Final total the customer owes */
  total: number;
  /** total - paid */
  remaining: number;
};

export function computeInvoiceTotals(
  items: InvoiceCalcItem[],
  discount: number = 0,
  discountType: DiscountType = "amount",
  taxRate: number = 0,
  paid: number = 0
): InvoiceTotals {
  let gross = 0;
  let lineDisc = 0;
  for (const it of items ?? []) {
    const qty = num(it.quantity);
    const price = num(it.selling_price);
    const lineGross = qty * price;
    gross += lineGross;
    lineDisc += Math.min(Math.max(num(it.line_discount), 0), Math.max(lineGross, 0));
  }
  const grossSubtotal = round2(gross);
  const lineDiscounts = round2(lineDisc);
  const subtotal = round2(Math.max(0, grossSubtotal - lineDiscounts));

  const rawInvDisc =
    discountType === "percent"
      ? (subtotal * num(discount)) / 100
      : num(discount);
  const invoiceDiscount = round2(Math.max(0, Math.min(subtotal, rawInvDisc)));

  const netAfterDiscount = round2(Math.max(0, subtotal - invoiceDiscount));
  const taxAmount = round2((netAfterDiscount * num(taxRate)) / 100);
  const total = round2(netAfterDiscount + taxAmount);
  const discountAmount = round2(lineDiscounts + invoiceDiscount);
  const remaining = round2(total - num(paid));

  return {
    grossSubtotal,
    lineDiscounts,
    subtotal,
    invoiceDiscount,
    discountAmount,
    netAfterDiscount,
    taxAmount,
    total,
    remaining,
  };
}
