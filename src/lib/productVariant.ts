/**
 * Shared helpers for product variant attributes.
 *
 * A "variant" is the combination that makes two otherwise identical products
 * distinct in the warehouse, e.g.:
 *   ثلاجة توشيبا SSAF أحمر 355 لتر   vs   ثلاجة توشيبا SSAF رمادي 355 لتر
 *
 * These attributes live on `products` and are snapshotted onto every document
 * line (invoices, shipments, returns, quotes, transfers, adjustments, counts)
 * by the `set_item_color_from_product` database trigger, so historical
 * documents keep the attributes they had at the time they were issued.
 */

export interface VariantAttrs {
  brand?: string | null;
  model?: string | null;
  color?: string | null;
  product_type?: string | null;
  capacity?: string | null;
  size?: string | null;
}

export const VARIANT_LABELS: Record<keyof VariantAttrs, string> = {
  brand: "الماركة",
  model: "الموديل",
  color: "اللون",
  product_type: "النوع",
  capacity: "السعة",
  size: "المقاس",
};

/** Ordered non-empty attribute pairs, ready for rendering. */
export function variantParts(a?: VariantAttrs | null): { key: keyof VariantAttrs; label: string; value: string }[] {
  if (!a) return [];
  const order: (keyof VariantAttrs)[] = ["brand", "model", "color", "product_type", "capacity", "size"];
  return order
    .map((key) => ({ key, label: VARIANT_LABELS[key], value: String(a[key] ?? "").trim() }))
    .filter((p) => p.value.length > 0);
}

/** `توشيبا • GR-EF40P • أحمر • 355 لتر` — compact one-line summary. */
export function variantLabel(a?: VariantAttrs | null, sep = " • "): string {
  return variantParts(a).map((p) => p.value).join(sep);
}

/** Product name followed by its variant summary, for PDFs and printed docs. */
export function productFullLabel(name: string, a?: VariantAttrs | null): string {
  const v = variantLabel(a);
  return v ? `${name} (${v})` : name;
}

/** Extra tokens appended to search strings so users can find a variant by any attribute. */
export function variantSearchTokens(a?: VariantAttrs | null): string {
  return variantParts(a).map((p) => p.value).join(" ");
}

/** True when at least one variant attribute is filled in. */
export function hasVariantInfo(a?: VariantAttrs | null): boolean {
  return variantParts(a).length > 0;
}
