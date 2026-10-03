import { ReactNode } from "react";
import { FinancialAmount } from "@/components/FinancialAmount";
import { MetricHint, type MetricHintProps } from "@/components/ui/MetricHint";

type Tone = "success" | "destructive" | "warning" | "primary";

const TONES: Record<Tone, string> = {
  success: "text-success",
  destructive: "text-destructive",
  warning: "text-warning",
  primary: "text-primary",
};

interface MetricCardWithHintProps {
  label: string;
  value: number;
  currency?: boolean;
  icon: ReactNode;
  metricHint: MetricHintProps;
  tone?: Tone;
  footer?: ReactNode;
  active?: boolean;
  onClick?: () => void;
}

/** كارت مالي موحّد مع زر ℹ️ يشرح طريقة الحساب (يفتح بالضغط أو التمرير). */
export function MetricCardWithHint({ label, value, currency = true, icon, metricHint, tone = "primary", footer, active, onClick }: MetricCardWithHintProps) {
  return (
    <div
      className={`card-elevated p-5 flex flex-col items-center justify-center text-center ${onClick ? "cursor-pointer transition-shadow hover:ring-1 hover:ring-primary/40" : ""} ${active ? "ring-2 ring-primary" : ""}`}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick ? !!active : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="text-base font-semibold text-foreground flex items-center gap-1.5">
        <span className={`[&_svg]:w-5 [&_svg]:h-5 ${TONES[tone]}`}>{icon}</span>
        {label}
        <MetricHint {...metricHint} label={`شرح ${label}`} />
      </div>
      <FinancialAmount value={value} currency={currency} size="md" className={`mt-2 font-extrabold ${TONES[tone]}`} />
      {footer && <div className="mt-1 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}
