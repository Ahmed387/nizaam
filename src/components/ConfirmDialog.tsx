import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Trash2, HelpCircle, X, Check } from "lucide-react";

export type ConfirmTone = "danger" | "warning" | "info";

export interface ConfirmOptions {
  /** العنوان الكبير */
  title: string;
  /** الشرح بالعامية */
  description?: string;
  /** نص زرار التأكيد */
  confirmLabel?: string;
  /** نص زرار الإلغاء */
  cancelLabel?: string;
  tone?: ConfirmTone;
}

type Pending = ConfirmOptions & { resolve: (v: boolean) => void };

let emit: ((p: Pending | null) => void) | null = null;

/**
 * بديل window.confirm — ديالوج ملوّن وواضح بالعامية.
 * const ok = await confirmAlert({ title: "...", description: "..." });
 */
export function confirmAlert(o: ConfirmOptions): Promise<boolean> {
  if (!emit) return Promise.resolve(window.confirm(o.title));
  return new Promise<boolean>((resolve) => emit!({ ...o, resolve }));
}

const TONES: Record<ConfirmTone, { ring: string; icon: string; title: string; btn: string; Icon: typeof AlertTriangle }> = {
  danger: {
    ring: "border-destructive/50",
    icon: "bg-destructive/15 text-destructive",
    title: "text-destructive",
    btn: "bg-destructive text-destructive-foreground hover:opacity-90",
    Icon: Trash2,
  },
  warning: {
    ring: "border-warning/50",
    icon: "bg-warning/15 text-warning",
    title: "text-warning",
    btn: "bg-warning text-warning-foreground hover:opacity-90",
    Icon: AlertTriangle,
  },
  info: {
    ring: "border-primary/50",
    icon: "bg-primary/15 text-primary",
    title: "text-primary",
    btn: "bg-primary text-primary-foreground hover:opacity-90",
    Icon: HelpCircle,
  },
};

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    emit = setPending;
    return () => {
      emit = null;
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Enter") return;
      // نلتقط الحدث قبل أي Dialog تاني (Radix) عشان ما يبتلعش المفتاح
      e.preventDefault();
      e.stopPropagation();
      pending.resolve(e.key === "Enter");
      setPending(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pending]);

  if (!pending) return null;
  const t = TONES[pending.tone ?? "danger"];
  const Icon = t.Icon;

  const done = (v: boolean) => {
    pending.resolve(v);
    setPending(null);
  };

  return createPortal(
    <div
      dir="rtl"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-background/70 backdrop-blur-sm p-4 animate-fade-in pointer-events-auto"
      style={{ pointerEvents: "auto" }}
      onClick={() => done(false)}
    >

      <div
        onClick={(e) => e.stopPropagation()}
        style={{ pointerEvents: "auto" }}
        className={`w-[min(94vw,30rem)] rounded-2xl border-2 ${t.ring} bg-card shadow-2xl overflow-hidden animate-scale-in pointer-events-auto`}
      >
        <div className="p-5 flex items-start gap-4">
          <div className={`shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center ${t.icon}`}>
            <Icon className="w-7 h-7" />
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-xl font-extrabold leading-tight ${t.title}`}>{pending.title}</div>
            {pending.description && (
              <div className="mt-2 text-sm font-medium text-muted-foreground leading-relaxed break-words">
                {pending.description}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 py-4 bg-muted/40 border-t border-border">
          <button
            type="button"
            onClick={() => done(true)}
            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-extrabold ${t.btn}`}
          >
            <Check className="w-4 h-4" />
            {pending.confirmLabel ?? "أيوه، كمّل"}
          </button>
          <button
            type="button"
            onClick={() => done(false)}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-extrabold border-2 border-border bg-card hover:bg-muted text-foreground"
          >
            <X className="w-4 h-4" />
            {pending.cancelLabel ?? "لأ، ارجع"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
