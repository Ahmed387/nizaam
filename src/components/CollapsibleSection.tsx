import { ChevronDown, ChevronUp } from "lucide-react";
import { ReactNode } from "react";

export type AccentColor = "default" | "blue" | "emerald" | "amber" | "violet" | "rose" | "indigo";

interface Props {
  title: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
  accent?: AccentColor;
}

const accentMap: Record<AccentColor, { from: string; via: string; iconBg: string; iconText: string; iconBorder: string; title: string; arrowBg: string }> = {
  default:  { from: "from-primary/10", via: "via-primary/5", iconBg: "bg-primary/15", iconText: "text-primary", iconBorder: "border-primary/30", title: "text-primary", arrowBg: "bg-muted/60" },
  blue:     { from: "from-sky-500/10", via: "via-sky-400/5", iconBg: "bg-sky-500/15", iconText: "text-sky-600 dark:text-sky-400", iconBorder: "border-sky-500/30", title: "text-sky-700 dark:text-sky-300", arrowBg: "bg-sky-500/10" },
  emerald:  { from: "from-emerald-500/10", via: "via-emerald-400/5", iconBg: "bg-emerald-500/15", iconText: "text-emerald-600 dark:text-emerald-400", iconBorder: "border-emerald-500/30", title: "text-emerald-700 dark:text-emerald-300", arrowBg: "bg-emerald-500/10" },
  amber:    { from: "from-amber-500/10", via: "via-amber-400/5", iconBg: "bg-amber-500/15", iconText: "text-amber-600 dark:text-amber-400", iconBorder: "border-amber-500/30", title: "text-amber-700 dark:text-amber-300", arrowBg: "bg-amber-500/10" },
  violet:   { from: "from-violet-500/10", via: "via-violet-400/5", iconBg: "bg-violet-500/15", iconText: "text-violet-600 dark:text-violet-400", iconBorder: "border-violet-500/30", title: "text-violet-700 dark:text-violet-300", arrowBg: "bg-violet-500/10" },
  rose:     { from: "from-rose-500/10", via: "via-rose-400/5", iconBg: "bg-rose-500/15", iconText: "text-rose-600 dark:text-rose-400", iconBorder: "border-rose-500/30", title: "text-rose-700 dark:text-rose-300", arrowBg: "bg-rose-500/10" },
  indigo:   { from: "from-indigo-500/10", via: "via-indigo-400/5", iconBg: "bg-indigo-500/15", iconText: "text-indigo-600 dark:text-indigo-400", iconBorder: "border-indigo-500/30", title: "text-indigo-700 dark:text-indigo-300", arrowBg: "bg-indigo-500/10" },
};

/**
 * قسم قابل للطي بنفس استايل فاتورة البيع الجديدة.
 * - هيدر بعرض كامل، عنوان في المنتصف، أيقونة يسار وسهم يمين.
 * - الضغط على أي مكان في الهيدر يفتح/يقفل المحتوى.
 * - accent: يغير ألوان الهيدر حسب القسم.
 */
export function CollapsibleSection({ title, icon, open, onToggle, children, className = "", accent = "default" }: Props) {
  const a = accentMap[accent];
  return (
    <div className={`card-elevated overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-3 px-6 py-4 bg-gradient-to-l ${a.from} ${a.via} to-transparent border-b border-border hover:brightness-105 transition-all`}
      >
        <div className={`w-10 h-10 rounded-lg ${a.iconBg} ${a.iconText} flex items-center justify-center border ${a.iconBorder} shrink-0`}>
          {icon}
        </div>
        <div className={`flex-1 text-center text-xl font-extrabold ${a.title} tracking-tight`}>
          {title}
        </div>
        <div className={`w-10 h-10 rounded-lg ${a.arrowBg} flex items-center justify-center shrink-0`}>
          {open ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}
