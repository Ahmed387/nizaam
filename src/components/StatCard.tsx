import { forwardRef, ReactNode } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { FinancialAmount } from "@/components/FinancialAmount";
import { MetricHint, type MetricHintProps } from "@/components/ui/MetricHint";
import { AutoPart } from "@/contexts/PermCustomize";

type Accent = "primary" | "success" | "warning" | "destructive" | "secondary";

const ACCENTS: Record<Accent, { bg: string; border: string; chip: string; value: string; label: string }> = {
  primary: {
    bg: "bg-primary/5",
    border: "border-primary/25",
    chip: "bg-primary/15 text-primary",
    value: "text-primary",
    label: "text-primary/80",
  },
  success: {
    bg: "bg-success/5",
    border: "border-success/25",
    chip: "bg-success/15 text-success",
    value: "text-success",
    label: "text-success/80",
  },
  warning: {
    bg: "bg-warning/5",
    border: "border-warning/30",
    chip: "bg-warning/15 text-warning",
    value: "text-warning",
    label: "text-warning/80",
  },
  destructive: {
    bg: "bg-destructive/5",
    border: "border-destructive/25",
    chip: "bg-destructive/15 text-destructive",
    value: "text-destructive",
    label: "text-destructive/80",
  },
  secondary: {
    bg: "bg-secondary/10",
    border: "border-secondary/30",
    chip: "bg-secondary/20 text-secondary-foreground",
    value: "text-foreground",
    label: "text-muted-foreground",
  },
};

interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  icon: ReactNode;
  trend?: { positive: boolean; text: string };
  hint?: string;
  metricHint?: MetricHintProps;
  accent?: Accent;
}

export const StatCard = forwardRef<HTMLDivElement, StatCardProps>(function StatCard(props, ref) {
  return <AutoPart prefix="card" label={props.label}><StatCardInner {...props} ref={ref} /></AutoPart>;
});

const StatCardInner = forwardRef<HTMLDivElement, StatCardProps>(function StatCardInner(
  { label, value, icon, trend, hint, metricHint, accent = "primary", className, ...rest },
  ref
) {
  const a = ACCENTS[accent];
  const isCurrency = typeof value === "string" && /ج\.م\s*$/u.test(value);
  return (
    <div
      ref={ref}
      {...rest}
      data-stat-card
      className={`stat-shell rounded-2xl p-4 md:p-5 h-full border ${a.border} ${a.bg} flex flex-col items-center justify-center text-center transition-shadow hover:shadow-md ${className ?? ""}`}
    >
      <div className="flex items-center justify-center gap-2 mb-3 w-full max-w-full min-w-0">
        <span className={`text-sm font-semibold break-words ${a.label}`}>{label}</span>
        {metricHint && <MetricHint {...metricHint} label={`شرح ${label}`} />}
        <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${a.chip} [&_svg]:w-3.5 [&_svg]:h-3.5`}>
          {icon}
        </div>
      </div>
      <div className={`stat-value w-full min-w-0 max-w-full ${a.value}`}>
        {isCurrency ? (
          <FinancialAmount value={String(value)} size="lg" className="w-full font-extrabold" />
        ) : (
          <span className="block max-w-full break-words text-xl sm:text-2xl lg:text-xl xl:text-2xl 2xl:text-3xl font-extrabold" title={String(value)}>
            {value}
          </span>
        )}
      </div>

      {trend && (
        <div
          className={`mt-2 flex items-center justify-center gap-1 text-xs font-bold ${trend.positive ? "text-success" : "text-destructive"}`}
        >
          {trend.positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {trend.text}
        </div>
      )}
      {hint && !trend && <div className="mt-2 text-xs text-muted-foreground font-medium">{hint}</div>}
    </div>
  );
});
