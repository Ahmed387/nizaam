import { useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useDesktopNotifications } from "@/hooks/useDesktopNotifications";

const DISMISS_KEY = "nizam_desktop_notif_dismissed";

/** Global mount: mirrors shift notifications to OS notifications and offers a one-click enable prompt. */
export default function DesktopNotifications() {
  const { user } = useAuth();
  const { permission, request } = useDesktopNotifications();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "1");

  if (!user || permission !== "default" || dismissed) return null;

  return (
    <div className="fixed bottom-4 start-4 z-[60] max-w-xs rounded-xl border border-warning/40 bg-card shadow-lg p-3 animate-fade-in">
      <div className="flex items-start gap-2">
        <Bell className="w-5 h-5 text-warning shrink-0 mt-0.5 animate-pulse" />
        <div className="flex-1 text-sm">
          <div className="font-bold">فعّل تنبيهات الورديات</div>
          <div className="text-muted-foreground text-xs mt-0.5">
            هيوصلك تنبيه على الجهاز مع صوت قبل قفل الوردية أو لو وردية اتقفلت تلقائيًا.
          </div>
          <div className="flex gap-2 mt-2">
            <Button size="sm" onClick={request}>تفعيل</Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { localStorage.setItem(DISMISS_KEY, "1"); setDismissed(true); }}
            >
              لاحقًا
            </Button>
          </div>
        </div>
        <button
          aria-label="إغلاق"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => { localStorage.setItem(DISMISS_KEY, "1"); setDismissed(true); }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
