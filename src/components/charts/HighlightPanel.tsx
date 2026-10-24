import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { PermCard } from "@/contexts/PermCustomize";
import { cn } from "@/lib/utils";

type Tone = "primary" | "accent" | "success" | "destructive" | "info";

const TILE: Record<Tone, string> = {
  primary: "bg-primary text-primary-foreground",
  accent: "bg-accent text-accent-foreground",
  success: "bg-success text-success-foreground",
  destructive: "bg-destructive text-destructive-foreground",
  info: "bg-secondary text-secondary-foreground",
};

const SEG: Record<Tone, string> = {
  primary: "bg-primary",
  accent: "bg-accent",
  success: "bg-success",
  destructive: "bg-destructive",
  info: "bg-secondary",
};

export type HighlightTile = {
  label: string;
  value: string;
  tone: Tone;
  /** true = سهم لأعلى، false = سهم لأسفل، undefined = بدون سهم */
  up?: boolean;
};

export type StackedBar = {
  label: string;
  segments: { name: string; value: number; tone: Tone }[];
};

/** كروت أرقام كبيرة (Highlights) — نفس روح الشكل المطلوب */
export function HighlightTiles({ tiles, className }: { tiles: HighlightTile[]; className?: string }) {
  if (tiles.length === 0) return null;
  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4", className)}>
      {tiles.map((t, i) => (
        <PermCard key={`${t.label}-${i}`} label={String(t.label)}><div
          className={cn("rounded-2xl p-5 min-h-[140px] flex flex-col gap-3 overflow-hidden", TILE[t.tone])}
        >
          {/* الأيقونة في دايرة لوحدها فوق — مش فوق الأرقام */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-extrabold opacity-95 min-w-0 truncate">{t.label}</span>
            {t.up !== undefined && (
              <span className="shrink-0 w-9 h-9 rounded-full bg-background/20 flex items-center justify-center">
                {t.up ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
              </span>
            )}
          </div>
          <div className="mt-auto text-3xl md:text-4xl font-extrabold tabular-nums leading-tight" dir="rtl">
            {t.value}
          </div>
        </div></PermCard>
      ))}
    </div>
  );
}

/** أعمدة مجمّعة (Stacked) بمحور أرقام على الشمال — بديل الرسم القديم */
export function StackedBars({
  bars,
  format = (v: number) => String(v),
  height = 260,
  className,
}: {
  bars: StackedBar[];
  format?: (v: number) => string;
  height?: number;
  className?: string;
}) {
  const totals = bars.map((b) => b.segments.reduce((s, g) => s + Math.max(0, g.value), 0));
  const max = Math.max(...totals, 1);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const legend = bars[0]?.segments.map((s) => ({ name: s.name, tone: s.tone })) ?? [];

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-end gap-4 text-sm font-bold text-foreground mb-4 flex-wrap">
        {legend.map((l) => (
          <span key={l.name} className="flex items-center gap-1.5">
            <span className={cn("w-3.5 h-3.5 rounded-sm", SEG[l.tone])} /> {l.name}
          </span>
        ))}
      </div>

      <div className="flex gap-3" dir="ltr">
        {/* محور الأرقام */}
        <div className="flex flex-col justify-between text-xs font-bold text-muted-foreground tabular-nums shrink-0" style={{ height }}>
          {[...ticks].reverse().map((t, i) => (
            <span key={i}>{Math.round(t).toLocaleString("en-US")}</span>
          ))}
        </div>

        <div className="relative flex-1 min-w-0" style={{ height }}>
          {/* خطوط الشبكة */}
          {ticks.map((_, i) => (
            <div key={i} className="absolute inset-x-0 border-t border-border/60" style={{ bottom: `${(i / (ticks.length - 1)) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end justify-around gap-3 px-1">
            {bars.map((b, bi) => {
              const total = totals[bi];
              return (
                <div key={`${b.label}-${bi}`} className="flex-1 max-w-[72px] h-full flex flex-col justify-end">
                  <div
                    className="w-full rounded-t-md overflow-hidden flex flex-col-reverse transition-all duration-500"
                    style={{ height: `${total > 0 ? Math.max(2, (total / max) * 100) : 0}%` }}
                    title={`${b.label} — ${b.segments.map((s) => `${s.name}: ${format(s.value)}`).join(" · ")}`}
                  >
                    {b.segments.map((s, si) => (
                      <div
                        key={`${s.name}-${si}`}
                        className={SEG[s.tone]}
                        style={{ height: total > 0 ? `${(Math.max(0, s.value) / total) * 100}%` : 0 }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex gap-3 mt-3" dir="ltr">
        <div className="shrink-0 invisible text-xs font-bold">{Math.round(max).toLocaleString("en-US")}</div>
        <div className="flex-1 flex items-start justify-around gap-3 px-1">
          {bars.map((b, i) => (
            <div key={`${b.label}-lbl-${i}`} className="flex-1 max-w-[72px] text-center text-sm font-bold text-foreground whitespace-nowrap">
              {b.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
