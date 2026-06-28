import { ReactNode } from "react";

interface Props {
  icon: string;
  title: string;
  purpose: string;
  shows: string[];
  unique: string;
  accent?: "primary" | "success" | "warning" | "destructive" | "info";
  extra?: ReactNode;
}

const ACCENTS: Record<string, { border: string; bg: string; chip: string; dot: string; ring: string }> = {
  primary:     { border: "border-primary/40",     bg: "from-primary/10 via-primary/5 to-transparent",         chip: "bg-primary/15 text-primary",         dot: "bg-primary",     ring: "ring-primary/20" },
  success:     { border: "border-success/40",     bg: "from-success/10 via-success/5 to-transparent",         chip: "bg-success/15 text-success",         dot: "bg-success",     ring: "ring-success/20" },
  warning:     { border: "border-warning/40",     bg: "from-warning/10 via-warning/5 to-transparent",         chip: "bg-warning/15 text-warning",         dot: "bg-warning",     ring: "ring-warning/20" },
  destructive: { border: "border-destructive/40", bg: "from-destructive/10 via-destructive/5 to-transparent", chip: "bg-destructive/15 text-destructive", dot: "bg-destructive", ring: "ring-destructive/20" },
  info:        { border: "border-blue-500/40",    bg: "from-blue-500/10 via-blue-500/5 to-transparent",       chip: "bg-blue-500/15 text-blue-500",       dot: "bg-blue-500",    ring: "ring-blue-500/20" },
};

export function ReportIntro({ icon, title, purpose, shows, unique, accent = "primary", extra }: Props) {
  const a = ACCENTS[accent];
  return (
    <div className={`relative overflow-hidden rounded-xl border ${a.border} bg-gradient-to-bl ${a.bg} backdrop-blur-sm mb-5 shadow-sm`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-border/40">
        <div className={`w-11 h-11 rounded-xl ${a.chip} ring-4 ${a.ring} flex items-center justify-center text-2xl shrink-0`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-extrabold text-lg leading-tight truncate">{title}</h3>
          <p className="text-sm text-muted-foreground leading-snug mt-0.5">{purpose}</p>
        </div>
      </div>

      {/* Body */}
      <div className="grid md:grid-cols-5 gap-4 px-5 py-5">
        <div className="md:col-span-3">
          <div className={`inline-flex items-center gap-1.5 text-xs font-bold mb-2.5 px-2.5 py-1 rounded-full ${a.chip}`}>
            <span>📋</span><span>محتوى التقرير</span>
          </div>
          <ul className="space-y-2">
            {shows.map((s, i) => (
              <li key={i} className="text-sm md:text-base flex items-start gap-2 leading-loose">
                <span className={`mt-2 w-1.5 h-1.5 rounded-full ${a.dot} shrink-0`} />
                <span className="text-foreground/90 break-words whitespace-normal">{s}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-2">
          <div className={`inline-flex items-center gap-1.5 text-xs font-bold mb-2.5 px-2.5 py-1 rounded-full ${a.chip}`}>
            <span>⭐</span><span>المميز فيه</span>
          </div>
          <p className="text-sm md:text-base leading-loose bg-card/70 rounded-xl p-4 border border-border/60 text-foreground break-words whitespace-normal">
            {unique}
          </p>
        </div>
      </div>

      {extra && <div className="px-5 pb-4">{extra}</div>}
    </div>
  );
}
