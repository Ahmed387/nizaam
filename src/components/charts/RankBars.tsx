import { cn } from "@/lib/utils";

export type RankBarItem = {
  name: string;
  value: number;
  /** Optional secondary line under the name (e.g. الكمية) */
  sub?: string;
};

type Tone = "primary" | "destructive" | "success" | "warning" | "accent" | "info";

const BAR_TONE: Record<Tone, string> = {
  primary: "bg-primary",
  destructive: "bg-destructive",
  success: "bg-success",
  warning: "bg-warning",
  accent: "bg-accent",
  info: "bg-info",
};
const TEXT_TONE: Record<Tone, string> = {
  primary: "text-primary",
  destructive: "text-destructive",
  success: "text-success",
  warning: "text-warning",
  accent: "text-accent",
  info: "text-info",
};

/**
 * RTL-friendly horizontal ranking bars.
 * Replaces recharts vertical BarCharts where Arabic labels used to overlap the bars.
 */
export function RankBars({
  items,
  tone = "primary",
  format = (v: number) => String(v),
  className,
  maxItems,
}: {
  items: RankBarItem[];
  tone?: Tone;
  format?: (v: number) => string;
  className?: string;
  maxItems?: number;
}) {
  const list = (maxItems ? items.slice(0, maxItems) : items).filter(Boolean);
  if (list.length === 0) return null;
  const max = Math.max(...list.map((i) => Math.abs(Number(i.value) || 0)), 1);

  return (
    <div className={cn("space-y-2.5", className)}>
      {list.map((it, i) => {
        const v = Number(it.value) || 0;
        const pct = Math.max(2, (Math.abs(v) / max) * 100);
        return (
          <div key={`${it.name}-${i}`} className="group">
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-5 h-5 shrink-0 rounded-md bg-muted text-[10px] font-bold flex items-center justify-center text-muted-foreground">
                  {i + 1}
                </span>
                <span className="text-[13px] font-semibold truncate" title={it.name}>
                  {it.name}
                </span>
                {it.sub && <span className="text-[11px] text-muted-foreground shrink-0">{it.sub}</span>}
              </div>
              <span className={cn("text-[13px] font-bold tabular-nums shrink-0", TEXT_TONE[tone])} dir="ltr">
                {format(v)}
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-500", BAR_TONE[tone])}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** RTL-friendly share breakdown (replacement for cluttered pie charts). */
export function ShareBreakdown({
  items,
  format = (v: number) => String(v),
  className,
}: {
  items: { name: string; value: number }[];
  format?: (v: number) => string;
  className?: string;
}) {
  const list = items.filter((i) => Number(i.value) !== 0);
  const total = list.reduce((s, i) => s + Math.abs(Number(i.value) || 0), 0);
  if (list.length === 0 || total === 0) return null;

  const PALETTE = ["bg-primary", "bg-success", "bg-warning", "bg-destructive", "bg-info", "bg-accent"];

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex h-3 w-full rounded-full overflow-hidden bg-muted gap-0.5">
        {list.map((it, i) => (
          <div
            key={`${it.name}-${i}`}
            className={PALETTE[i % PALETTE.length]}
            style={{ width: `${(Math.abs(Number(it.value)) / total) * 100}%` }}
            title={`${it.name} — ${format(Number(it.value))}`}
          />
        ))}
      </div>
      <div className="space-y-1.5">
        {list.map((it, i) => {
          const pct = (Math.abs(Number(it.value)) / total) * 100;
          return (
            <div key={`${it.name}-row-${i}`} className="flex items-center justify-between gap-3 text-[13px]">
              <div className="flex items-center gap-2 min-w-0">
                <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", PALETTE[i % PALETTE.length])} />
                <span className="font-medium truncate" title={it.name}>{it.name}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-muted-foreground text-[11px] tabular-nums">{pct.toFixed(1)}%</span>
                <span className="font-bold tabular-nums" dir="ltr">{format(Number(it.value))}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
