import { forwardRef } from "react";
import { CheckCircle2, Clock, CircleDashed } from "lucide-react";
import { formatEGP } from "@/lib/format";

export type PayState = "paid" | "partial" | "unpaid";

export function computePayState(total: number, paid: number): PayState {
  if (total <= 0.01) return "unpaid";
  if (paid >= total - 0.01) return "paid";
  if (paid > 0.01) return "partial";
  return "unpaid";
}

/** Colored vertical ribbon shown on the right (RTL) side of invoice rows / cards. */
export const PaymentStatusRibbon = forwardRef<
  HTMLSpanElement,
  { state: PayState; className?: string } & React.HTMLAttributes<HTMLSpanElement>
>(function PaymentStatusRibbon({ state, className = "", ...rest }, ref) {
  const color =
    state === "paid" ? "bg-success" : state === "partial" ? "bg-warning" : "bg-muted-foreground/30";
  return (
    <span
      ref={ref}
      aria-hidden
      {...rest}
      className={`inline-block w-1.5 self-stretch rounded-full ${color} ${className}`}
    />
  );
});

/** Compact colored pill for payment status. */
export const PaymentStatusBadge = forwardRef<
  HTMLSpanElement,
  {
    state: PayState;
    total?: number;
    paid?: number;
    compact?: boolean;
  } & Omit<React.HTMLAttributes<HTMLSpanElement>, "children">
>(function PaymentStatusBadge({ state, total, paid, compact = false, className = "", ...rest }, ref) {
  const map = {
    paid: {
      label: "مدفوعة بالكامل",
      cls: "bg-success/15 text-success border-success/40",
      Icon: CheckCircle2,
    },
    partial: {
      label: "دفع جزئي",
      cls: "bg-warning/15 text-warning border-warning/40",
      Icon: Clock,
    },
    unpaid: {
      label: "غير مدفوعة",
      cls: "bg-muted text-muted-foreground border-border",
      Icon: CircleDashed,
    },
  } as const;
  const { label, cls, Icon } = map[state];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${cls}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {!compact && typeof total === "number" && typeof paid === "number" && state === "partial" && (
        <span className="opacity-80 font-semibold tabular-nums" dir="ltr">
          ({formatEGP(paid)} / {formatEGP(total)})
        </span>
      )}
    </span>
  );
}
