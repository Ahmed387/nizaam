-- 0225 — status card of «الفواتير الإلكترونية الواردة» (owner 2026-11-15 «سطر آخر سحب والسحب الجاي، زرار اسحب دلوقتي بحد،
-- رسالة لو السحب وقف أو فشل … اه ضيفهم»). Read only. eta_settings_get also returns:
--   * next_sync_at   — the next run of the hourly job «eta-sync-hourly» (its minute is read from cron.job; 7 if missing);
--   * manual_ready_at — when «اسحب دلوقتي» may be pressed again (eta_sync_now allows one every 2 minutes).
-- Example 2026-11-15 10:25 Cairo: last pull 10:07, next 11:07.
CREATE OR REPLACE FUNCTION public.eta_settings_get()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; s record; v_min int; v_next timestamptz;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM eta_settings WHERE tenant_id = v_t;
  BEGIN
    SELECT CASE WHEN split_part(schedule, ' ', 1) ~ '^\d+$' THEN split_part(schedule, ' ', 1)::int END INTO v_min
      FROM cron.job WHERE jobname = 'eta-sync-hourly' AND active LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_min := NULL;
  END;
  v_next := date_trunc('hour', now()) + make_interval(mins => coalesce(v_min, 7));
  IF v_next <= now() THEN v_next := v_next + interval '1 hour'; END IF;
  RETURN jsonb_build_object('client_id', s.client_id, 'has_secret', s.secret_id IS NOT NULL, 'env', COALESCE(s.env, 'prod'),
    'enabled', COALESCE(s.enabled, false), 'last_sync_at', s.last_sync_at, 'synced_until', s.synced_until, 'last_error', s.last_error,
    'connection_ok_at', s.connection_ok_at, 'connection_checked_at', s.connection_checked_at, 'connection_error', s.connection_error,
    'is_owner', public.is_owner(auth.uid()),
    'unseen', (SELECT count(*) FROM eta_documents d WHERE d.tenant_id = v_t AND d.seen_at IS NULL),
    'documents', (SELECT count(*) FROM eta_documents d WHERE d.tenant_id = v_t),
    'next_sync_at', CASE WHEN COALESCE(s.enabled, false) THEN v_next END,
    'manual_ready_at', s.last_manual_at + interval '2 minutes');
END
$function$;
