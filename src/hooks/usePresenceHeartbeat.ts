import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Records login + periodic last_seen for the current user.
 * Tracked roles: admin, branch_manager, accountant, warehouse, supervisor, viewer, cashier.
 * Workers/drivers don't have system access so won't reach here.
 */
export function usePresenceHeartbeat() {
  const { user, tenantId } = useAuth();
  const loggedInRef = useRef(false);

  useEffect(() => {
    if (!user?.id || !tenantId) return;
    const uid = user.id;
    const tid = tenantId;

    const upsert = async (loginAlso: boolean) => {
      const payload: any = {
        user_id: uid,
        tenant_id: tid,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : null,
      };
      if (loginAlso) payload.last_login_at = new Date().toISOString();
      await supabase.from("user_presence" as any).upsert(payload, { onConflict: "user_id" });
    };

    // initial login mark
    if (!loggedInRef.current) {
      loggedInRef.current = true;
      upsert(true);
    } else {
      upsert(false);
    }

    // every 3 minutes, and only while the tab is on screen (a hidden tab is not «online»)
    const id = setInterval(() => { if (document.visibilityState === "visible") upsert(false); }, 180_000);
    const onVisible = () => { if (document.visibilityState === "visible") upsert(false); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user?.id, tenantId]);
}
