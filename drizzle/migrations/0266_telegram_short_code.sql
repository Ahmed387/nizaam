-- 0266 (owner 2026-11-18 «حوار الربط ده مدوخني … نفذه بالكامل مع وضع الخطوات»): the Telegram link code is 6 digits
-- (shown big on the page and in a QR), the bot takes it typed too; a chat that sends 5 wrong codes in an hour is stopped.
-- The page asks `tg_link_status()` (small) while it waits.

CREATE TABLE IF NOT EXISTS public.tg_link_attempts (
  chat bigint NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tg_link_attempts_chat_at ON public.tg_link_attempts (chat, at);
ALTER TABLE public.tg_link_attempts ENABLE ROW LEVEL SECURITY;  -- no policy: server only
REVOKE ALL ON public.tg_link_attempts FROM anon, authenticated;

-- a free 6-digit code (not used by another company's open link)
CREATE OR REPLACE FUNCTION public.tg_new_link_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v text; i int := 0;
BEGIN
  LOOP
    v := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM tenant_owner_contact WHERE tg_link_code = v AND tg_link_expires > now());
    i := i + 1;
    IF i > 50 THEN RAISE EXCEPTION 'مقدرتش أعمل كود — جرّب تاني'; END IF;
  END LOOP;
  RETURN v;
END $f$;
REVOKE ALL ON FUNCTION public.tg_new_link_code() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_link_start(p_purpose text DEFAULT 'owner'::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_t uuid; v_code text; v_bot text;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'ربط تليجرام للمالك بس' USING ERRCODE = '42501'; END IF;
  IF p_purpose NOT IN ('owner', 'group') THEN RAISE EXCEPTION 'نوع الربط غلط'; END IF;
  SELECT bot_username INTO v_bot FROM platform_telegram WHERE id = 1 AND ok_at IS NOT NULL;
  IF v_bot IS NULL THEN RAISE EXCEPTION 'بوت التليجرام لسه مش متجهز من إدارة المنصة'; END IF;
  v_code := public.tg_new_link_code();
  INSERT INTO tenant_owner_contact (tenant_id, tg_link_code, tg_link_expires, tg_link_purpose, updated_by)
  VALUES (v_t, v_code, now() + interval '15 minutes', p_purpose, auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET tg_link_code = v_code, tg_link_expires = now() + interval '15 minutes',
     tg_link_purpose = p_purpose, updated_at = now(), updated_by = auth.uid();
  RETURN jsonb_build_object('url', 'https://t.me/' || v_bot || CASE WHEN p_purpose = 'group' THEN '?startgroup=' ELSE '?start=' END || v_code,
                            'code', v_code, 'bot', v_bot, 'purpose', p_purpose, 'expires_in', 900);
END $function$;

CREATE OR REPLACE FUNCTION public.super_tg_link_start(p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_code text; v_bot text;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN RAISE EXCEPTION 'الشركة مش موجودة'; END IF;
  SELECT bot_username INTO v_bot FROM platform_telegram WHERE id = 1 AND ok_at IS NOT NULL;
  IF v_bot IS NULL THEN RAISE EXCEPTION 'جهّز بوت التليجرام الأول من «نظرة عامة»'; END IF;
  v_code := public.tg_new_link_code();
  INSERT INTO tenant_owner_contact (tenant_id, tg_link_code, tg_link_expires, tg_link_purpose, updated_by)
  VALUES (p_tenant, v_code, now() + interval '15 minutes', 'group', auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET tg_link_code = v_code, tg_link_expires = now() + interval '15 minutes',
     tg_link_purpose = 'group', updated_at = now(), updated_by = auth.uid();
  RETURN jsonb_build_object('url', 'https://t.me/' || v_bot || '?startgroup=' || v_code, 'code', v_code, 'expires_in', 900);
END $function$;

CREATE OR REPLACE FUNCTION public.tg_link_finish(p_code text, p_chat bigint, p_username text, p_chat_type text DEFAULT 'private'::text, p_title text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c record; v_name text; v_group boolean := p_chat_type IN ('group', 'supergroup'); v_code text := btrim(coalesce(p_code, ''));
BEGIN
  -- Arabic / Persian digits typed on a phone → 0-9
  v_code := translate(v_code, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  IF (SELECT count(*) FROM tg_link_attempts WHERE chat = p_chat AND at > now() - interval '1 hour') >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'too_many');
  END IF;
  SELECT * INTO c FROM tenant_owner_contact WHERE tg_link_code = v_code AND tg_link_expires > now() FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO tg_link_attempts (chat) VALUES (p_chat);
    DELETE FROM tg_link_attempts WHERE at < now() - interval '1 day';
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  IF coalesce(c.tg_link_purpose, 'owner') = 'group' AND NOT v_group THEN RETURN jsonb_build_object('ok', false, 'reason', 'need_group'); END IF;
  IF coalesce(c.tg_link_purpose, 'owner') = 'owner' AND v_group THEN RETURN jsonb_build_object('ok', false, 'reason', 'need_private'); END IF;
  IF v_group THEN
    UPDATE tenant_owner_contact SET tg_group_chat_id = p_chat, tg_group_title = left(p_title, 120), tg_group_linked_at = now(),
           tg_link_code = NULL, tg_link_expires = NULL, tg_link_purpose = NULL, tg_last_error = NULL, tg_last_error_at = NULL, updated_at = now()
     WHERE tenant_id = c.tenant_id;
  ELSE
    UPDATE tenant_owner_contact SET tg_chat_id = p_chat, tg_username = left(p_username, 64), tg_linked_at = now(),
           tg_link_code = NULL, tg_link_expires = NULL, tg_link_purpose = NULL, tg_last_error = NULL, tg_last_error_at = NULL, updated_at = now()
     WHERE tenant_id = c.tenant_id;
  END IF;
  DELETE FROM tg_link_attempts WHERE chat = p_chat;
  UPDATE eta_documents SET tg_state = 'skipped' WHERE tenant_id = c.tenant_id AND tg_state IS NULL AND status = 'Valid';
  SELECT name INTO v_name FROM tenants WHERE id = c.tenant_id;
  RETURN jsonb_build_object('ok', true, 'tenant_id', c.tenant_id, 'company', v_name, 'group', v_group);
END $function$;

-- small read for the waiting page (owner / admin of the company)
CREATE OR REPLACE FUNCTION public.tg_link_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_t uuid; c record;
BEGIN
  v_t := public.assert_company_access(NULL);
  SELECT * INTO c FROM tenant_owner_contact WHERE tenant_id = v_t;
  RETURN jsonb_build_object(
    'owner_linked', c.tg_chat_id IS NOT NULL, 'owner_linked_at', c.tg_linked_at,
    'group_linked', c.tg_group_chat_id IS NOT NULL, 'group_title', c.tg_group_title, 'group_linked_at', c.tg_group_linked_at,
    'waiting', CASE WHEN c.tg_link_expires > now() THEN c.tg_link_purpose END);
END $f$;
REVOKE ALL ON FUNCTION public.tg_link_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tg_link_status() TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
VALUES ('tg_link_status', '0266', 'Telegram link page: linked yet? (company scope)')
ON CONFLICT (function_name) DO NOTHING;
