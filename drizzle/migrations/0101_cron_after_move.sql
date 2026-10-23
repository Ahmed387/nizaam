-- 0101 — Scheduled jobs again on «New Nizam» (kkfiplnucefytutlwaiz)
--
-- Why: the move to the new project copied the data but not pg_cron's jobs, so since 2026-10-18 nothing ran:
-- no nightly backup (last one 2026-10-12), integrity cache last refreshed 2026-10-17, no overdue
-- instalments, no alerts, no weekly reports. settings.project_url still pointed at the old project.
--
-- Same jobs and times as 0064 + 0077 (times are UTC; Cairo = UTC+3 now). Edge-function jobs authenticate
-- with the tokens already in public.system_cron_tokens (nizam_cron_call). Idempotent.

UPDATE public.settings
   SET value = to_jsonb('https://kkfiplnucefytutlwaiz.supabase.co'::text)
 WHERE key = 'project_url';

DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobname FROM cron.job WHERE jobname IN (
    'nizam-mark-overdue-installments', 'generate-weekly-reports', 'generate-alerts-hourly', 'nizam-detect-anomalies',
    'nizam-cycle-counts', 'nizam-regression-checks', 'purge-ai-ask-log-daily', 'nizam-backup-start', 'nizam-backup-tick',
    'integrity-cache')
  LOOP
    PERFORM cron.unschedule(j.jobname);
  END LOOP;
END $$;

SELECT cron.schedule('nizam-mark-overdue-installments', '10 1 * * *',  $$SELECT public.nizam_cron_call('mark-overdue-installments');$$);
SELECT cron.schedule('generate-weekly-reports',         '0 6 * * 0',   $$SELECT public.nizam_cron_call('generate-scheduled-reports');$$);
SELECT cron.schedule('generate-alerts-hourly',          '5 * * * *',   $$SELECT public.generate_alerts();$$);
SELECT cron.schedule('nizam-detect-anomalies',          '0 6 * * *',   $$SELECT public.detect_anomalies();$$);
SELECT cron.schedule('nizam-cycle-counts',              '30 6 * * *',  $$SELECT public.enforce_cycle_counts();$$);
SELECT cron.schedule('nizam-regression-checks',         '0 3 * * *',   $$SELECT public.run_regression_checks('cron');$$);
SELECT cron.schedule('purge-ai-ask-log-daily',          '15 3 * * *',  $$SELECT public.purge_ai_ask_log();$$);
SELECT cron.schedule('nizam-backup-start',              '30 0 * * *',  $$SELECT public.nizam_backup_start();$$);
SELECT cron.schedule('nizam-backup-tick',               '15 seconds',  $$SELECT public.nizam_backup_tick();$$);
SELECT cron.schedule('integrity-cache',                 '20 * * * *',  $$SELECT public.system_integrity_refresh_all();$$);

DO $check$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE active) < 10 THEN
    RAISE EXCEPTION '0101: expected 10 active cron jobs';
  END IF;
  IF (SELECT value #>> '{}' FROM public.settings WHERE key = 'project_url' LIMIT 1) <> 'https://kkfiplnucefytutlwaiz.supabase.co' THEN
    RAISE EXCEPTION '0101: project_url not updated';
  END IF;
END
$check$;
