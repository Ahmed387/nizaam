-- 0238 — Pages each user opened, the owner's daily activity report on Telegram, and how long «سجل العمليات» is kept
-- (owner 2026-11-16: «اخر كل يوم كل شخص في السيستم عمل ايه ودخل شاف ايه … PDF»، «11.15 باليل»، «مفيش نشاط ميتبعتش»،
--  «صاحب المنصة هوا اللي يحدد»، «مقسوم بالفرع»، retention «default اسبوعيا وصاحب المنصة ممكن يغيرها لكل شركة»،
--  «نمسح على طول»، tax / permission records kept 5 years).
--
-- * `user_page_visits`: ONE row per user × Cairo day × page × branch (first / last time, hits) — `track_page_visit`
--   is called by the browser once per navigation. Never a row per click.
-- * `tenant_ops_settings` (platform owner only, `super_tenant_ops_set`): daily report on / off, days of audit log kept
--   (default 7). A & N: report on.
-- * `daily_activity_report(tenant, day)` (service role) = what each person did (document_events: sales, purchases,
--   returns, vouchers, payments, cancels, edits — with numbers / party / amount), other changes (audit_log rows with a
--   user), and pages opened, grouped by branch. The edge function `telegram` (mode 'daily') turns it into a PDF and
--   sends it to the owner's Telegram; nothing is stored (`daily_report_runs` keeps only sent / error per day).
--   Cron «telegram-daily-report» runs at 20:15 and 21:15 UTC and acts only when Cairo time is 23:10–23:30 (summer time).
-- * Cron «audit-retention» at 00:15 Cairo (after the report): `audit_retention_purge_all()` deletes `audit_log` rows
--   older than each company's days (tax / permission rows: 5 years) and page visits older than the same, in batches.
--   `document_events` («سجل المستندات») is NOT touched.

-- ---------------------------------------------------------------- settings per company (platform owner)
CREATE TABLE IF NOT EXISTS public.tenant_ops_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  daily_report_enabled boolean NOT NULL DEFAULT false,
  audit_retention_days int NOT NULL DEFAULT 7 CHECK (audit_retention_days BETWEEN 1 AND 3650),
  last_purge_at timestamptz,
  last_purge_rows bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.tenant_ops_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_ops_settings FROM anon, authenticated;
INSERT INTO public.tenant_ops_settings (tenant_id, daily_report_enabled)
SELECT id, true FROM public.tenants WHERE id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'
ON CONFLICT DO NOTHING;
INSERT INTO public.tenant_ops_settings (tenant_id) SELECT id FROM public.tenants ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.daily_report_runs (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  day date NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  error text,
  PRIMARY KEY (tenant_id, day)
);
ALTER TABLE public.daily_report_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_report_runs FROM anon, authenticated;

-- ---------------------------------------------------------------- page visits
CREATE TABLE IF NOT EXISTS public.user_page_visits (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  day date NOT NULL,
  page_key text NOT NULL,
  label text NOT NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  hits int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS user_page_visits_uq ON public.user_page_visits (user_id, day, page_key, branch_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS user_page_visits_tenant_day ON public.user_page_visits (tenant_id, day);
ALTER TABLE public.user_page_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_page_visits FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.track_page_visit(p_key text, p_label text, p_branch uuid DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); v_t uuid := public.current_tenant_id(); v_branch uuid := p_branch;
BEGIN
  IF v_uid IS NULL OR v_t IS NULL THEN RETURN; END IF;
  IF p_key IS NULL OR p_key !~ '^[a-z0-9_.:-]{2,80}$' THEN RETURN; END IF;
  IF v_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM branches WHERE id = v_branch AND tenant_id = v_t) THEN v_branch := NULL; END IF;
  INSERT INTO user_page_visits AS v (tenant_id, user_id, day, page_key, label, branch_id)
  VALUES (v_t, v_uid, (now() AT TIME ZONE 'Africa/Cairo')::date, p_key, left(coalesce(NULLIF(btrim(p_label), ''), p_key), 80), v_branch)
  ON CONFLICT (user_id, day, page_key, branch_id) DO UPDATE SET last_at = now(), hits = v.hits + 1, label = EXCLUDED.label;
END $$;

-- ---------------------------------------------------------------- platform owner: per company
CREATE OR REPLACE FUNCTION public.super_tenant_ops_get(p_tenant uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE s record; c record;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM tenant_ops_settings WHERE tenant_id = p_tenant;
  SELECT * INTO c FROM tenant_owner_contact WHERE tenant_id = p_tenant;
  RETURN jsonb_build_object(
    'daily_report_enabled', coalesce(s.daily_report_enabled, false), 'audit_retention_days', coalesce(s.audit_retention_days, 7),
    'last_purge_at', s.last_purge_at, 'last_purge_rows', s.last_purge_rows,
    'tg_linked', c.tg_chat_id IS NOT NULL, 'owner_name', c.owner_name, 'owner_phone', c.owner_phone, 'owner_email', c.owner_email,
    'last_report', (SELECT jsonb_build_object('day', r.day, 'sent_at', r.sent_at, 'error', r.error)
                      FROM daily_report_runs r WHERE r.tenant_id = p_tenant ORDER BY r.day DESC LIMIT 1),
    'audit_rows', (SELECT count(*) FROM audit_log WHERE tenant_id = p_tenant));
END $$;

CREATE OR REPLACE FUNCTION public.super_tenant_ops_set(p_tenant uuid, p_daily_report boolean, p_retention_days int)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  IF p_retention_days IS NULL OR p_retention_days < 1 OR p_retention_days > 3650 THEN
    RAISE EXCEPTION 'مدة الاحتفاظ لازم تكون من يوم لـ 3650 يوم';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN RAISE EXCEPTION 'الشركة مش موجودة'; END IF;
  INSERT INTO tenant_ops_settings (tenant_id, daily_report_enabled, audit_retention_days, updated_by)
  VALUES (p_tenant, coalesce(p_daily_report, false), p_retention_days, auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET daily_report_enabled = EXCLUDED.daily_report_enabled,
     audit_retention_days = EXCLUDED.audit_retention_days, updated_at = now(), updated_by = auth.uid();
  RETURN public.super_tenant_ops_get(p_tenant);
END $$;

-- ---------------------------------------------------------------- the report data (service role)
CREATE OR REPLACE FUNCTION public.daily_activity_report(p_tenant uuid, p_day date)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH b AS (
    SELECT (p_day::timestamp AT TIME ZONE 'Africa/Cairo') AS lo, ((p_day + 1)::timestamp AT TIME ZONE 'Africa/Cairo') AS hi
  ), ev AS (
    SELECT e.user_id, e.branch_id, e.doc_type, e.action, e.at,
           e.snapshot->>'number' AS number, e.snapshot->>'party_name' AS party,
           NULLIF(e.snapshot->>'amount', '')::numeric AS amount
      FROM document_events e, b
     WHERE e.tenant_id = p_tenant AND e.at >= b.lo AND e.at < b.hi AND e.user_id IS NOT NULL
  ), au AS (
    SELECT a.user_id, a.branch_id, a.entity, a.action, count(*) AS n, min(a.created_at) AS fa, max(a.created_at) AS la
      FROM audit_log a, b
     WHERE a.tenant_id = p_tenant AND a.created_at >= b.lo AND a.created_at < b.hi AND a.user_id IS NOT NULL
       AND a.entity NOT IN ('invoices', 'shipments', 'returns', 'purchase_returns', 'vouchers', 'voucher', 'treasury',
                            'invoice_payments', 'payment_transactions', 'payment_plans', 'Invoice', 'audit_log')
     GROUP BY 1, 2, 3, 4
  ), pv AS (
    SELECT v.user_id, v.branch_id, v.label, v.hits, v.first_at, v.last_at
      FROM user_page_visits v WHERE v.tenant_id = p_tenant AND v.day = p_day
  ), keys AS (
    SELECT user_id, branch_id FROM ev UNION SELECT user_id, branch_id FROM au UNION SELECT user_id, branch_id FROM pv
  ), people AS (
    SELECT k.user_id, k.branch_id, coalesce(pr.name, 'مستخدم') AS name,
      (SELECT min(t) FROM (SELECT min(at) t FROM ev WHERE ev.user_id = k.user_id AND ev.branch_id IS NOT DISTINCT FROM k.branch_id
                           UNION ALL SELECT min(first_at) FROM pv WHERE pv.user_id = k.user_id AND pv.branch_id IS NOT DISTINCT FROM k.branch_id
                           UNION ALL SELECT min(fa) FROM au WHERE au.user_id = k.user_id AND au.branch_id IS NOT DISTINCT FROM k.branch_id) z) AS first_at,
      (SELECT max(t) FROM (SELECT max(at) t FROM ev WHERE ev.user_id = k.user_id AND ev.branch_id IS NOT DISTINCT FROM k.branch_id
                           UNION ALL SELECT max(last_at) FROM pv WHERE pv.user_id = k.user_id AND pv.branch_id IS NOT DISTINCT FROM k.branch_id
                           UNION ALL SELECT max(la) FROM au WHERE au.user_id = k.user_id AND au.branch_id IS NOT DISTINCT FROM k.branch_id) z) AS last_at
      FROM keys k LEFT JOIN profiles pr ON pr.id = k.user_id
  ), per_user AS (
    SELECT p.branch_id, jsonb_build_object(
      'user_id', p.user_id, 'name', p.name, 'first_at', p.first_at, 'last_at', p.last_at,
      'docs', coalesce((SELECT jsonb_agg(jsonb_build_object('doc_type', doc_type, 'action', action, 'n', n, 'total', total) ORDER BY n DESC)
                          FROM (SELECT doc_type, action, count(*) n, sum(amount) total FROM ev
                                 WHERE ev.user_id = p.user_id AND ev.branch_id IS NOT DISTINCT FROM p.branch_id GROUP BY 1, 2) d), '[]'::jsonb),
      'items', coalesce((SELECT jsonb_agg(jsonb_build_object('at', at, 'doc_type', doc_type, 'action', action, 'number', number,
                                                             'party', party, 'amount', amount) ORDER BY at)
                          FROM (SELECT * FROM ev WHERE ev.user_id = p.user_id AND ev.branch_id IS NOT DISTINCT FROM p.branch_id
                                 ORDER BY at LIMIT 40) i), '[]'::jsonb),
      'items_total', (SELECT count(*) FROM ev WHERE ev.user_id = p.user_id AND ev.branch_id IS NOT DISTINCT FROM p.branch_id),
      'other', coalesce((SELECT jsonb_agg(jsonb_build_object('entity', entity, 'action', action, 'n', n) ORDER BY n DESC)
                          FROM au WHERE au.user_id = p.user_id AND au.branch_id IS NOT DISTINCT FROM p.branch_id), '[]'::jsonb),
      'pages', coalesce((SELECT jsonb_agg(jsonb_build_object('label', label, 'hits', hits, 'first_at', first_at, 'last_at', last_at) ORDER BY hits DESC)
                          FROM pv WHERE pv.user_id = p.user_id AND pv.branch_id IS NOT DISTINCT FROM p.branch_id), '[]'::jsonb)
    ) AS u, p.first_at
    FROM people p
  )
  SELECT jsonb_build_object(
    'company', (SELECT name FROM tenants WHERE id = p_tenant),
    'day', p_day,
    'has_activity', EXISTS (SELECT 1 FROM ev) OR EXISTS (SELECT 1 FROM au) OR EXISTS (SELECT 1 FROM pv),
    'totals', jsonb_build_object(
      'users', (SELECT count(DISTINCT user_id) FROM keys),
      'documents', (SELECT count(*) FROM ev WHERE action = 'create'),
      'sales_n', (SELECT count(*) FROM ev WHERE doc_type = 'sale' AND action = 'create'),
      'sales_total', (SELECT coalesce(sum(amount), 0) FROM ev WHERE doc_type = 'sale' AND action = 'create'),
      'cancels', (SELECT count(*) FROM ev WHERE action = 'cancel'),
      'edits', (SELECT count(*) FROM ev WHERE action NOT IN ('create', 'cancel', 'payment_add'))),
    'branches', coalesce((
      SELECT jsonb_agg(jsonb_build_object('branch_id', g.branch_id, 'branch', coalesce(br.name, 'على مستوى الشركة'), 'users', g.users)
                       ORDER BY br.name NULLS LAST)
        FROM (SELECT branch_id, jsonb_agg(u ORDER BY first_at) AS users FROM per_user GROUP BY branch_id) g
        LEFT JOIN branches br ON br.id = g.branch_id), '[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.tg_daily_mark(p_tenant uuid, p_day date, p_ok boolean, p_error text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO daily_report_runs (tenant_id, day, sent_at, error) VALUES (p_tenant, p_day, CASE WHEN p_ok THEN now() END, left(p_error, 500))
  ON CONFLICT (tenant_id, day) DO UPDATE SET sent_at = EXCLUDED.sent_at, error = EXCLUDED.error;
  IF p_error IS DISTINCT FROM 'no activity' THEN
    PERFORM public.tg_record_send(p_tenant, p_ok, p_error, 'تقرير نشاط يوم ' || to_char(p_day, 'DD/MM/YYYY'));
  END IF;
END $$;

-- cron at 20:15 and 21:15 UTC: acts only when Cairo is 23:10–23:30 (works in summer and winter time)
CREATE OR REPLACE FUNCTION public.tg_daily_tick()
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_local timestamp := now() AT TIME ZONE 'Africa/Cairo'; v_day date; t record; n int := 0;
BEGIN
  IF v_local::time NOT BETWEEN time '23:10' AND time '23:30' THEN RETURN 0; END IF;
  v_day := v_local::date;
  FOR t IN SELECT s.tenant_id FROM tenant_ops_settings s
             JOIN tenant_owner_contact c ON c.tenant_id = s.tenant_id AND c.tg_chat_id IS NOT NULL
             JOIN tenants tt ON tt.id = s.tenant_id AND NOT coalesce(tt.is_suspended, false)
            WHERE s.daily_report_enabled
              AND NOT EXISTS (SELECT 1 FROM daily_report_runs r WHERE r.tenant_id = s.tenant_id AND r.day = v_day) LOOP
    INSERT INTO daily_report_runs (tenant_id, day) VALUES (t.tenant_id, v_day) ON CONFLICT DO NOTHING;
    PERFORM public.nizam_cron_call('telegram', jsonb_build_object('mode', 'daily', 'tenant_id', t.tenant_id, 'day', v_day));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- ---------------------------------------------------------------- retention
CREATE OR REPLACE FUNCTION public.audit_retention_purge(p_tenant uuid)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_days int; v_cut timestamptz; v_keep timestamptz := now() - interval '5 years'; v_n bigint := 0; v_step bigint;
BEGIN
  SELECT audit_retention_days INTO v_days FROM tenant_ops_settings WHERE tenant_id = p_tenant;
  v_days := coalesce(v_days, 7);
  -- keep the last N whole Cairo days (today included)
  v_cut := (((now() AT TIME ZONE 'Africa/Cairo')::date - (v_days - 1))::timestamp AT TIME ZONE 'Africa/Cairo');
  PERFORM set_config('app.allow_hard_delete', 'on', true);
  LOOP
    DELETE FROM audit_log WHERE id IN (
      SELECT id FROM audit_log
       WHERE tenant_id = p_tenant AND created_at < v_cut
         AND (created_at < v_keep OR NOT (
               entity ILIKE ANY (ARRAY['user_roles', 'user_permissions', 'role_permissions', 'permission_templates',
                                       'user_company_roles', 'tenant_role_settings', 'branch_users', 'eta%'])
            OR action ILIKE '%permission%'))
       LIMIT 5000);
    GET DIAGNOSTICS v_step = ROW_COUNT;
    v_n := v_n + v_step;
    EXIT WHEN v_step < 5000 OR v_n >= 500000;
  END LOOP;
  PERFORM set_config('app.allow_hard_delete', '', true);
  DELETE FROM user_page_visits WHERE tenant_id = p_tenant AND day < (now() AT TIME ZONE 'Africa/Cairo')::date - (greatest(v_days, 2) - 1);
  UPDATE tenant_ops_settings SET last_purge_at = now(), last_purge_rows = v_n WHERE tenant_id = p_tenant;
  RETURN v_n;
END $$;

-- cron at 21:15 and 22:15 UTC: acts only between 00:00 and 00:45 Cairo (after the 23:15 report)
CREATE OR REPLACE FUNCTION public.audit_retention_purge_all()
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE t record; n bigint := 0;
BEGIN
  IF (now() AT TIME ZONE 'Africa/Cairo')::time NOT BETWEEN time '00:00' AND time '00:45' THEN RETURN 0; END IF;
  FOR t IN SELECT tenant_id FROM tenant_ops_settings LOOP
    n := n + public.audit_retention_purge(t.tenant_id);
  END LOOP;
  RETURN n;
END $$;

-- new companies get their row
CREATE OR REPLACE FUNCTION public.tenant_ops_settings_default()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN INSERT INTO tenant_ops_settings (tenant_id) VALUES (NEW.id) ON CONFLICT DO NOTHING; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS zz_tenant_ops_settings_default ON public.tenants;
CREATE TRIGGER zz_tenant_ops_settings_default AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenant_ops_settings_default();

-- ---------------------------------------------------------------- privileges
REVOKE ALL ON FUNCTION public.track_page_visit(text, text, uuid), public.super_tenant_ops_get(uuid),
  public.super_tenant_ops_set(uuid, boolean, int), public.daily_activity_report(uuid, date),
  public.tg_daily_mark(uuid, date, boolean, text), public.tg_daily_tick(), public.audit_retention_purge(uuid),
  public.audit_retention_purge_all(), public.tenant_ops_settings_default() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_page_visit(text, text, uuid), public.super_tenant_ops_get(uuid),
  public.super_tenant_ops_set(uuid, boolean, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.daily_activity_report(uuid, date), public.tg_daily_mark(uuid, date, boolean, text) TO service_role;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('track_page_visit', '0238', 'one row per user × day × page'),
  ('super_tenant_ops_get', '0238', 'daily report / audit retention per company (super)'),
  ('super_tenant_ops_set', '0238', 'daily report / audit retention per company (super)')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- cron + labels on «مهام أوتوماتيك»
DO $c$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('telegram-daily-report', 'audit-retention');
  PERFORM cron.schedule('telegram-daily-report', '15 20,21 * * *', 'SELECT public.tg_daily_tick()');
  PERFORM cron.schedule('audit-retention', '15 21,22 * * *', 'SELECT public.audit_retention_purge_all()');
END $c$;

DO $l$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.background_jobs_status__all(uuid)'::regprocedure);
  IF strpos(d, 'telegram-send') > 0 THEN RETURN; END IF;
  n := replace(d, $a$    ('job-failure-alerts',$a$,
    $b$    ('telegram-send',              'رسائل تليجرام للفواتير الإلكترونية', 'هتتعاد لوحدها كل 5 دقايق'),
    ('telegram-daily-report',      'تقرير النشاط اليومي على تليجرام',     'هيتعاد بكره الساعة 11:15 بالليل'),
    ('audit-retention',            'مسح سجل العمليات القديم',             'هيتعاد لوحده بكره بالليل'),
    ('job-failure-alerts',$b$);
  IF n = d THEN RAISE EXCEPTION '0238: job labels anchor not found'; END IF;
  EXECUTE n;
END $l$;

DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.security_exposed_definer_functions()) THEN
    RAISE EXCEPTION '0238: exposed definer functions: %', (SELECT string_agg(f::text, ', ') FROM public.security_exposed_definer_functions() f);
  END IF;
END $chk$;
