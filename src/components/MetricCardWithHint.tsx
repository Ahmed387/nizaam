import { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FinancialAmount } from "@/components/FinancialAmount";

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
  hint: ReactNode;
  tone?: Tone;
  footer?: ReactNode;
}

/** كارت مالي موحّد مع زر ℹ️ يشرح طريقة الحساب (يفتح بالضغط أو التمرير). */
export function MetricCardWithHint({ label, value, icon, hint, tone = "primary", footer }: MetricCardWithHintProps) {
  return (
    <div className="card-elevated p-5 flex flex-col items-center justify-center text-center">
      <div className="text-base font-semibold text-foreground flex items-center gap-1.5">
        <span className={`[&_svg]:w-5 [&_svg]:h-5 ${TONES[tone]}`}>{icon}</span>
        {label}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`طريقة حساب ${label}`}
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <Info className="w-4 h-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent dir="rtl" className="w-80 text-sm leading-6 text-right">
            <div className="font-bold mb-1">{label}</div>
            <div className="text-muted-foreground">{hint}</div>
          </PopoverContent>
        </Popover>
      </div>
      <FinancialAmount value={value} size="md" className={`mt-2 font-extrabold ${TONES[tone]}`} />
      {footer && <div className="mt-1 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}
