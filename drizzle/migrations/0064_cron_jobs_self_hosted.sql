-- 0064 — Scheduled jobs on the self-hosted Supabase project (pg_cron + pg_net).
-- * Each edge-function job authenticates with a random token kept in public.system_cron_tokens
--   (service-role only). The edge function compares the x-cron-secret header with the same row,
--   so no secret is typed anywhere and nothing is hard-coded in the migration.
-- * The project URL is read from public.settings('project_url') — set once per environment.
-- Idempotent: re-running replaces the jobs.
-- Before running on a new environment:  INSERT INTO public.settings(key, value) VALUES ('project_url', to_jsonb('https://<ref>.supabase.co'::text)) ON CONFLICT (key) DO UPDATE SET value = excluded.value;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

INSERT INTO public.system_cron_tokens(name, token)
SELECT n, encode(extensions.gen_random_bytes(32), 'hex')
FROM unnest(ARRAY['scheduled-backup','mark-overdue-installments','generate-scheduled-reports']) n
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.nizam_cron_call(p_function text, p_body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url   text;
  v_token text;
BEGIN
  SELECT value #>> '{}' INTO v_url FROM public.settings WHERE key = 'project_url' LIMIT 1;
  IF v_url IS NULL THEN
    RAISE EXCEPTION 'settings.project_url is not set';
  END IF;
  SELECT token INTO v_token FROM public.system_cron_tokens WHERE name = p_function;
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'no cron token for %', p_function;
  END IF;
  RETURN net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/' || p_function,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_token),
    body := coalesce(p_body, '{}'::jsonb),
    timeout_milliseconds := 300000
  );
END;
$$;
REVOKE ALL ON FUNCTION public.nizam_cron_call(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nizam_cron_call(text, jsonb) TO service_role;

DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobname FROM cron.job WHERE jobname IN (
    'nizam-scheduled-backup','nizam-backup-start','nizam-backup-tick','nizam-mark-overdue-installments','generate-weekly-reports',
    'generate-alerts-hourly','nizam-detect-anomalies','nizam-cycle-counts','nizam-regression-checks','purge-ai-ask-log-daily')
  LOOP
    PERFORM cron.unschedule(j.jobname);
  END LOOP;
END $$;

-- times are UTC (Cairo = UTC+2/+3)
SELECT cron.schedule('nizam-mark-overdue-installments', '10 1 * * *', $$SELECT public.nizam_cron_call('mark-overdue-installments');$$);
SELECT cron.schedule('generate-weekly-reports',         '0 6 * * 0',  $$SELECT public.nizam_cron_call('generate-scheduled-reports');$$);
SELECT cron.schedule('generate-alerts-hourly',          '5 * * * *',  $$SELECT public.generate_alerts();$$);
SELECT cron.schedule('nizam-detect-anomalies',          '0 6 * * *',  $$SELECT public.detect_anomalies();$$);
SELECT cron.schedule('nizam-cycle-counts',              '30 6 * * *', $$SELECT public.enforce_cycle_counts();$$);
SELECT cron.schedule('nizam-regression-checks',         '0 3 * * *',  $$SELECT public.run_regression_checks('cron');$$);
SELECT cron.schedule('purge-ai-ask-log-daily',          '15 3 * * *', $$SELECT public.purge_ai_ask_log();$$);

-- ─────────────────────────────────────────────────────────────────────────────
-- Nightly backup driven from the database, one table per edge-function call.
-- A single "full" call runs out of edge-function memory/CPU (WORKER_RESOURCE_LIMIT) on this
-- data size, so pg_cron drives the function's existing staged mode: part (one table) × N, then
-- finalize (builds the .tar from the staged files). Up to 6 parts run at once; a tick every
-- 15 seconds collects the answers from net._http_response and sends the next ones.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.backup_cron_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','finalizing','done','failed')),
  error text,
  finalize_request bigint,
  finalize_sent_at timestamptz,
  finalize_tries int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.backup_cron_parts (
  run_id uuid NOT NULL REFERENCES public.backup_cron_runs(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  ord int NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','done','error')),
  request_id bigint,
  sent_at timestamptz,
  tries int NOT NULL DEFAULT 0,
  rows_count bigint,
  last_error text,
  PRIMARY KEY (run_id, table_name)
);
ALTER TABLE public.backup_cron_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_cron_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_cron_runs, public.backup_cron_parts FROM anon, authenticated;
GRANT ALL ON public.backup_cron_runs, public.backup_cron_parts TO service_role;

CREATE OR REPLACE FUNCTION public.nizam_backup_start()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; v_run uuid; n int := 0;
BEGIN
  FOR t IN SELECT id FROM public.tenants WHERE coalesce(is_suspended, false) = false LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.backup_cron_runs WHERE tenant_id = t.id AND status IN ('running','finalizing'));
    INSERT INTO public.backup_cron_runs(tenant_id) VALUES (t.id) RETURNING id INTO v_run;
    INSERT INTO public.backup_cron_parts(run_id, table_name, ord)
    SELECT v_run, m.table_name, m.ord FROM public.backup_table_manifest() m;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.nizam_backup_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net AS $$
DECLARE
  r record; p record; v_req bigint; v_inflight int; v_resp record; v_counts jsonb;
  c_parallel constant int := 6;
BEGIN
  FOR r IN SELECT * FROM public.backup_cron_runs WHERE status IN ('running','finalizing') LOOP
    IF now() - r.started_at > interval '3 hours' THEN
      UPDATE public.backup_cron_runs SET status = 'failed', error = 'انتهى الوقت (3 ساعات)', finished_at = now() WHERE id = r.id;
      CONTINUE;
    END IF;

    IF r.status = 'running' THEN
      -- collect answers of the parts already sent
      UPDATE public.backup_cron_parts bp
         SET status     = CASE WHEN x.status_code = 200 THEN 'done' ELSE 'error' END,
             rows_count = CASE WHEN x.status_code = 200 THEN nullif(x.content::jsonb ->> 'rows', '')::bigint END,
             last_error = CASE WHEN x.status_code = 200 THEN NULL ELSE left(coalesce(x.error_msg, x.content::text, 'HTTP ' || x.status_code), 500) END
        FROM net._http_response x
       WHERE bp.run_id = r.id AND bp.status = 'sent' AND x.id = bp.request_id;
      UPDATE public.backup_cron_parts SET status = 'error', last_error = 'لا يوجد رد خلال 6 دقائق'
       WHERE run_id = r.id AND status = 'sent' AND sent_at < now() - interval '6 minutes';

      IF EXISTS (SELECT 1 FROM public.backup_cron_parts WHERE run_id = r.id AND status = 'error' AND tries >= 3) THEN
        UPDATE public.backup_cron_runs SET status = 'failed', finished_at = now(),
               error = (SELECT string_agg(table_name || ': ' || coalesce(last_error, ''), ' | ') FROM public.backup_cron_parts
                         WHERE run_id = r.id AND status = 'error' AND tries >= 3)
         WHERE id = r.id;
        CONTINUE;
      END IF;
      UPDATE public.backup_cron_parts SET status = 'pending' WHERE run_id = r.id AND status = 'error';

      SELECT count(*) INTO v_inflight FROM public.backup_cron_parts WHERE run_id = r.id AND status = 'sent';
      FOR p IN SELECT table_name FROM public.backup_cron_parts WHERE run_id = r.id AND status = 'pending'
               ORDER BY ord LIMIT greatest(0, c_parallel - v_inflight) LOOP
        v_req := public.nizam_cron_call('scheduled-backup', jsonb_build_object(
          'tenant_id', r.tenant_id, 'mode', 'part', 'job_id', r.job_id::text, 'table', p.table_name));
        UPDATE public.backup_cron_parts SET status = 'sent', request_id = v_req, sent_at = now(), tries = tries + 1
         WHERE run_id = r.id AND table_name = p.table_name;
      END LOOP;

      IF NOT EXISTS (SELECT 1 FROM public.backup_cron_parts WHERE run_id = r.id AND status <> 'done') THEN
        SELECT jsonb_object_agg(table_name, coalesce(rows_count, 0)) INTO v_counts FROM public.backup_cron_parts WHERE run_id = r.id;
        v_req := public.nizam_cron_call('scheduled-backup', jsonb_build_object(
          'tenant_id', r.tenant_id, 'mode', 'finalize', 'job_id', r.job_id::text, 'counts', v_counts));
        UPDATE public.backup_cron_runs SET status = 'finalizing', finalize_request = v_req, finalize_sent_at = now(),
               finalize_tries = finalize_tries + 1 WHERE id = r.id;
      END IF;

    ELSE -- finalizing
      SELECT * INTO v_resp FROM net._http_response WHERE id = r.finalize_request;
      IF FOUND AND v_resp.status_code = 200 THEN
        UPDATE public.backup_cron_runs SET status = 'done', finished_at = now() WHERE id = r.id;
      ELSIF (FOUND AND coalesce(v_resp.status_code, 0) <> 200) OR r.finalize_sent_at < now() - interval '10 minutes' THEN
        IF r.finalize_tries >= 2 THEN
          UPDATE public.backup_cron_runs SET status = 'failed', finished_at = now(),
                 error = 'finalize: ' || left(coalesce(v_resp.error_msg, v_resp.content::text, 'لا يوجد رد'), 500) WHERE id = r.id;
        ELSE
          SELECT jsonb_object_agg(table_name, coalesce(rows_count, 0)) INTO v_counts FROM public.backup_cron_parts WHERE run_id = r.id;
          v_req := public.nizam_cron_call('scheduled-backup', jsonb_build_object(
            'tenant_id', r.tenant_id, 'mode', 'finalize', 'job_id', r.job_id::text, 'counts', v_counts));
          UPDATE public.backup_cron_runs SET finalize_request = v_req, finalize_sent_at = now(), finalize_tries = finalize_tries + 1 WHERE id = r.id;
        END IF;
      END IF;
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.nizam_backup_start(), public.nizam_backup_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nizam_backup_start(), public.nizam_backup_tick() TO service_role;

SELECT cron.schedule('nizam-backup-start', '30 0 * * *',  $$SELECT public.nizam_backup_start();$$);
SELECT cron.schedule('nizam-backup-tick',  '15 seconds',  $$SELECT public.nizam_backup_tick();$$);
