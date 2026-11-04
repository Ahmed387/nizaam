-- 0152: the nightly backup on the free plan (owner 2026-11-04 «أعدّل النسخة الليلية بحيث تتقسم لكذا ملف … نفذ بس الملفات
-- دي في الاخر عاوزك تجمعها في فولدر واحد»). The staged parts (one small .json.gz per table / piece, made by
-- `scheduled-backup` mode part) are no longer packed into one .tar (55 MB > the 50 MB upload limit): the new edge function
-- `backup-folder` moves them into ONE folder «<tenant>/backup-<stamp>/» + manifest.json; `system_backups.storage_path`
-- ends with «/» for a folder. `restore-system-backup` reads folders, the backup screen downloads one as a single .zip.
-- Here: the job's token for `backup-folder`, the tick sends «finalize» there, and the nightly start is switched on again.
INSERT INTO public.system_cron_tokens (name, token)
VALUES ('backup-folder', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (name) DO NOTHING;

DO $mig$
DECLARE d text := pg_get_functiondef('public.nizam_backup_tick()'::regprocedure); n text;
BEGIN
  IF position('backup-folder' IN d) > 0 THEN RETURN; END IF;
  n := regexp_replace(d, $re$nizam_cron_call\('scheduled-backup', (jsonb_build_object\(\s*'tenant_id', r\.tenant_id, 'mode', 'finalize')$re$,
                      $rp$nizam_cron_call('backup-folder', \1$rp$, 'g');
  IF (length(n) - length(replace(n, 'backup-folder', ''))) / length('backup-folder') <> 2 THEN
    RAISE EXCEPTION '0152: nizam_backup_tick not the expected version';
  END IF;
  EXECUTE n;
END
$mig$;

SELECT cron.alter_job(jobid, active := true) FROM cron.job WHERE jobname = 'nizam-backup-start';
