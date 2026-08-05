import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const SKIP_KEY = "__guide_skipped__";

/** تقدم اليوزر في دليل الاستخدام (جدول onboarding_progress) */
export function useOnboardingProgress() {
  const { user } = useAuth();
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [skipped, setSkipped] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    const { data } = await (supabase as any)
      .from("onboarding_progress")
      .select("section_key, completed_at, skipped")
      .eq("user_id", user.id);
    const map: Record<string, boolean> = {};
    let isSkipped = false;
    for (const row of (data ?? []) as any[]) {
      if (row.section_key === SKIP_KEY) { isSkipped = !!row.skipped; continue; }
      if (row.completed_at) map[row.section_key] = true;
    }
    setCompleted(map);
    setSkipped(isSkipped);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const setSectionDone = useCallback(async (key: string, done: boolean) => {
    if (!user?.id) return;
    setCompleted((c) => ({ ...c, [key]: done }));
    await (supabase as any).from("onboarding_progress").upsert(
      { user_id: user.id, section_key: key, completed_at: done ? new Date().toISOString() : null },
      { onConflict: "user_id,section_key" },
    );
  }, [user?.id]);

  const setGuideSkipped = useCallback(async (value: boolean) => {
    if (!user?.id) return;
    setSkipped(value);
    await (supabase as any).from("onboarding_progress").upsert(
      { user_id: user.id, section_key: SKIP_KEY, skipped: value, completed_at: value ? new Date().toISOString() : null },
      { onConflict: "user_id,section_key" },
    );
  }, [user?.id]);

  const resetProgress = useCallback(async () => {
    if (!user?.id) return;
    setCompleted({});
    setSkipped(false);
    await (supabase as any).from("onboarding_progress").delete().eq("user_id", user.id);
  }, [user?.id]);

  return { completed, skipped, loading, setSectionDone, setGuideSkipped, resetProgress, reload: load };
}
