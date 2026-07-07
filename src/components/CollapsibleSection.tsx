import { ChevronDown, ChevronUp } from "lucide-react";
import { ReactNode } from "react";

interface Props {
  title: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * قسم قابل للطي بنفس استايل فاتورة البيع الجديدة.
 * - هيدر بعرض كامل، عنوان في المنتصف، أيقونة يسار وسهم يمين.
 * - الضغط على أي مكان في الهيدر يفتح/يقفل المحتوى.
 */
export function CollapsibleSection({ title, icon, open, onToggle, children, className = "" }: Props) {
  return (
    <div className={`card-elevated overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-6 py-4 bg-gradient-to-l from-primary/10 via-primary/5 to-transparent border-b border-border hover:from-primary/15 transition-all"
      >
        <div className="w-10 h-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center border border-primary/30 shrink-0">
          {icon}
        </div>
        <div className="flex-1 text-center text-xl font-extrabold text-primary tracking-tight">
          {title}
        </div>
        <div className="w-10 h-10 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
          {open ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}
