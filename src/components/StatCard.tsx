import { ReactNode } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

export function StatCard({
  label,
  value,
  icon,
  trend,
  hint,
  accent = "primary",
}: {
  label: string;
  value: string | number;
  icon: ReactNode;
  trend?: { positive: boolean; text: string };
  hint?: string;
  accent?: "primary" | "success" | "warning" | "destructive" | "secondary";
}) {
  const accents: Record<string, string> = {
    primary: "bg-primary/15 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    destructive: "bg-destructive/15 text-destructive",
    secondary: "bg-secondary/15 text-secondary",
  };
  return (
    <div className="card-elevated p-5">
      <div className="flex items-start justify-between mb-3">
        <span className="text-sm text-muted-foreground font-medium">{label}</span>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accents[accent]}`}>
          {icon}
        </div>
      </div>
      <div className="text-2xl md:text-3xl font-extrabold mb-1">{value}</div>
      {trend && (
        <div className={`flex items-center gap-1 text-xs font-medium ${trend.positive ? "text-success" : "text-destructive"}`}>
          {trend.positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {trend.text}
        </div>
      )}
      {hint && !trend && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
