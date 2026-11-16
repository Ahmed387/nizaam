-- 0233 — «فحص السيستم» reads saved results (owner 2026-11-16 «نفذ الحل»).
-- The page ran three heavy checks live under the browser's 8 s limit: system_integrity_audit (7.5–60 s on the Micro
-- server), ledger_gl_reconciliation (≈ 6.3 s) and system_health_check (≈ 8.8 s) → «canceling statement due to statement
-- timeout». Now the database runs them in the background (pg_cron, 120 s limit) and keeps the FULL result:
--   * hourly with the existing job «integrity-cache» (system_integrity_refresh_all → every company + the platform check);
--   * on request: «افحص دلوقتي» calls system_checks_request() / system_health_request(), the job «system-checks-requests»
--     (every minute) runs what was asked; the page polls until checked_at is newer.
-- The page reads system_checks_get() / system_health_get() — milliseconds. Read only, nothing in the data changes.

ALTER TABLE public.system_integrity_cache
  ADD COLUMN IF NOT EXISTS audit_rows jsonb,
  ADD COLUMN IF NOT EXISTS gl jsonb,
  ADD COLUMN IF NOT EXISTS gl_at timestamptz,
  ADD COLUMN IF NOT EXISTS requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_error text,
  ADD COLUMN IF NOT EXISTS took_ms int;

CREATE TABLE IF NOT EXISTS public.system_health_cache (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  result jsonb, checked_at timestamptz, requested_at timestamptz, refresh_error text, took_ms int
);
ALTER TABLE public.system_health_cache ENABLE ROW LEVEL SECURITY;  -- no policy: read only through system_health_get
INSERT INTO public.system_health_cache (id) VALUES (1) ON CONFLICT DO NOTHING;

-- full refresh of one company: the audit rows (once), its summary, the books reconciliation
CREATE OR REPLACE FUNCTION public.system_integrity_refresh(p_tenant uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_rows jsonb; v_gl jsonb; v_err text; t0 timestamptz := clock_timestamp();
BEGIN
  WITH a AS MATERIALIZED (SELECT * FROM public.system_integrity_audit(p_tenant))
  SELECT jsonb_build_object(
           'checked_at', now(),
           'errors', count(*) FILTER (WHERE severity = 'error'),
           'warnings', count(*) FILTER (WHERE severity = 'warning'),
           'info', count(*) FILTER (WHERE severity = 'info'),
           'by_check', COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT check_code AS k, count(*) AS n FROM a GROUP BY 1) z), '{}'::jsonb)),
         COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.severity, a.check_code), '[]'::jsonb)
    INTO v, v_rows FROM a;
  BEGIN
    v_gl := public.ledger_gl_reconciliation(p_tenant);
  EXCEPTION WHEN others THEN v_err := 'مطابقة القيود: ' || sqlerrm;
  END;
  INSERT INTO public.system_integrity_cache AS c (tenant_id, summary, checked_at, audit_rows, gl, gl_at, refresh_error, took_ms)
  VALUES (p_tenant, v, now(), v_rows, v_gl, CASE WHEN v_gl IS NOT NULL THEN now() END, v_err,
          (extract(epoch FROM clock_timestamp() - t0) * 1000)::int)
  ON CONFLICT (tenant_id) DO UPDATE SET summary = excluded.summary, checked_at = excluded.checked_at,
         audit_rows = excluded.audit_rows, gl = COALESCE(excluded.gl, c.gl), gl_at = COALESCE(excluded.gl_at, c.gl_at),
         refresh_error = excluded.refresh_error, took_ms = excluded.took_ms;
  RETURN v;
END $function$;
REVOKE ALL ON FUNCTION public.system_integrity_refresh(uuid) FROM PUBLIC, anon, authenticated;

-- the platform check (all companies), run as the system
CREATE OR REPLACE FUNCTION public.system_health_refresh()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb; t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM set_config('nizam.system_run', 'on', true);
  BEGIN
    v := public.system_health_check();
    UPDATE public.system_health_cache SET result = v, checked_at = now(), refresh_error = NULL,
           took_ms = (extract(epoch FROM clock_timestamp() - t0) * 1000)::int WHERE id = 1;
  EXCEPTION WHEN others THEN
    UPDATE public.system_health_cache SET refresh_error = sqlerrm, checked_at = now() WHERE id = 1;
  END;
  PERFORM set_config('nizam.system_run', '', true);
END $function$;
REVOKE ALL ON FUNCTION public.system_health_refresh() FROM PUBLIC, anon, authenticated;

-- hourly: every company + the platform check
CREATE OR REPLACE FUNCTION public.system_integrity_refresh_all()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN SELECT id FROM public.tenants WHERE coalesce(is_suspended, false) = false LOOP
    BEGIN PERFORM public.system_integrity_refresh(t.id); n := n + 1;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'integrity refresh % failed: %', t.id, sqlerrm;
      UPDATE public.system_integrity_cache SET refresh_error = sqlerrm WHERE tenant_id = t.id;
    END;
  END LOOP;
  PERFORM public.system_health_refresh();
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.system_integrity_refresh_all() FROM PUBLIC, anon, authenticated;

-- on request (pg_cron every minute): what «افحص دلوقتي» asked for
CREATE OR REPLACE FUNCTION public.system_checks_run_requested()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t record; n int := 0; v_req timestamptz;
BEGIN
  FOR t IN SELECT tenant_id, requested_at FROM public.system_integrity_cache
            WHERE requested_at IS NOT NULL AND (checked_at IS NULL OR checked_at < requested_at) LOOP
    BEGIN PERFORM public.system_integrity_refresh(t.tenant_id); n := n + 1;
    EXCEPTION WHEN others THEN
      UPDATE public.system_integrity_cache SET refresh_error = sqlerrm, checked_at = now() WHERE tenant_id = t.tenant_id;
    END;
  END LOOP;
  SELECT requested_at INTO v_req FROM public.system_health_cache WHERE id = 1;
  IF v_req IS NOT NULL AND (SELECT checked_at IS NULL OR checked_at < v_req FROM public.system_health_cache WHERE id = 1) THEN
    PERFORM public.system_health_refresh(); n := n + 1;
  END IF;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.system_checks_run_requested() FROM PUBLIC, anon, authenticated;

-- browser: read the saved result of my company (admin / owner)
CREATE OR REPLACE FUNCTION public.system_checks_get()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; r public.system_integrity_cache%ROWTYPE;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'فحص سلامة البيانات للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.system_integrity_cache WHERE tenant_id = v_t;
  RETURN jsonb_build_object(
    'checked_at', r.checked_at, 'gl_at', r.gl_at, 'requested_at', r.requested_at,
    'pending', r.requested_at IS NOT NULL AND (r.checked_at IS NULL OR r.checked_at < r.requested_at),
    'error', r.refresh_error, 'took_ms', r.took_ms,
    'summary', r.summary, 'audit', COALESCE(r.audit_rows, '[]'::jsonb), 'gl', r.gl);
END $function$;

-- browser: ask for a fresh run (at most once a minute per company)
CREATE OR REPLACE FUNCTION public.system_checks_request()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; v_req timestamptz;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'فحص سلامة البيانات للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.system_integrity_cache (tenant_id, summary, checked_at, requested_at) VALUES (v_t, '{}'::jsonb, 'epoch', now())
  ON CONFLICT (tenant_id) DO UPDATE SET requested_at =
    CASE WHEN system_integrity_cache.requested_at IS NOT NULL
              AND (system_integrity_cache.checked_at IS NULL OR system_integrity_cache.checked_at < system_integrity_cache.requested_at)
         THEN system_integrity_cache.requested_at ELSE now() END
  RETURNING requested_at INTO v_req;
  RETURN jsonb_build_object('requested_at', v_req);
END $function$;

-- browser: the platform check, same people as system_health_check
CREATE OR REPLACE FUNCTION public.system_health_allowed()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT lower(coalesce((SELECT email FROM auth.users WHERE id = auth.uid()), '')) = 'an.ayoub98@gmail.com'
      OR public.is_super_admin(auth.uid())
$f$;
REVOKE ALL ON FUNCTION public.system_health_allowed() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.system_health_get()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r public.system_health_cache%ROWTYPE;
BEGIN
  IF NOT public.system_health_allowed() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  SELECT * INTO r FROM public.system_health_cache WHERE id = 1;
  RETURN jsonb_build_object('checked_at', r.checked_at, 'requested_at', r.requested_at,
    'pending', r.requested_at IS NOT NULL AND (r.checked_at IS NULL OR r.checked_at < r.requested_at),
    'error', r.refresh_error, 'took_ms', r.took_ms, 'result', r.result);
END $function$;

CREATE OR REPLACE FUNCTION public.system_health_request()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_req timestamptz;
BEGIN
  IF NOT public.system_health_allowed() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  UPDATE public.system_health_cache SET requested_at =
    CASE WHEN requested_at IS NOT NULL AND (checked_at IS NULL OR checked_at < requested_at) THEN requested_at ELSE now() END
   WHERE id = 1 RETURNING requested_at INTO v_req;
  RETURN jsonb_build_object('requested_at', v_req);
END $function$;

REVOKE ALL ON FUNCTION public.system_checks_get(), public.system_checks_request(), public.system_health_get(), public.system_health_request() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_checks_get(), public.system_checks_request(), public.system_health_get(), public.system_health_request() TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('system_checks_get', '0233', 'admin: saved integrity audit + books reconciliation of own company (read only)'),
  ('system_checks_request', '0233', 'admin: ask the background job for a fresh integrity run'),
  ('system_health_get', '0233', 'platform owner: saved system_health_check result (read only)'),
  ('system_health_request', '0233', 'platform owner: ask the background job for a fresh platform check')
ON CONFLICT DO NOTHING;

-- the requests job (every minute) — skipped quickly when nothing was asked
DO $j$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'system-checks-requests';
  PERFORM cron.schedule('system-checks-requests', '* * * * *', 'SELECT public.system_checks_run_requested();');
END
$j$;
