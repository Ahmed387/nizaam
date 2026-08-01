import { AttributePicker } from "@/components/AttributePicker";
import { ColorPicker } from "@/components/ColorPicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VariantAttrs, VARIANT_LABELS, variantParts } from "@/lib/productVariant";
import { VariantChips } from "@/components/VariantChips";
import { cn } from "@/lib/utils";
import { Tags, Hash, Palette, Boxes, Gauge, Ruler, CheckCircle2, Sparkles } from "lucide-react";

type Key = keyof VariantAttrs;

const FIELD_ICONS: Record<Key, React.ElementType> = {
  brand: Tags,
  model: Hash,
  color: Palette,
  product_type: Boxes,
  capacity: Gauge,
  size: Ruler,
};

const ORDER: Key[] = ["brand", "model", "color", "product_type", "capacity", "size"];

const HINTS: Partial<Record<Key, string>> = {
  brand: "توشيبا",
  model: "GR-EF40P",
  color: "اختر لون",
  product_type: "ثلاجة",
  capacity: "355 لتر",
  size: "كبير",
};

function FieldShell({
  fieldKey,
  filled,
  required,
  compact,
  children,
}: {
  fieldKey: Key;
  filled: boolean;
  required?: boolean;
  compact?: boolean;
  children: React.ReactNode;
}) {
  const Icon = FIELD_ICONS[fieldKey];
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-2.5 pt-2 pb-2.5 transition-colors",
        filled ? "border-primary/40 bg-primary/[0.04]" : "border-border",
        required && !filled && "border-destructive/50 bg-destructive/[0.04]"
      )}
    >
      <Label
        className={cn(
          "flex items-center gap-1.5 mb-1.5 font-semibold",
          compact ? "text-[11px]" : "text-xs",
          filled ? "text-primary" : "text-muted-foreground"
        )}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span>{VARIANT_LABELS[fieldKey]}</span>
        {required && <span className="text-destructive">*</span>}
        {filled && <CheckCircle2 className="w-3 h-3 mr-auto text-primary/70" />}
      </Label>
      {children}
    </div>
  );
}

/**
 * Unified, readable editor for the product variant attributes
 * (الماركة / الموديل / اللون / النوع / السعة / المقاس).
 *
 * Used everywhere the attributes are captured: إضافة منتج، تعديل منتج، بنود الشحنة.
 * Purely presentational — the parent keeps owning the state & validation.
 */
export function VariantAttributesFields({
  value,
  onChange,
  required = [],
  compact = false,
  title = "خصائص المنتج",
  subtitle = "الماركة والموديل بيميزوا الصنف عن أي صنف شبهه",
  showHeader = true,
  className,
}: {
  value: VariantAttrs;
  onChange: (patch: Partial<VariantAttrs>) => void;
  required?: Key[];
  compact?: boolean;
  title?: string;
  subtitle?: string;
  showHeader?: boolean;
  className?: string;
}) {
  const filledCount = variantParts(value).length;
  const isFilled = (k: Key) => String(value[k] ?? "").trim().length > 0;
  const isReq = (k: Key) => required.includes(k);

  return (
    <div className={cn("rounded-xl border border-border bg-surface-2/40 p-3 space-y-3", className)}>
      {showHeader && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-bold leading-tight">{title}</div>
              <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
            </div>
          </div>
          <span
            className={cn(
              "text-[11px] font-semibold px-2 py-0.5 rounded-full border",
              filledCount === 6
                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                : "bg-surface-2 text-muted-foreground border-border"
            )}
          >
            {filledCount} / 6 مكتملة
          </span>
        </div>
      )}

      <div className={cn("grid gap-2", compact ? "grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3")}>
        {ORDER.map((k) => (
          <FieldShell key={k} fieldKey={k} filled={isFilled(k)} required={isReq(k)} compact={compact}>
            {k === "model" ? (
              <Input
                value={String(value.model ?? "")}
                onChange={(e) => onChange({ model: e.target.value })}
                placeholder={HINTS.model}
                className="h-9 font-mono text-sm tracking-wide bg-background"
              />
            ) : k === "color" ? (
              <ColorPicker
                value={String(value.color ?? "")}
                onChange={(v) => onChange({ color: v ?? "" })}
                placeholder={HINTS.color}
              />
            ) : (
              <AttributePicker
                table={k === "brand" ? "brands" : k === "product_type" ? "product_types" : k === "capacity" ? "capacities" : "sizes"}
                value={String(value[k] ?? "")}
                onChange={(v) => onChange({ [k]: v ?? "" } as Partial<VariantAttrs>)}
                placeholder={HINTS[k]}
              />
            )}
          </FieldShell>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap border-t border-border/60 pt-2">
        <span className="text-[11px] font-semibold text-muted-foreground">المعاينة:</span>
        {filledCount ? (
          <VariantChips attrs={value} />
        ) : (
          <span className="text-[11px] text-muted-foreground">لسه مفيش خصائص متسجلة</span>
        )}
      </div>
    </div>
  );
}
