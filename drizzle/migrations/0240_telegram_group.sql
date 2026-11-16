-- 0240 — e-invoices go to a Telegram GROUP of the company (owner 2026-11-16: «خلي الموضوع عبارة عن جروب علي التلجرام
-- في صاحب الشركة وصاحب الشركة هوا اللي بيضيف اي حد من الموظفين … عشان ينزل هناك اي فاتورة الكترونية والكل يشوفها»).
-- * `tg_link_start('group')` → t.me/<bot>?startgroup=<code>: Telegram asks which group to add the bot to and sends
--   «/start <code>» there; `tg_link_finish(code, chat, username, chat_type, title)` saves `tg_group_chat_id`.
--   `tg_link_start('owner')` (private chat) stays for the daily activity report — it is about the employees, so it goes
--   to the owner only, never to the group.
-- * E-invoices: the group first, else the owner's private chat (`tg_eta_pending`, `eta_tg_mark_pending`).
-- * Telegram moves a group to a new id when it becomes a supergroup (`tg_group_migrated`); the bot removed from the
--   group clears the link and leaves an error for the owner (`tg_group_left`). Members are added by the owner in Telegram.


ALTER TABLE public.tenant_owner_contact ADD COLUMN IF NOT EXISTS tg_link_purpose text;
ALTER TABLE public.tenant_owner_contact ADD COLUMN IF NOT EXISTS tg_group_chat_id bigint;
ALTER TABLE public.tenant_owner_contact ADD COLUMN IF NOT EXISTS tg_group_title text;
ALTER TABLE public.tenant_owner_contact ADD COLUMN IF NOT EXISTS tg_group_linked_at timestamptz;

CREATE OR REPLACE FUNCTION public.owner_contact_get()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_t uuid; c record; v_bot text;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_owner(auth.uid()) OR public.is_admin(auth.uid())) THEN RAISE EXCEPTION 'للمالك بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM tenant_owner_contact WHERE tenant_id = v_t;
  SELECT CASE WHEN ok_at IS NOT NULL THEN bot_username END INTO v_bot FROM platform_telegram WHERE id = 1;
  RETURN jsonb_build_object(
    'owner_name', c.owner_name, 'owner_phone', c.owner_phone, 'owner_email', c.owner_email,
    'tg_linked', c.tg_chat_id IS NOT NULL, 'tg_username', c.tg_username, 'tg_linked_at', c.tg_linked_at,
    'group_linked', c.tg_group_chat_id IS NOT NULL, 'group_title', c.tg_group_title, 'group_linked_at', c.tg_group_linked_at,
    'tg_last_error', c.tg_last_error, 'tg_last_error_at', c.tg_last_error_at, 'tg_last_sent_at', c.tg_last_sent_at,
    'bot_ready', v_bot IS NOT NULL, 'bot_username', v_bot, 'is_owner', public.is_owner(auth.uid()));
END $$;

DROP FUNCTION IF EXISTS public.tg_link_start();
CREATE OR REPLACE FUNCTION public.tg_link_start(p_purpose text DEFAULT 'owner')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_t uuid; v_code text; v_bot text;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'ربط تليجرام للمالك بس' USING ERRCODE = '42501'; END IF;
  IF p_purpose NOT IN ('owner', 'group') THEN RAISE EXCEPTION 'نوع الربط غلط'; END IF;
  SELECT bot_username INTO v_bot FROM platform_telegram WHERE id = 1 AND ok_at IS NOT NULL;
  IF v_bot IS NULL THEN RAISE EXCEPTION 'بوت التليجرام لسه مش متجهز من إدارة المنصة'; END IF;
  v_code := encode(extensions.gen_random_bytes(12), 'hex');
  INSERT INTO tenant_owner_contact (tenant_id, tg_link_code, tg_link_expires, tg_link_purpose, updated_by)
  VALUES (v_t, v_code, now() + interval '15 minutes', p_purpose, auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET tg_link_code = v_code, tg_link_expires = now() + interval '15 minutes',
     tg_link_purpose = p_purpose, updated_at = now(), updated_by = auth.uid();
  RETURN jsonb_build_object('url', 'https://t.me/' || v_bot || CASE WHEN p_purpose = 'group' THEN '?startgroup=' ELSE '?start=' END || v_code,
                            'expires_in', 900);
END $$;

DROP FUNCTION IF EXISTS public.tg_unlink();
CREATE OR REPLACE FUNCTION public.tg_unlink(p_which text DEFAULT 'owner')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_t uuid;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT public.is_owner(auth.uid()) THEN RAISE EXCEPTION 'للمالك بس' USING ERRCODE = '42501'; END IF;
  IF p_which = 'group' THEN
    UPDATE tenant_owner_contact SET tg_group_chat_id = NULL, tg_group_title = NULL, tg_group_linked_at = NULL, updated_at = now(), updated_by = auth.uid()
     WHERE tenant_id = v_t;
  ELSE
    UPDATE tenant_owner_contact SET tg_chat_id = NULL, tg_username = NULL, tg_linked_at = NULL, updated_at = now(), updated_by = auth.uid()
     WHERE tenant_id = v_t;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant_owner_contact WHERE tenant_id = v_t AND (tg_chat_id IS NOT NULL OR tg_group_chat_id IS NOT NULL)) THEN
    UPDATE eta_documents SET tg_state = 'skipped' WHERE tenant_id = v_t AND tg_state = 'pending';
  END IF;
  RETURN public.owner_contact_get();
END $$;

DROP FUNCTION IF EXISTS public.tg_link_finish(text, bigint, text);
CREATE OR REPLACE FUNCTION public.tg_link_finish(p_code text, p_chat bigint, p_username text, p_chat_type text DEFAULT 'private', p_title text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c record; v_name text; v_group boolean := p_chat_type IN ('group', 'supergroup');
BEGIN
  SELECT * INTO c FROM tenant_owner_contact WHERE tg_link_code = p_code AND tg_link_expires > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
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
  UPDATE eta_documents SET tg_state = 'skipped' WHERE tenant_id = c.tenant_id AND tg_state IS NULL AND status = 'Valid';
  SELECT name INTO v_name FROM tenants WHERE id = c.tenant_id;
  RETURN jsonb_build_object('ok', true, 'tenant_id', c.tenant_id, 'company', v_name, 'group', v_group);
END $$;

CREATE OR REPLACE FUNCTION public.tg_group_migrated(p_old bigint, p_new bigint)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$ UPDATE tenant_owner_contact SET tg_group_chat_id = p_new WHERE tg_group_chat_id = p_old $$;

CREATE OR REPLACE FUNCTION public.tg_group_left(p_chat bigint)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$ UPDATE tenant_owner_contact SET tg_group_chat_id = NULL, tg_group_title = NULL, tg_group_linked_at = NULL,
        tg_last_error = 'البوت اتشال من جروب الفواتير — اربط الجروب تاني', tg_last_error_at = now()
       WHERE tg_group_chat_id = p_chat $$;

CREATE OR REPLACE FUNCTION public.tg_eta_pending(p_limit int DEFAULT 10)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
    SELECT d.id, d.tenant_id, d.eta_uuid, d.internal_id, d.type_name, d.issuer_id, d.issuer_name, d.date_issued,
           d.total_sales, d.total_discount, d.net_amount, d.total, d.detail IS NOT NULL AS has_detail, d.detail,
           coalesce(c.tg_group_chat_id, c.tg_chat_id) AS chat, s.shipment_number AS matched_number, d.match_mode,
           (SELECT r.internal_id FROM eta_documents r WHERE r.tenant_id = d.tenant_id
              AND r.eta_uuid = coalesce(d.detail->'document'->'references'->>0, d.raw->'references'->>0) LIMIT 1) AS ref_internal_id
      FROM eta_documents d
      JOIN tenant_owner_contact c ON c.tenant_id = d.tenant_id AND coalesce(c.tg_group_chat_id, c.tg_chat_id) IS NOT NULL
      LEFT JOIN shipments s ON s.id = d.match_shipment_id
     WHERE d.tg_state = 'pending'
     ORDER BY d.date_issued NULLS LAST
     LIMIT greatest(1, least(p_limit, 30))) x
$$;

CREATE OR REPLACE FUNCTION public.tg_group_of(p_tenant uuid)
 RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT tg_group_chat_id FROM tenant_owner_contact WHERE tenant_id = p_tenant $$;

DO $m$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.eta_tg_mark_pending()'::regprocedure);
  n := replace(d, 'c.tenant_id = NEW.tenant_id AND c.tg_chat_id IS NOT NULL)', 'c.tenant_id = NEW.tenant_id AND coalesce(c.tg_group_chat_id, c.tg_chat_id) IS NOT NULL)');
  IF n = d THEN RAISE EXCEPTION '0240: anchor'; END IF;
  EXECUTE n;
END $m$;

REVOKE ALL ON FUNCTION public.tg_link_start(text), public.tg_unlink(text), public.tg_link_finish(text, bigint, text, text, text),
  public.tg_group_migrated(bigint, bigint), public.tg_group_left(bigint), public.tg_group_of(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_link_start(text), public.tg_unlink(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tg_link_finish(text, bigint, text, text, text), public.tg_group_migrated(bigint, bigint),
  public.tg_group_left(bigint), public.tg_group_of(uuid) TO service_role;

DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.security_exposed_definer_functions()) THEN
    RAISE EXCEPTION '0240: exposed: %', (SELECT string_agg(f::text, ', ') FROM public.security_exposed_definer_functions() f);
  END IF;
END $chk$;
