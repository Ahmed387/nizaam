import { toast } from "sonner";
import { CheckCircle2, XCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { formatEGP } from "@/lib/format";

type Tone = "success" | "error" | "warning";

const TONES: Record<Tone, { wrap: string; icon: string; title: string; btn: string }> = {
  success: {
    wrap: "border-success/40 bg-success/10",
    icon: "bg-success/20 text-success",
    title: "text-success",
    btn: "bg-success text-success-foreground hover:opacity-90",
  },
  error: {
    wrap: "border-destructive/40 bg-destructive/10",
    icon: "bg-destructive/20 text-destructive",
    title: "text-destructive",
    btn: "bg-destructive text-destructive-foreground hover:opacity-90",
  },
  warning: {
    wrap: "border-warning/40 bg-warning/10",
    icon: "bg-warning/20 text-warning",
    title: "text-warning",
    btn: "bg-warning text-warning-foreground hover:opacity-90",
  },
};

export interface DocToastOptions {
  /** Big headline, e.g. "تم تسجيل الشحنة بنجاح" */
  title: string;
  /** Optional secondary line */
  description?: string;
  /** Document number (invoice / shipment / return) */
  docNumber?: string | null;
  /** Amount in EGP */
  amount?: number | null;
  /** Action button label + handler (e.g. فتح الفاتورة) */
  action?: { label: string; onClick: () => void };
  duration?: number;
}

function show(tone: Tone, o: DocToastOptions) {
  const t = TONES[tone];
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? XCircle : AlertTriangle;
  return toast.custom(
    (id) => (
      <div
        dir="rtl"
        className={`w-[min(92vw,26rem)] rounded-2xl border-2 ${t.wrap} bg-card/95 backdrop-blur p-4 shadow-lg animate-scale-in`}
      >
        <div className="flex items-start gap-3">
          <div className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center ${t.icon}`}>
            <Icon className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-base font-extrabold leading-tight ${t.title}`}>{o.title}</div>
            {o.description && (
              <div className="mt-1 text-sm text-muted-foreground break-words">{o.description}</div>
            )}
            {(o.docNumber || o.amount != null) && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {o.docNumber && (
                  <span className="px-2 py-1 rounded-lg bg-muted text-foreground text-xs font-bold font-mono">
                    {o.docNumber}
                  </span>
                )}
                {o.amount != null && (
                  <span className={`px-2 py-1 rounded-lg text-xs font-extrabold ${t.icon}`}>
                    {formatEGP(o.amount)}
                  </span>
                )}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2">
              {o.action && (
                <button
                  type="button"
                  onClick={() => {
                    toast.dismiss(id);
                    o.action!.onClick();
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold ${t.btn}`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {o.action.label}
                </button>
              )}
              <button
                type="button"
                onClick={() => toast.dismiss(id)}
                className="rounded-lg px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      </div>
    ),
    { duration: o.duration ?? (tone === "success" ? 8000 : 10000) },
  );
}

export const docSuccess = (o: DocToastOptions) => show("success", o);
export const docError = (o: DocToastOptions) => show("error", o);
export const docWarning = (o: DocToastOptions) => show("warning", o);
