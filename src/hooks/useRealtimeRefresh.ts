import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to postgres_changes on the given tables and calls `onChange` when a row changes.
 *
 * Speed (owner report: pages 20–30 s): a burst of changes (a sale writes invoice, items, payment, till,
 * voucher, ledger … in one go; a bulk correction writes hundreds of rows) used to reload every open
 * page several times, on every device. Now:
 *  - changes are gathered for `debounceMs` (default 1.5 s) and the page reloads ONCE,
 *  - a page in a hidden tab does not reload; it reloads once when the tab is shown again,
 *  - at most one reload every `minGapMs` (default 5 s) per page.
 */
export function useRealtimeRefresh(tables: string[], onChange: () => void, debounceMs = 1500, minGapMs = 5000) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    if (!tables.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;
    let lastRun = 0;
    const run = () => {
      timer = undefined;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") { dirty = true; return; }
      const wait = lastRun + minGapMs - Date.now();
      if (wait > 0) { timer = setTimeout(run, wait); return; }
      dirty = false;
      lastRun = Date.now();
      cbRef.current?.();
    };
    const fire = () => {
      dirty = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, debounceMs);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && dirty && !timer) timer = setTimeout(run, 300);
    };
    const channel = supabase.channel(`rt-${tables.join("-")}-${Math.random().toString(36).slice(2, 7)}`);
    tables.forEach((t) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table: t }, fire);
    });
    channel.subscribe();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join("|"), debounceMs, minGapMs]);
}
