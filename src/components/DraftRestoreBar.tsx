import { History, X } from "lucide-react";

export function DraftRestoreBar({
  savedAt,
  summary,
  onRestore,
  onDismiss,
}: {
  savedAt: number;
  /** Short description, e.g. "12 صنف" */
  summary?: string;
  onRestore: () => void;
  onDismiss: () => void;
}) {
  const time = new Intl.DateTimeFormat("ar-EG", {
    hour: "numeric",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  }).format(new Date(savedAt));

  return (
    <div className="card-elevated p-3 md:p-4 mb-4 border-2 border-success bg-success/5 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2 min-w-0">
        <History className="w-5 h-5 text-success shrink-0" />
        <div className="text-sm font-bold text-foreground">
          فيه مسودة محفوظة من {time}
          {summary ? <span className="text-muted-foreground font-medium"> — {summary}</span> : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRestore}
          className="rounded-lg px-3 py-1.5 text-xs font-bold bg-success text-success-foreground hover:opacity-90"
        >
          استرجع
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg px-3 py-1.5 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1"
        >
          <X className="w-3.5 h-3.5" />
          تجاهل
        </button>
      </div>
    </div>
  );
}
