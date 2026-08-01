import { ColorChip } from "@/components/ColorPicker";
import { AttributeChip } from "@/components/AttributePicker";
import { VariantAttrs, variantParts } from "@/lib/productVariant";
import { cn } from "@/lib/utils";

/**
 * Renders the variant attributes of a product / document line as chips.
 * Shows nothing when the product has no attributes filled in (legacy data).
 */
export function VariantChips({
  attrs,
  className,
  showColorSwatch = true,
}: {
  attrs?: VariantAttrs | null;
  className?: string;
  showColorSwatch?: boolean;
}) {
  const parts = variantParts(attrs);
  if (parts.length === 0) return null;

  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
      {parts.map((p) => {
        if (p.key === "color" && showColorSwatch) return <ColorChip key={p.key} name={p.value} />;
        const tone =
          p.key === "brand" ? "primary"
          : p.key === "capacity" ? "success"
          : p.key === "size" ? "warning"
          : "neutral";
        return <AttributeChip key={p.key} label={p.label} value={p.value} tone={tone as any} />;
      })}
    </div>
  );
}

/** Inline plain-text variant summary, e.g. for table cells under the product name. */
export function VariantLine({ attrs, className }: { attrs?: VariantAttrs | null; className?: string }) {
  const parts = variantParts(attrs);
  if (parts.length === 0) return null;
  return (
    <span className={cn("text-[11px] text-muted-foreground", className)}>
      {parts.map((p) => p.value).join(" • ")}
    </span>
  );
}

/**
 * Compact product cell for dense tables: name on top, attributes underneath as a
 * quiet label/value list that wraps instead of stacking colourful chips.
 */
export function ProductCell({
  name,
  attrs,
  sub,
  className,
}: {
  name: React.ReactNode;
  attrs?: VariantAttrs | null;
  sub?: React.ReactNode;
  className?: string;
}) {
  const parts = variantParts(attrs);
  return (
    <div className={cn("text-right leading-snug", className)}>
      <div
        dir="auto"
        className="font-semibold text-foreground whitespace-normal [overflow-wrap:normal] [word-break:normal] [unicode-bidi:plaintext]"
      >
        {name}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      {parts.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
          {parts.map((p) => (
            <span key={p.key} className="text-[11px] text-muted-foreground whitespace-nowrap">
              <span className="opacity-60">{p.label}:</span>{" "}
              <span className="text-foreground/80 font-medium">{p.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

