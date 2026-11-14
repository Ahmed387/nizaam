-- 0221 — ETA connection wizard in settings (owner 2026-11-15 «ينفعش نعمل في الاعدادات دي للربط … ويكون في رسالة بتوجهنا
-- في كل خطوة … ده saas system يعني اكتر من شركة ممكن تتربط»). Every company connects its OWN ETA account (eta_settings is
-- per tenant since 0220). New: a «اختبار الاتصال» step — the edge function `eta-sync` (mode 'test', called by the signed-in
-- owner / admin) asks the ETA for a token and one search page and records the answer here; the wizard reads it.
ALTER TABLE public.eta_settings
  ADD COLUMN IF NOT EXISTS connection_ok_at timestamptz,
  ADD COLUMN IF NOT EXISTS connection_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS connection_error text;

CREATE OR REPLACE FUNCTION public.eta_record_test(p_tenant uuid, p_ok boolean, p_error text)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  UPDATE eta_settings SET connection_checked_at = now(),
         connection_ok_at = CASE WHEN p_ok THEN now() ELSE NULL END,
         connection_error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 500) END
   WHERE tenant_id = p_tenant
$function$;
REVOKE ALL ON FUNCTION public.eta_record_test(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eta_record_test(uuid, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION public.eta_settings_get()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; s record;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM eta_settings WHERE tenant_id = v_t;
  RETURN jsonb_build_object('client_id', s.client_id, 'has_secret', s.secret_id IS NOT NULL, 'env', COALESCE(s.env, 'prod'),
    'enabled', COALESCE(s.enabled, false), 'last_sync_at', s.last_sync_at, 'synced_until', s.synced_until, 'last_error', s.last_error,
    'connection_ok_at', s.connection_ok_at, 'connection_checked_at', s.connection_checked_at, 'connection_error', s.connection_error,
    'is_owner', public.is_owner(auth.uid()),
    'unseen', (SELECT count(*) FROM eta_documents d WHERE d.tenant_id = v_t AND d.seen_at IS NULL),
    'documents', (SELECT count(*) FROM eta_documents d WHERE d.tenant_id = v_t));
END
$function$;

-- changing the Client ID / Secret / environment needs a new test; switching on needs a passed test
CREATE OR REPLACE FUNCTION public.eta_save_settings(p_client_id text, p_client_secret text, p_env text, p_enabled boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $function$
DECLARE v_t uuid; s record; v_changed boolean;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'بيانات الربط مع الضرائب للمالك بس' USING ERRCODE = '42501'; END IF;
  IF p_env NOT IN ('prod', 'preprod') THEN RAISE EXCEPTION 'البيئة غلط'; END IF;
  INSERT INTO eta_settings (tenant_id) VALUES (v_t) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM eta_settings WHERE tenant_id = v_t FOR UPDATE;
  v_changed := NULLIF(btrim(p_client_secret), '') IS NOT NULL
               OR NULLIF(btrim(p_client_id), '') IS DISTINCT FROM s.client_id OR p_env IS DISTINCT FROM s.env;
  IF NULLIF(btrim(p_client_secret), '') IS NOT NULL THEN
    IF s.secret_id IS NULL THEN
      s.secret_id := vault.create_secret(btrim(p_client_secret), 'eta_secret_' || v_t::text, 'ETA client secret');
    ELSE
      PERFORM vault.update_secret(s.secret_id, btrim(p_client_secret));
    END IF;
  END IF;
  IF p_enabled AND (NULLIF(btrim(p_client_id), '') IS NULL OR s.secret_id IS NULL) THEN
    RAISE EXCEPTION 'اكتب Client ID و Client Secret الأول';
  END IF;
  IF p_enabled AND (v_changed OR s.connection_ok_at IS NULL) THEN
    RAISE EXCEPTION 'اعمل «اختبار الاتصال» الأول وتأكد إنه نجح';
  END IF;
  UPDATE eta_settings SET client_id = NULLIF(btrim(p_client_id), ''), secret_id = s.secret_id, env = p_env, enabled = p_enabled,
         connection_ok_at = CASE WHEN v_changed THEN NULL ELSE connection_ok_at END,
         connection_error = CASE WHEN v_changed THEN NULL ELSE connection_error END,
         synced_until = CASE WHEN v_changed AND p_env IS DISTINCT FROM s.env THEN NULL ELSE synced_until END,
         last_error = CASE WHEN p_enabled THEN last_error END, updated_at = now(), updated_by = auth.uid()
   WHERE tenant_id = v_t;
  RETURN public.eta_settings_get();
END
$function$;
