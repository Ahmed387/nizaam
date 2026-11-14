-- 0220 — «الفواتير الإلكترونية الواردة» (owner 2026-11-14 «محتاج اشوف فواتير الموردين اللي جاية ليا … عاوز استقبل بس»).
-- RECEIVE ONLY: the Egyptian Tax Authority (ETA) e-invoicing portal is read every hour for the documents other
-- taxpayers issued TO this company (GET /api/v1.0/documents/search?direction=Received). Nothing is ever sent to the ETA,
-- and nothing here touches a document, a till, the books or stock: it is a list to look at + a notification per new one.
--   eta_settings      one row per company: Client ID, the secret's id in Supabase Vault (never in a table, never
--                     returned to the browser), environment, on / off, last sync, last error.
--   eta_documents     one row per ETA document uuid (status kept up to date: Valid / Rejected / Cancelled).
--   eta_save_settings (owner only)   writes the Client ID / Secret (secret into Vault).
--   eta_settings_get  (owner / admin) everything but the secret.
--   eta_credentials   (service role) read by the edge function `eta-sync`.
--   eta_ingest        (service role) upserts what `eta-sync` fetched, notifies owners / admins of NEW documents and of
--                     documents that turned Cancelled / Rejected.
--   eta_sync_now      (owner / admin) asks for a sync now (at most once every 2 minutes).
--   pg_cron «eta-sync-hourly» calls `eta-sync` for every company that switched it on.
CREATE TABLE IF NOT EXISTS public.eta_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id text,
  secret_id uuid,
  env text NOT NULL DEFAULT 'prod' CHECK (env IN ('prod', 'preprod')),
  enabled boolean NOT NULL DEFAULT false,
  synced_until timestamptz,
  last_sync_at timestamptz,
  last_manual_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.eta_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.eta_settings FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.eta_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  eta_uuid text NOT NULL,
  submission_uuid text,
  long_id text,
  public_url text,
  internal_id text,
  type_name text,
  type_version text,
  issuer_id text,
  issuer_name text,
  issuer_type text,
  receiver_id text,
  receiver_name text,
  date_issued timestamptz,
  date_received timestamptz,
  total_sales numeric(18,5),
  total_discount numeric(18,5),
  net_amount numeric(18,5),
  total numeric(18,5),
  status text,
  status_reason text,
  raw jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz,
  UNIQUE (tenant_id, eta_uuid)
);
CREATE INDEX IF NOT EXISTS eta_documents_tenant_issued ON public.eta_documents (tenant_id, date_issued DESC);
ALTER TABLE public.eta_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.eta_documents FROM anon, authenticated;
GRANT SELECT ON public.eta_documents TO authenticated;
DROP POLICY IF EXISTS eta_documents_read ON public.eta_documents;
CREATE POLICY eta_documents_read ON public.eta_documents FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
         AND ((SELECT public.is_owner(auth.uid())) OR (SELECT public.is_admin(auth.uid()))
              OR (SELECT public.has_permission(auth.uid(), 'admin_eta.view'))));

CREATE OR REPLACE FUNCTION public.eta_save_settings(p_client_id text, p_client_secret text, p_env text, p_enabled boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $function$
DECLARE v_t uuid; s record;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'بيانات الربط مع الضرائب للمالك بس' USING ERRCODE = '42501'; END IF;
  IF p_env NOT IN ('prod', 'preprod') THEN RAISE EXCEPTION 'البيئة غلط'; END IF;
  INSERT INTO eta_settings (tenant_id) VALUES (v_t) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM eta_settings WHERE tenant_id = v_t FOR UPDATE;
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
  UPDATE eta_settings SET client_id = NULLIF(btrim(p_client_id), ''), secret_id = s.secret_id, env = p_env, enabled = p_enabled,
         last_error = CASE WHEN p_enabled THEN last_error END, updated_at = now(), updated_by = auth.uid()
   WHERE tenant_id = v_t;
  RETURN public.eta_settings_get();
END
$function$;

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
    'is_owner', public.is_owner(auth.uid()),
    'unseen', (SELECT count(*) FROM eta_documents d WHERE d.tenant_id = v_t AND d.seen_at IS NULL));
END
$function$;

CREATE OR REPLACE FUNCTION public.eta_credentials(p_tenant uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $function$
  SELECT jsonb_build_object('client_id', s.client_id, 'client_secret', ds.decrypted_secret, 'env', s.env,
                            'enabled', s.enabled, 'synced_until', s.synced_until)
    FROM eta_settings s LEFT JOIN vault.decrypted_secrets ds ON ds.id = s.secret_id
   WHERE s.tenant_id = p_tenant
$function$;
REVOKE ALL ON FUNCTION public.eta_credentials(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eta_credentials(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.eta_ingest(p_tenant uuid, p_docs jsonb, p_until timestamptz, p_error text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE d jsonb; v_old text; v_new int := 0; v_changed int := 0; v_id uuid; u record; v_title text; v_body text;
BEGIN
  FOR d IN SELECT * FROM jsonb_array_elements(COALESCE(p_docs, '[]'::jsonb)) LOOP
    CONTINUE WHEN NULLIF(d->>'uuid', '') IS NULL;
    SELECT status INTO v_old FROM eta_documents WHERE tenant_id = p_tenant AND eta_uuid = d->>'uuid';
    INSERT INTO eta_documents (tenant_id, eta_uuid, submission_uuid, long_id, public_url, internal_id, type_name, type_version,
      issuer_id, issuer_name, issuer_type, receiver_id, receiver_name, date_issued, date_received,
      total_sales, total_discount, net_amount, total, status, status_reason, raw)
    VALUES (p_tenant, d->>'uuid', d->>'submissionUUID', d->>'longId', d->>'publicUrl', d->>'internalId', d->>'typeName',
      d->>'typeVersionName', d->>'issuerId', d->>'issuerName', d->>'issuerType', d->>'receiverId', d->>'receiverName',
      NULLIF(d->>'dateTimeIssued', '')::timestamptz, NULLIF(d->>'dateTimeReceived', '')::timestamptz,
      NULLIF(d->>'totalSales', '')::numeric, NULLIF(d->>'totalDiscount', '')::numeric, NULLIF(d->>'netAmount', '')::numeric,
      NULLIF(d->>'total', '')::numeric, d->>'status', d->>'documentStatusReason', d)
    ON CONFLICT (tenant_id, eta_uuid) DO UPDATE SET status = EXCLUDED.status, status_reason = EXCLUDED.status_reason,
      public_url = COALESCE(EXCLUDED.public_url, eta_documents.public_url), raw = EXCLUDED.raw, updated_at = now()
    RETURNING id INTO v_id;
    v_title := NULL;
    IF v_old IS NULL THEN
      v_new := v_new + 1;
      v_title := 'فاتورة إلكترونية واردة من ' || COALESCE(d->>'issuerName', 'مورد');
    ELSIF v_old IS DISTINCT FROM d->>'status' AND d->>'status' IN ('Cancelled', 'Rejected') THEN
      v_changed := v_changed + 1;
      v_title := CASE d->>'status' WHEN 'Cancelled' THEN 'اتلغت' ELSE 'اترفضت' END || ' فاتورة إلكترونية من ' || COALESCE(d->>'issuerName', 'مورد');
      UPDATE eta_documents SET seen_at = NULL WHERE id = v_id;
    END IF;
    IF v_title IS NOT NULL THEN
      v_body := COALESCE(d->>'typeName', '') || ' رقم ' || COALESCE(d->>'internalId', '') || ' — ' ||
                to_char(COALESCE(NULLIF(d->>'total', '')::numeric, 0), 'FM999,999,999,990.00') || ' جنيه — ' ||
                to_char((NULLIF(d->>'dateTimeIssued', '')::timestamptz) AT TIME ZONE 'Africa/Cairo', 'DD/MM/YYYY');
      FOR u IN SELECT DISTINCT ur.user_id FROM user_roles ur WHERE ur.tenant_id = p_tenant AND ur.role IN ('owner', 'admin') LOOP
        INSERT INTO notifications (tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
        VALUES (p_tenant, u.user_id, v_title, v_body, 'eta_received', '/admin/eta-invoices', 'eta_documents', v_id);
      END LOOP;
    END IF;
  END LOOP;
  UPDATE eta_settings SET last_sync_at = now(), last_error = p_error,
         synced_until = CASE WHEN p_error IS NULL AND p_until IS NOT NULL THEN p_until ELSE synced_until END
   WHERE tenant_id = p_tenant;
  RETURN jsonb_build_object('new', v_new, 'changed', v_changed);
END
$function$;
REVOKE ALL ON FUNCTION public.eta_ingest(uuid, jsonb, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eta_ingest(uuid, jsonb, timestamptz, text) TO service_role;

CREATE OR REPLACE FUNCTION public.eta_sync_now()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; s record;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك أو المدير بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM eta_settings WHERE tenant_id = v_t FOR UPDATE;
  IF s.tenant_id IS NULL OR NOT s.enabled THEN RAISE EXCEPTION 'الربط مع منظومة الضرائب مش متشغّل'; END IF;
  IF s.last_manual_at > now() - interval '2 minutes' THEN RAISE EXCEPTION 'استنى دقيقتين بين كل تحديث والتاني'; END IF;
  UPDATE eta_settings SET last_manual_at = now() WHERE tenant_id = v_t;
  PERFORM public.nizam_cron_call('eta-sync', jsonb_build_object('tenant_id', v_t));
  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.eta_mark_seen(p_ids uuid[] DEFAULT NULL)
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; n int;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid()) OR public.has_permission(auth.uid(), 'admin_eta.view')) THEN
    RAISE EXCEPTION 'مش مسموح' USING ERRCODE = '42501';
  END IF;
  UPDATE eta_documents SET seen_at = now() WHERE tenant_id = v_t AND seen_at IS NULL AND (p_ids IS NULL OR id = ANY (p_ids));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;

CREATE OR REPLACE FUNCTION public.eta_sync_all()
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN SELECT tenant_id FROM eta_settings WHERE enabled AND client_id IS NOT NULL AND secret_id IS NOT NULL LOOP
    PERFORM public.nizam_cron_call('eta-sync', jsonb_build_object('tenant_id', t.tenant_id));
    n := n + 1;
  END LOOP;
  RETURN n;
END
$function$;
REVOKE ALL ON FUNCTION public.eta_sync_all() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.eta_save_settings(text, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eta_settings_get() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eta_sync_now() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.eta_mark_seen(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eta_save_settings(text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.eta_settings_get() TO authenticated;
GRANT EXECUTE ON FUNCTION public.eta_sync_now() TO authenticated;
GRANT EXECUTE ON FUNCTION public.eta_mark_seen(uuid[]) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('eta_save_settings', '0220', 'owner: ETA client id / secret (secret into Vault)'),
  ('eta_settings_get', '0220', 'owner / admin: ETA settings without the secret'),
  ('eta_sync_now', '0220', 'owner / admin: one ETA sync, 2-minute spacing'),
  ('eta_mark_seen', '0220', 'mark received e-invoices as seen')
ON CONFLICT DO NOTHING;

INSERT INTO public.system_cron_tokens (name, token)
VALUES ('eta-sync', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;
SELECT cron.schedule('eta-sync-hourly', '7 * * * *', $$SELECT public.eta_sync_all()$$);
