-- 0276 (owner «نفذ» 2026-11-19): instalments were removed on 2026-11-14 («يتشالوا»), so the nightly job that marks
-- overdue instalments has nothing to do. Remove it. Plan rows stay as data; nothing else changes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nizam-mark-overdue-installments') THEN
    PERFORM cron.unschedule('nizam-mark-overdue-installments');
  END IF;
END $$;
