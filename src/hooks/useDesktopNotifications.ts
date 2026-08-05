import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Types that deserve a desktop (OS-level) push + sound. */
const PUSH_TYPES = [
  "shift_auto_closed",
  "shift_reminder",
  "shift_pre_close",
  "shift_open_blocked",
  "sale_return_created",
  "purchase_return_created",
];


function beep() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1);
  } catch { /* ignore */ }
}

/**
 * Mirrors incoming in-app notifications to OS-level desktop notifications
 * (works for admin / owner / cashier alike — it is per signed-in user).
 */
export function useDesktopNotifications(options?: { onlyTypes?: string[] }) {
  const { user } = useAuth();
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const typesRef = useRef(options?.onlyTypes ?? PUSH_TYPES);

  const request = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setPermission(p);
  }, []);

  useEffect(() => {
    if (!user?.id || permission !== "granted") return;
    const channel = supabase
      .channel(`desktop-notif-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload: any) => {
          const n = payload.new;
          if (!n) return;
          if (typesRef.current.length && !typesRef.current.includes(n.type)) return;
          try {
            const notif = new Notification(n.title, { body: n.body ?? "", tag: n.id, dir: "rtl", lang: "ar" });
            notif.onclick = () => {
              window.focus();
              if (n.link) window.location.assign(n.link);
              notif.close();
            };
          } catch { /* ignore */ }
          beep();
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, permission]);

  return { permission, request };
}
