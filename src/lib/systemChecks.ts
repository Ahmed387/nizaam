// «فحص السيستم» reads SAVED results (migration 0233, owner 2026-11-16 «نفذ الحل»): the three heavy checks run in the
// background (pg_cron, every hour + on request) because live they took 7–60 s against the browser's 8 s limit.
// The page reads system_checks_get / system_health_get (fast) and «افحص دلوقتي» asks for a fresh run, then polls.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SavedCheck<T> {
  checked_at: string | null;
  /** company checks: when the books reconciliation part last succeeded */
  gl_at?: string | null;
  requested_at: string | null;
  pending: boolean;
  error: string | null;
  took_ms: number | null;
  data: T | null;
}

const EVENT = "nizam:system-checks-updated";
const POLL_MS = 5_000;
const MAX_WAIT_MS = 180_000;

async function rpc<T>(fn: string): Promise<T> {
  const { data, error } = await supabase.rpc(fn as any);
  if (error) throw error;
  return data as T;
}

/** A saved result is newer than the request it answers (or there was no request). */
export function isFresh(c: Pick<SavedCheck<unknown>, "checked_at" | "requested_at">): boolean {
  if (!c.requested_at) return true;
  if (!c.checked_at) return false;
  return new Date(c.checked_at).getTime() >= new Date(c.requested_at).getTime();
}

/** «آخر فحص: النهارده 9:20 ص — من 25 دقيقة» */
export function checkedText(iso: string | null, now = new Date()): string {
  if (!iso || new Date(iso).getTime() < 86_400_000) return "لسه ما اتعملش فحص";
  const d = new Date(iso);
  const time = d.toLocaleTimeString("ar-EG", { timeZone: "Africa/Cairo", hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
  const when = day(d) === day(now) ? `النهارده ${time}` : `${d.toLocaleDateString("en-GB", { timeZone: "Africa/Cairo" })} ${time}`;
  const mins = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000));
  const ago = mins < 1 ? "دلوقتي" : mins < 60 ? `من ${mins} دقيقة` : `من ${Math.floor(mins / 60)} ساعة`;
  return `آخر فحص: ${when} — ${ago}`;
}

function shape<T>(raw: any, pick: (r: any) => T | null): SavedCheck<T> {
  return {
    checked_at: raw?.checked_at ?? null, gl_at: raw?.gl_at ?? null, requested_at: raw?.requested_at ?? null, pending: !!raw?.pending,
    error: raw?.error ?? null, took_ms: raw?.took_ms ?? null, data: raw ? pick(raw) : null,
  };
}

export async function fetchCompanyChecks(): Promise<SavedCheck<{ audit: any[]; gl: any | null }>> {
  const raw = await rpc<any>("system_checks_get");
  return shape(raw, (r) => ({ audit: Array.isArray(r.audit) ? r.audit : [], gl: r.gl ?? null }));
}
export async function fetchPlatformHealth(): Promise<SavedCheck<any>> {
  const raw = await rpc<any>("system_health_get");
  return shape(raw, (r) => r.result ?? null);
}

/**
 * One saved check on a page: loads it, «افحص دلوقتي» asks for a run and polls until the answer is newer than the
 * request (or 3 minutes pass). Every hook of the same kind reloads when one of them gets a fresh result.
 */
export function useSavedCheck<T>(kind: "company" | "platform") {
  const get = (kind === "company" ? fetchCompanyChecks : fetchPlatformHealth) as () => Promise<SavedCheck<T>>;
  const requestFn = kind === "company" ? "system_checks_request" : "system_health_request";
  const [check, setCheck] = useState<SavedCheck<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const c = await get();
      if (!alive.current) return c;
      setCheck(c); setError(null);
      return c;
    } catch (e: any) {
      if (alive.current) setError(e?.message ?? "تعذر قراءة نتيجة الفحص");
      return null;
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [get]);

  const runNow = useCallback(async () => {
    setWaiting(true); setError(null);
    try {
      await rpc<any>(requestFn);
      const started = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        const c = await load();
        if (c && isFresh(c)) { window.dispatchEvent(new CustomEvent(EVENT, { detail: kind })); break; }
        if (Date.now() - started > MAX_WAIT_MS) { setError("الفحص لسه شغال في الخلفية — النتيجة هتظهر لوحدها لما يخلص"); break; }
      }
    } catch (e: any) {
      if (alive.current) setError(e?.message ?? "تعذر طلب الفحص");
    } finally {
      if (alive.current) setWaiting(false);
    }
  }, [kind, load, requestFn]);

  // someone else asked for a run (or the job is on it): follow it quietly until the answer lands
  useEffect(() => {
    if (!check?.pending || waiting) return;
    const t = setInterval(() => { load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [check?.pending, waiting, load]);

  useEffect(() => {
    alive.current = true;
    load();
    const on = (e: Event) => { if ((e as CustomEvent).detail === kind) load(); };
    window.addEventListener(EVENT, on);
    return () => { alive.current = false; window.removeEventListener(EVENT, on); };
  }, [kind, load]);

  return { check, loading, waiting: waiting || !!check?.pending, error, load, runNow };
}
