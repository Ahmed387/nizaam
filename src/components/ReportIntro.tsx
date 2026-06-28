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

const ACCENTS = {
  primary: "border-primary bg-primary/5",
  success: "border-success bg-success/5",
  warning: "border-warning bg-warning/5",
  destructive: "border-destructive bg-destructive/5",
  info: "border-blue-500 bg-blue-500/5",
};

export function ReportIntro({ icon, title, purpose, shows, unique, accent = "primary", extra }: Props) {
  return (
    <div className={`card-elevated p-4 mb-4 border-r-4 ${ACCENTS[accent]}`}>
      <div className="flex items-start gap-3">
        <div className="text-3xl leading-none shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <h3 className="font-extrabold text-base">{title}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">{purpose}</p>
          <div className="mt-2.5 grid md:grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1">بيعرض إيه</div>
              <ul className="space-y-0.5">
                {shows.map((s, i) => (
                  <li key={i} className="text-xs flex items-start gap-1.5">
                    <span className="text-success shrink-0 mt-0.5">✓</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1">المميز فيه</div>
              <p className="text-xs leading-relaxed bg-surface-2/60 rounded p-2 border border-border/50">{unique}</p>
            </div>
          </div>
          {extra && <div className="mt-2">{extra}</div>}
        </div>
      </div>
    </div>
  );
}
