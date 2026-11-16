/**
 * Records which pages each signed-in user opens (migration 0238, owner 2026-11-16 «دخل شاف ايه … مجمّع»): ONE call to
 * `track_page_visit` per navigation, which keeps one row per user × day × page × branch (first / last time, hits).
 * The page name comes from the permission catalogue (`pageVisitOf`), so the report says «شاشة البيع», «العملاء» …
 * Mounted once in App.tsx. Never blocks anything: errors are ignored.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { pageVisitOf } from "@/lib/pageVisit";

export default function PageVisitTracker() {
  const { pathname } = useLocation();
  const { user, isSuperAdmin } = useAuth();
  const last = useRef<{ k: string; at: number } | null>(null);

  useEffect(() => {
    if (!user || isSuperAdmin) return;
    const v = pageVisitOf(pathname);
    if (!v) return;
    const k = `${v.key}|${v.branch ?? ""}`;
    const now = Date.now();
    // the same page again within 30 s (re-render, back / forward) is the same visit
    if (last.current && last.current.k === k && now - last.current.at < 30_000) return;
    last.current = { k, at: now };
    const t = window.setTimeout(() => {
      (supabase.rpc as any)("track_page_visit", { p_key: v.key, p_label: v.label, p_branch: v.branch }).then(() => {}, () => {});
    }, 800);
    return () => window.clearTimeout(t);
  }, [pathname, user, isSuperAdmin]);

  return null;
}
