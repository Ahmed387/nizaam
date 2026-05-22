import { useEffect, useState } from "react";
import { countPending, syncPendingSales, OFFLINE_QUEUE_EVENT, OFFLINE_SYNC_STATE_EVENT } from "@/lib/offlineQueue";
import { CloudOff, RefreshCw, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function OfflineQueueIndicator() {
  const [count, setCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  const refresh = () => countPending().then(setCount).catch(() => {});

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    const onSync = (e: any) => setSyncing(e.detail === "syncing");
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener(OFFLINE_QUEUE_EVENT, onChange);
    window.addEventListener(OFFLINE_SYNC_STATE_EVENT, onSync);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const t = setInterval(refresh, 8000);
    return () => {
      window.removeEventListener(OFFLINE_QUEUE_EVENT, onChange);
      window.removeEventListener(OFFLINE_SYNC_STATE_EVENT, onSync);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(t);
    };
  }, []);

  if (count === 0 && online) return null;

  const label = !online
    ? `غير متصل${count > 0 ? ` · ${count} معلقة` : ""}`
    : `${count} فاتورة في انتظار المزامنة`;

  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <button
          onClick={() => syncPendingSales(false)}
          disabled={syncing || !online}
          className={`relative inline-flex items-center gap-1.5 px-2 h-9 rounded-md border text-xs font-bold transition ${
            !online
              ? "bg-destructive/10 border-destructive/30 text-destructive"
              : "bg-warning/10 border-warning/30 text-warning hover:bg-warning/20"
          } disabled:opacity-60`}
          aria-label={label}
        >
          {syncing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : !online ? (
            <CloudOff className="w-4 h-4" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {count > 0 && (
            <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px]">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="text-xs">
          {label}
          {online && count > 0 && <div className="text-muted-foreground mt-0.5">اضغط لإعادة المحاولة</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
