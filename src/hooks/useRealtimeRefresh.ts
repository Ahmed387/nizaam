import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to postgres_changes on the given tables and calls `onChange`
 * (debounced) whenever a row is inserted/updated/deleted. Use to keep
 * dashboards / lists / charts in sync without a manual reload.
 */
export function useRealtimeRefresh(tables: string[], onChange: () => void, debounceMs = 250) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    if (!tables.length) return;
    let timer: any;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cbRef.current?.(), debounceMs);
    };
    const channel = supabase.channel(`rt-${tables.join("-")}-${Math.random().toString(36).slice(2, 7)}`);
    tables.forEach((t) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table: t }, fire);
    });
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join("|"), debounceMs]);
}
