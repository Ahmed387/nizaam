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
