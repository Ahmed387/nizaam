-- 0102 — pg_cron could not log (so could not run) any job on «New Nizam» (kkfiplnucefytutlwaiz)
--
-- Why: the move copied cron.job_run_details (40,979 old rows, runid up to 41,006) but cron.runid_seq
-- started again from 1. Every new run asked for runid 11, 12, 13 … which already existed → duplicate key,
-- the run was never recorded and the launcher restarted. Seen 2026-10-23: 10 jobs active, 0 runs since 0101.
--
-- Fix: the postgres role has no right on cron.runid_seq (owned by supabase_admin), so the sequence cannot be
-- moved. Instead the OLD history rows are renumbered to negative runids (runid → -runid). Nothing is deleted:
-- the history stays readable (ORDER BY start_time), and new runs get the free positive numbers.
-- No job and no business row changes.

UPDATE cron.job_run_details SET runid = -runid WHERE runid > 0 AND start_time < '2026-10-23';
-- one stale «connecting» row from the old project (start_time NULL, runid 39678)
UPDATE cron.job_run_details SET runid = -runid WHERE runid > 0 AND start_time IS NULL AND status = 'connecting' AND runid > 1000;

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job_run_details WHERE runid > 0 AND start_time < '2026-10-23') THEN
    RAISE EXCEPTION '0102: old cron history still holds positive runids';
  END IF;
END
$check$;
