import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatEGP } from "@/lib/format";
import { feeHint, feeOf, type FeeMode } from "@/lib/paymentFee";

/**
 * «العمولة» of one payment (0286, owner 2026-11-25): whoever does the operation types it — none / fixed / percent of the
 * amount — and the line under it says exactly where it goes. Never shown for cash.
 */
export function FeeField({
  method, amount, mode, value, onChange, direction, vesselLabel, party,
  onCustomer, onCustomerChange, disabled, compact,
}: {
  method: string;
  amount: number;
  mode: FeeMode | undefined;
  value: string | undefined;
  onChange: (mode: FeeMode, value: string) => void;
  direction: "in" | "out" | "both" | "none";
  vesselLabel: string;
  party?: string;
  /** shown only when the other side may carry the fee (sale, receipt) */
  onCustomer?: boolean;
  onCustomerChange?: (v: boolean) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  if (!method || method === "cash") return null;
  const m: FeeMode = mode ?? "none";
  const fee = feeOf(method, amount, m, value);
  return (
    <div className={`rounded-md border border-warning/30 bg-warning/5 ${compact ? "p-2 text-xs" : "p-2.5 text-sm"} space-y-2`} data-testid="fee-box">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">العمولة:</span>
        {([["none", "مفيش"], ["fixed", "رقم ثابت"], ["percent", "نسبة %"]] as [FeeMode, string][]).map(([k, l]) => (
          <button key={k} type="button" disabled={disabled} aria-pressed={m === k}
            onClick={() => onChange(k, k === "none" ? "" : value ?? "")}
            className={`text-xs px-3 py-1.5 rounded-full border ${m === k ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
            {l}
          </button>
        ))}
        {m !== "none" && (
          <Input type="number" min={0} step="0.01" disabled={disabled} aria-label={m === "percent" ? "نسبة العمولة" : "مبلغ العمولة"}
            className="h-8 w-28" value={value ?? ""} placeholder={m === "percent" ? "مثلاً 1" : "مثلاً 15"}
            onChange={(e) => onChange(m, e.target.value)} />
        )}
        {m === "percent" && fee > 0 && <span className="text-xs text-muted-foreground">= {formatEGP(fee)}</span>}
      </div>
      {onCustomerChange && fee > 0 && (
        <div>
          <Label className="text-xs mb-1.5 block">مين يتحمل العمولة؟</Label>
          <div className="flex gap-2">
            <button type="button" disabled={disabled} onClick={() => onCustomerChange(true)}
              className={`text-xs px-3 py-1.5 rounded border flex-1 ${onCustomer ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
              العميل (تتضاف على المبلغ)
            </button>
            <button type="button" disabled={disabled} onClick={() => onCustomerChange(false)}
              className={`text-xs px-3 py-1.5 rounded border flex-1 ${!onCustomer ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
              الشركة (مصروف)
            </button>
          </div>
        </div>
      )}
      <p className="text-xs leading-6 text-muted-foreground" data-testid="fee-hint">
        💡 {feeHint({ fee, amount, vessel: vesselLabel, direction, onCustomer: !!onCustomerChange && !!onCustomer, party })}
      </p>
    </div>
  );
}
