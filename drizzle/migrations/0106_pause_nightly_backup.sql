-- 0106 — Pause the nightly backup (owner decision 2026-10-24: «أسيبها دلوقتي»)
--
-- Why: the full archive is 55 MB, above the free plan's 50 MB upload limit, and building it hits the edge
-- worker's resource limit. Every night it would fail and leave ~55 MB of staged pieces in storage.
-- Resume with: SELECT cron.alter_job(jobid, active := true) FROM cron.job WHERE jobname = 'nizam-backup-start';
-- once the owner picks Supabase Pro (daily managed backups) or an external pg_dump.

SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'nizam-backup-start';
