-- 0234 — background jobs that stop are seen at once (owner 2026-11-16 «كارت في متابعة … وخلي في اشعارات تتبعت»).
-- `background_jobs_status(tenant)`: one row per automatic job — name, last good run, last failure, the error, and
-- whether it is failing now:
--   * pg_cron jobs: the last finished run of each job failed (cron.job_run_details);
--   * nightly backup: the last run of this company failed, or no good backup for > 26 h;
--   * e-invoices (when switched on): the last pull ended with an error, or no pull for > 2 h 10 min;
--   * hourly checks («فحص السيستم»): the last run ended with an error, or none for > 2 h 10 min.
-- `owner_followups` carries `jobs_failing` (the card «مهام أوتوماتيك وقفت»); `notify_job_failures()` (pg_cron
-- «job-failure-alerts», every 15 minutes) sends ONE notification per failure to every owner / admin of the company,
-- and one «رجعت تشتغل» when it works again (state in `job_alert_state`). Read only — nothing is re-run or changed.

CREATE TABLE IF NOT EXISTS public.job_alert_state (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_key text NOT NULL,
  failing_since timestamptz,
  notified_at timestamptz,
  PRIMARY KEY (tenant_id, job_key)
);
ALTER TABLE public.job_alert_state ENABLE ROW LEVEL SECURITY;  -- server only

CREATE OR REPLACE FUNCTION public.background_jobs_status__all(p_tenant uuid)
 RETURNS TABLE(job_key text, label text, last_ok_at timestamptz, last_fail_at timestamptz, error text, failing boolean, advice text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  WITH names(jobname, label, advice) AS (VALUES
    ('integrity-cache',            'فحص السيستم كل ساعة',              'هيتعاد لوحده الساعة الجاية'),
    ('system-checks-requests',     '«افحص دلوقتي» في فحص السيستم',      'هيتعاد لوحده بعد دقيقة'),
    ('nizam-backup-start',         'بداية النسخة الاحتياطية بالليل',    'هتتعاد لوحدها بالليل — لو اتكررت كلّم الدعم'),
    ('nizam-backup-tick',          'تشغيل النسخة الاحتياطية بالليل',    'هتتعاد لوحدها بالليل — لو اتكررت كلّم الدعم'),
    ('eta-sync-hourly',            'سحب الفواتير الإلكترونية',          'هيتعاد لوحده كل ساعة'),
    ('fixed-assets-depreciation',  'قيود الإهلاك',                      'هتتعاد لوحدها بكره'),
    ('generate-alerts-hourly',     'التنبيهات كل ساعة',                 'هتتعاد لوحدها الساعة الجاية'),
    ('generate-weekly-reports',    'التقرير الأسبوعي',                  'هيتعاد الأسبوع الجاي'),
    ('nizam-detect-anomalies',     'فحص الحركات الغريبة',              'هيتعاد لوحده بكره'),
    ('nizam-cycle-counts',         'جدول الجرد الدوري',                 'هيتعاد لوحده بكره'),
    ('nizam-regression-checks',    'فحوصات الصحة الليلية',              'هتتعاد لوحدها بكره'),
    ('nizam-purge-cron-log',       'تنظيف سجل المهام',                  'هيتعاد لوحده بكره'),
    ('purge-ai-ask-log-daily',     'تنظيف سجل «اسألني»',                'هيتعاد لوحده بكره'),
    ('nizam-mark-overdue-installments', 'تعليم الأقساط المتأخرة',        'هيتعاد لوحده بكره'),
    ('job-failure-alerts',         'تنبيهات المهام الأوتوماتيك',         'هتتعاد لوحدها بعد ربع ساعة')
  ),
  cronrows AS (
    SELECT 'cron:' || j.jobname AS job_key, coalesce(n.label, j.jobname) AS label,
           (SELECT max(d.end_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.status = 'succeeded') AS last_ok_at,
           (SELECT max(d.end_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.status = 'failed') AS last_fail_at,
           CASE WHEN l.status = 'failed' THEN l.return_message END AS error,
           (l.status = 'failed') AS failing,
           coalesce(n.advice, 'هتتعاد لوحدها في ميعادها') AS advice
      FROM cron.job j
      LEFT JOIN names n ON n.jobname = j.jobname
      LEFT JOIN LATERAL (SELECT d.status, d.return_message FROM cron.job_run_details d
                          WHERE d.jobid = j.jobid AND d.status IN ('succeeded', 'failed')
                          ORDER BY d.start_time DESC LIMIT 1) l ON true
     WHERE j.active
  ),
  backup AS (
    SELECT 'backup' AS job_key, 'النسخة الاحتياطية (النتيجة)' AS label,
           (SELECT max(finished_at) FROM public.backup_cron_runs WHERE tenant_id = p_tenant AND status = 'done') AS last_ok_at,
           (SELECT max(coalesce(finished_at, started_at)) FROM public.backup_cron_runs WHERE tenant_id = p_tenant AND status = 'failed') AS last_fail_at,
           (SELECT r.error FROM public.backup_cron_runs r WHERE r.tenant_id = p_tenant ORDER BY r.started_at DESC LIMIT 1) AS err,
           (SELECT r.status FROM public.backup_cron_runs r WHERE r.tenant_id = p_tenant ORDER BY r.started_at DESC LIMIT 1) AS last_status
  ),
  backup_row AS (
    SELECT job_key, label, last_ok_at, last_fail_at,
           CASE WHEN last_status = 'failed' THEN coalesce(err, 'النسخة فشلت')
                WHEN last_ok_at IS NULL OR last_ok_at < now() - interval '26 hours' THEN 'مفيش نسخة ناجحة من أكتر من يوم' END AS error,
           (last_status = 'failed' OR last_ok_at IS NULL OR last_ok_at < now() - interval '26 hours') AS failing,
           'افتح «النسخ الاحتياطي» ودوس «تشغيل الآن» — لو فشلت تاني كلّم الدعم' AS advice
      FROM backup
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nizam-backup-start' AND active)
  ),
  eta AS (
    SELECT 'eta' AS job_key, 'الفواتير الإلكترونية (النتيجة)' AS label,
           CASE WHEN e.last_error IS NULL THEN e.last_sync_at END AS last_ok_at,
           CASE WHEN e.last_error IS NOT NULL THEN e.last_sync_at END AS last_fail_at,
           CASE WHEN e.last_error IS NOT NULL THEN e.last_error
                WHEN e.last_sync_at IS NULL OR e.last_sync_at < now() - interval '130 minutes' THEN 'السحب ماشتغلش من أكتر من ساعتين' END AS error,
           (e.last_error IS NOT NULL OR e.last_sync_at IS NULL OR e.last_sync_at < now() - interval '130 minutes') AS failing,
           'افتح «الفواتير الإلكترونية الواردة» — مكتوب هناك تعمل إيه' AS advice
      FROM public.eta_settings e WHERE e.tenant_id = p_tenant AND e.enabled
  ),
  checks AS (
    SELECT 'checks' AS job_key, 'فحص السيستم (النتيجة)' AS label,
           CASE WHEN c.refresh_error IS NULL THEN c.checked_at END AS last_ok_at,
           CASE WHEN c.refresh_error IS NOT NULL THEN c.checked_at END AS last_fail_at,
           CASE WHEN c.refresh_error IS NOT NULL THEN c.refresh_error
                WHEN c.checked_at < now() - interval '130 minutes' THEN 'الفحص ماشتغلش من أكتر من ساعتين' END AS error,
           (c.refresh_error IS NOT NULL OR c.checked_at < now() - interval '130 minutes') AS failing,
           'افتح «فحص السيستم» ودوس «افحص دلوقتي»' AS advice
      FROM public.system_integrity_cache c WHERE c.tenant_id = p_tenant
  )
  SELECT job_key, label, last_ok_at, last_fail_at, error, coalesce(failing, false), advice FROM cronrows
  UNION ALL SELECT job_key, label, last_ok_at, last_fail_at, error, coalesce(failing, false), advice FROM backup_row
  UNION ALL SELECT job_key, label, last_ok_at, last_fail_at, error, coalesce(failing, false), advice FROM eta
  UNION ALL SELECT job_key, label, last_ok_at, last_fail_at, error, coalesce(failing, false), advice FROM checks
$f$;
REVOKE ALL ON FUNCTION public.background_jobs_status__all(uuid) FROM PUBLIC, anon, authenticated;

-- browser: my company's jobs (owner / admin)
CREATE OR REPLACE FUNCTION public.background_jobs_status()
 RETURNS TABLE(job_key text, label text, last_ok_at timestamptz, last_fail_at timestamptz, error text, failing boolean, advice text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT * FROM public.background_jobs_status__all(public.current_tenant_id()) s ORDER BY s.failing DESC, s.label;
END $f$;
REVOKE ALL ON FUNCTION public.background_jobs_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.background_jobs_status() TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('background_jobs_status', '0234', 'owner / admin: automatic jobs of own company and whether one stopped (read only)')
ON CONFLICT DO NOTHING;

-- «متابعة»: add the failing jobs
DO $m$
DECLARE d text; d0 text;
BEGIN
  d := pg_get_functiondef('public.owner_followups()'::regprocedure);
  d0 := d;
  d := replace(d, $o$    'approvals_pending', $o$,
    $o$    'jobs_failing', (SELECT jsonb_build_object('count', count(*), 'labels', coalesce(jsonb_agg(s.label ORDER BY s.label), '[]'::jsonb))
                       FROM public.background_jobs_status__all(v_t) s WHERE s.failing),
    'approvals_pending', $o$);
  IF d = d0 THEN RAISE EXCEPTION '0234: owner_followups text not found'; END IF;
  EXECUTE d;
END
$m$;

-- notifications: one per failure, one when it works again
CREATE OR REPLACE FUNCTION public.notify_job_failures()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE t record; s record; st public.job_alert_state%ROWTYPE; n int := 0;
BEGIN
  FOR t IN SELECT id FROM public.tenants WHERE coalesce(is_suspended, false) = false LOOP
    FOR s IN SELECT * FROM public.background_jobs_status__all(t.id) LOOP
      SELECT * INTO st FROM public.job_alert_state WHERE tenant_id = t.id AND job_key = s.job_key;
      IF s.failing AND (st.tenant_id IS NULL OR st.failing_since IS NULL) THEN
        INSERT INTO public.job_alert_state (tenant_id, job_key, failing_since, notified_at) VALUES (t.id, s.job_key, now(), now())
        ON CONFLICT (tenant_id, job_key) DO UPDATE SET failing_since = now(), notified_at = now();
        INSERT INTO public.notifications (tenant_id, user_id, title, body, type, link, related_entity)
        SELECT t.id, u.user_id, '⚠️ مهمة أوتوماتيك وقفت: ' || s.label,
               coalesce(left(s.error, 300), 'آخر تشغيل فشل') || ' — ' || s.advice, 'job_failed', '/admin/system-health#jobs', 'background_jobs'
          FROM (SELECT DISTINCT ur.user_id FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
                 WHERE p.tenant_id = t.id AND ur.role::text IN ('owner', 'admin')) u;
        n := n + 1;
      ELSIF NOT s.failing AND st.failing_since IS NOT NULL THEN
        UPDATE public.job_alert_state SET failing_since = NULL WHERE tenant_id = t.id AND job_key = s.job_key;
        INSERT INTO public.notifications (tenant_id, user_id, title, body, type, link, related_entity)
        SELECT t.id, u.user_id, '✅ رجعت تشتغل: ' || s.label, 'المهمة اشتغلت تاني من غير مشاكل', 'job_recovered', '/admin/system-health#jobs', 'background_jobs'
          FROM (SELECT DISTINCT ur.user_id FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
                 WHERE p.tenant_id = t.id AND ur.role::text IN ('owner', 'admin')) u;
        n := n + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN n;
END $f$;
REVOKE ALL ON FUNCTION public.notify_job_failures() FROM PUBLIC, anon, authenticated;

DO $j$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'job-failure-alerts';
  PERFORM cron.schedule('job-failure-alerts', '*/15 * * * *', 'SELECT public.notify_job_failures();');
END
$j$;
