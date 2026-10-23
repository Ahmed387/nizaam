-- 0105 — Nightly backup: smaller pieces for the biggest tables, 3 requests at a time
--
-- Why: with 0104, journal_entries pieces (~10k rows) passed, but journal_entry_lines pieces (~21k rows)
-- still hit «WORKER_RESOURCE_LIMIT» / «IDLE_TIMEOUT (150s)» while 6 ran at once (2026-10-23 run d621d299).
--
-- What: a big table (uuid id, > 100k rows) is split into ≈ 5,000-row pieces: 16 / 32 / 64 / 128 / 256 pieces
-- (power of two) by the first TWO hex digits of the id. Piece name «<table>#<lo>-<hi>» (hi empty = to the end),
-- file tables/<table>.<lo>.json.gz. nizam_backup_tick sends 3 parts at a time instead of 6.
-- Read-only on business data. backup_fetch_range is service_role only.

DROP FUNCTION IF EXISTS public.backup_fetch_range(text, uuid, text, uuid, int);

CREATE OR REPLACE FUNCTION public.backup_part_list()
RETURNS TABLE(table_name text, ord int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH m AS (
    SELECT m.table_name, m.ord,
           CASE WHEN c.reltuples > 100000 AND EXISTS (
                  SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'id'
                     AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype)
                THEN least(256, greatest(16, (2 ^ ceil(log(2, greatest(c.reltuples, 1)::numeric / 5000)))::int))
           END AS pieces
      FROM public.backup_table_manifest() m
      JOIN pg_class c ON c.relname = m.table_name AND c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  )
  SELECT CASE WHEN m.pieces IS NULL THEN m.table_name
              ELSE m.table_name || '#' || lpad(to_hex(i * (256 / m.pieces)), 2, '0') || '-' ||
                   CASE WHEN i = m.pieces - 1 THEN '' ELSE lpad(to_hex((i + 1) * (256 / m.pieces)), 2, '0') END
         END, m.ord
    FROM m
    LEFT JOIN LATERAL generate_series(0, m.pieces - 1) i ON m.pieces IS NOT NULL
   ORDER BY m.ord, 1;
$$;

CREATE OR REPLACE FUNCTION public.backup_fetch_range(_table text, _tenant uuid, _lo text, _hi text, _after uuid, _limit int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE cond text; res jsonb; v_lo uuid; v_hi uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname = _table) THEN
    RAISE EXCEPTION 'جدول غير معروف: %', _table;
  END IF;
  IF _lo IS NULL OR _lo !~ '^[0-9a-f]{2}$' OR (coalesce(_hi, '') <> '' AND _hi !~ '^[0-9a-f]{2}$') THEN
    RAISE EXCEPTION 'جزء غير صالح: %-%', _lo, _hi;
  END IF;
  IF _limit IS NULL OR _limit < 1 OR _limit > 5000 THEN RAISE EXCEPTION 'حد غير صالح'; END IF;

  cond := public.backup_tenant_filter(_table, 'x', 0);
  IF cond = 'false' THEN cond := 'true'; END IF;   -- same rule as backup_fetch_page

  v_lo := (_lo || '000000-0000-0000-0000-000000000000')::uuid;
  v_hi := CASE WHEN coalesce(_hi, '') = '' THEN NULL ELSE (_hi || '000000-0000-0000-0000-000000000000')::uuid END;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(s.r) ORDER BY (s.r).id), ''[]''::jsonb)
       FROM (SELECT x AS r FROM public.%I x
              WHERE %s AND x.id >= $2 AND ($3 IS NULL OR x.id < $3) AND ($4 IS NULL OR x.id > $4)
              ORDER BY x.id LIMIT %s) s',
    _table, cond, _limit
  ) INTO res USING _tenant, v_lo, v_hi, _after;
  RETURN COALESCE(res, '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.backup_part_list() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backup_fetch_range(text, uuid, text, text, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backup_part_list() TO service_role;
GRANT EXECUTE ON FUNCTION public.backup_fetch_range(text, uuid, text, text, uuid, int) TO service_role;

-- 3 parts at a time (was 6). Body otherwise unchanged.
CREATE OR REPLACE FUNCTION public.nizam_backup_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
DECLARE
  r record; p record; v_req bigint; v_inflight int; v_resp record; v_counts jsonb;
  c_parallel constant int := 3;
BEGIN
  FOR r IN SELECT * FROM public.backup_cron_runs WHERE status IN ('running','finalizing') LOOP
    IF now() - r.started_at > interval '3 hours' THEN
      UPDATE public.backup_cron_runs SET status = 'failed', error = 'انتهى الوقت (3 ساعات)', finished_at = now() WHERE id = r.id;
      CONTINUE;
    END IF;

    IF r.status = 'running' THEN
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

    ELSE
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
END $function$;

DO $check$
BEGIN
  IF (SELECT count(*) FROM public.backup_part_list() WHERE table_name LIKE 'journal_entry_lines#%') < 64 THEN
    RAISE EXCEPTION '0105: journal_entry_lines should be in at least 64 pieces';
  END IF;
  IF EXISTS (SELECT 1 FROM public.security_exposed_definer_functions()) THEN
    RAISE EXCEPTION '0105: a definer function is exposed to the browser';
  END IF;
END $check$;
