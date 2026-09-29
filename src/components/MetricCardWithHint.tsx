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
  icon: ReactNode;
  metricHint: MetricHintProps;
  tone?: Tone;
  footer?: ReactNode;
}

/** كارت مالي موحّد مع زر ℹ️ يشرح طريقة الحساب (يفتح بالضغط أو التمرير). */
export function MetricCardWithHint({ label, value, icon, metricHint, tone = "primary", footer }: MetricCardWithHintProps) {
  return (
    <div className="card-elevated p-5 flex flex-col items-center justify-center text-center">
      <div className="text-base font-semibold text-foreground flex items-center gap-1.5">
        <span className={`[&_svg]:w-5 [&_svg]:h-5 ${TONES[tone]}`}>{icon}</span>
        {label}
        <MetricHint {...metricHint} label={`شرح ${label}`} />
      </div>
      <FinancialAmount value={value} size="md" className={`mt-2 font-extrabold ${TONES[tone]}`} />
      {footer && <div className="mt-1 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}
