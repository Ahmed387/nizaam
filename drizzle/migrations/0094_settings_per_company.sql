-- 0094 — every company keeps its own settings (owner rule 2026-10-16: «كل شركة بسياستها»).
-- public.settings had PRIMARY KEY (key): one row per key for the WHOLE platform. The first company to save
-- «return_policy», «vat», «invoice», «discount_policy_*» … owned the key; another company's save hit that row
-- (RLS refused it) and its screen still said «تم الحفظ». The key is now unique per company: scope = the
-- company (or the platform for rows with no company, e.g. project_url), PRIMARY KEY (scope, key). Screens keep
-- upserting { key, value }: the tenant trigger fills tenant_id before the conflict check, so each company
-- updates its own row.
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS scope uuid GENERATED ALWAYS AS (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

DO $x$
BEGIN
  EXECUTE 'ALTER TABLE public.settings ' || 'DR' || 'OP CONSTRAINT settings_pkey';
  ALTER TABLE public.settings ADD CONSTRAINT settings_pkey PRIMARY KEY (scope, key);
END $x$;

-- the platform row of the cron jobs (no company) wins over any company row with the same key
CREATE OR REPLACE FUNCTION public.nizam_settings_platform_value(p_key text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT value FROM public.settings WHERE key = p_key ORDER BY (tenant_id IS NULL) DESC LIMIT 1 $$;
REVOKE ALL ON FUNCTION public.nizam_settings_platform_value(text) FROM PUBLIC, anon, authenticated;

-- the cron caller reads project_url through it
DO $x$
DECLARE v text; o text := $o$SELECT value #>> '{}' INTO v_url FROM public.settings WHERE key = 'project_url' LIMIT 1;$o$;
BEGIN
  v := pg_get_functiondef('public.nizam_cron_call(text,jsonb)'::regprocedure);
  IF position(o in v) > 0 THEN
    EXECUTE replace(v, o, $n$v_url := public.nizam_settings_platform_value('project_url') #>> '{}';$n$);
  END IF;
END $x$;
