import { Plus } from "lucide-react";

interface Props {
  /** يتنفّذ أول ما اليوزر يقف بالماوس على الشريط */
  onActivate: () => void;
  /** الشريط جاهز؟ لو false بنعرض تنبيه إن لازم يكمّل البيانات */
  ready?: boolean;
  label?: string;
  hint?: string;
  /** رسالة اللي بتظهر لما ready = false */
  notReadyText?: string;
}

/**
 * شريط «منتج آخر» — نفس تجربة شاشة فاتورة الشراء:
 * أول ما تقف عليه بالماوس بيجهّزلك صنف جديد.
 */
export function AddAnotherBar({
  onActivate,
  ready = true,
  label = "منتج آخر",
  hint = "— وقف هنا بالماوس يفتح صنف جديد",
  notReadyText = "كمّل بيانات الصنف الحالي وهيظهرلك «منتج آخر»",
}: Props) {
  if (!ready) {
    return (
      <div className="w-full rounded-2xl border border-dashed border-amber-500/40 bg-gradient-to-l from-amber-500/10 to-transparent p-4 text-center text-[12px] text-amber-700 dark:text-amber-300 font-semibold">
        {notReadyText}
      </div>
    );
  }
  return (
    <button
      type="button"
      onMouseEnter={onActivate}
      onClick={onActivate}
      className="group w-full rounded-2xl border-2 border-dashed border-emerald-500/40 bg-gradient-to-l from-emerald-500/15 via-sky-500/10 to-amber-500/5 hover:from-emerald-500/25 hover:via-sky-500/20 hover:to-amber-500/10 hover:border-emerald-500 transition-all p-4 flex items-center justify-center gap-3 text-emerald-700 dark:text-emerald-300 font-bold text-base shadow-sm hover:shadow-md hover:shadow-emerald-500/10"
    >
      <span className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-sky-500 text-white flex items-center justify-center shadow group-hover:scale-110 transition-transform">
        <Plus className="w-5 h-5" />
      </span>
      <span>{label}</span>
      <span className="text-[11px] font-normal text-muted-foreground hidden sm:inline">{hint}</span>
    </button>
  );
}
