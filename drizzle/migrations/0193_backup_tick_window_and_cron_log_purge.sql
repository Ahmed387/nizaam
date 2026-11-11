-- 0193: owner 2026-11-11 «تشتغل كل دقيقة، وفي أول 3 ساعات بعد بداية النسخة بس … وأمسح معاها سجل المهام القديم. نفذ».
-- `nizam-backup-tick` drives the nightly backup that `nizam-backup-start` opens at 00:30 UTC (3 tables per tick, 135 parts,
-- a run is failed after 3 hours). Every 15 seconds = 5,760 runs a day, almost all with nothing to do, and 149,083 rows in
-- cron.job_run_details. Now: every minute between 00:00 and 03:59 UTC (240 runs a day; 135 parts need about 45 ticks).
-- Nothing else starts a backup run. A daily job keeps one week of cron history. Rows older than 7 days are removed now.
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'nizam-backup-tick'), schedule := '* 0-3 * * *');
SELECT cron.schedule('nizam-purge-cron-log', '50 3 * * *', $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';$$);
DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';
