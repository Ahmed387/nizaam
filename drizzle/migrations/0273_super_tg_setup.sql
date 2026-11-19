-- 0273 — the platform owner sets up a company's Telegram from ONE card on the company page (owner 2026-11-19
-- «اقتراحي إن الكارت ده يبقى فيه 4 خطوات … نفذ وجرب واتاكد انه شغال»):
--   1) link the company's GROUP with the same 6-digit code / QR as the company owner's settings page,
--   2) make the company owner's PERSONAL link (sent to his mobile on WhatsApp) and see «اتربط» when he presses Start,
--   3) «ابعت كل المستندات على الجروب» (tenant_ops_settings.tg_docs_enabled),
--   4) «التقرير اليومي» (tenant_ops_settings.daily_report_enabled).
-- One bot for every company (platform_telegram); each company keeps its own group and its owner's own chat.
-- A company has ONE open code at a time (tenant_owner_contact.tg_link_code / _purpose), same as the owner's page.

-- 1+2) a link of either kind for one company
CREATE OR REPLACE FUNCTION public.super_tg_invite(p_tenant uuid, p_purpose text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_code text; v_bot text;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  IF p_purpose IS NULL OR p_purpose NOT IN ('owner', 'group') THEN RAISE EXCEPTION 'نوع الربط غلط'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN RAISE EXCEPTION 'الشركة مش موجودة'; END IF;
  SELECT bot_username INTO v_bot FROM platform_telegram WHERE id = 1 AND ok_at IS NOT NULL;
  IF v_bot IS NULL THEN RAISE EXCEPTION 'جهّز بوت التليجرام الأول من «نظرة عامة»'; END IF;
  v_code := public.tg_new_link_code();
  INSERT INTO tenant_owner_contact (tenant_id, tg_link_code, tg_link_expires, tg_link_purpose, updated_by)
  VALUES (p_tenant, v_code, now() + interval '15 minutes', p_purpose, auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET tg_link_code = v_code, tg_link_expires = now() + interval '15 minutes',
     tg_link_purpose = p_purpose, updated_at = now(), updated_by = auth.uid();
  RETURN jsonb_build_object('url', 'https://t.me/' || v_bot || CASE WHEN p_purpose = 'group' THEN '?startgroup=' ELSE '?start=' END || v_code,
                            'code', v_code, 'bot', v_bot, 'purpose', p_purpose, 'expires_in', 900);
END $function$;

-- 3) documents to the group
CREATE OR REPLACE FUNCTION public.super_tg_docs_set(p_tenant uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN RAISE EXCEPTION 'الشركة مش موجودة'; END IF;
  INSERT INTO tenant_ops_settings (tenant_id, tg_docs_enabled, updated_by) VALUES (p_tenant, coalesce(p_enabled, false), auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET tg_docs_enabled = coalesce(p_enabled, false), updated_at = now(), updated_by = auth.uid();
  RETURN public.super_tenant_ops_get(p_tenant);
END $function$;

-- 4) the daily report alone (the retention days keep their own «حفظ»)
CREATE OR REPLACE FUNCTION public.super_tg_daily_set(p_tenant uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN RAISE EXCEPTION 'الشركة مش موجودة'; END IF;
  INSERT INTO tenant_ops_settings (tenant_id, daily_report_enabled, updated_by) VALUES (p_tenant, coalesce(p_enabled, false), auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET daily_report_enabled = coalesce(p_enabled, false), updated_at = now(), updated_by = auth.uid();
  RETURN public.super_tenant_ops_get(p_tenant);
END $function$;

-- the card reads everything it shows from here (same keys as before + the setup state)
CREATE OR REPLACE FUNCTION public.super_tenant_ops_get(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE s record; c record; v_bot text;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM tenant_ops_settings WHERE tenant_id = p_tenant;
  SELECT * INTO c FROM tenant_owner_contact WHERE tenant_id = p_tenant;
  SELECT bot_username INTO v_bot FROM platform_telegram WHERE id = 1 AND ok_at IS NOT NULL;
  RETURN jsonb_build_object(
    'daily_report_enabled', coalesce(s.daily_report_enabled, false), 'audit_retention_days', coalesce(s.audit_retention_days, 7),
    'last_purge_at', s.last_purge_at, 'last_purge_rows', s.last_purge_rows,
    'tg_linked', c.tg_chat_id IS NOT NULL, 'tg_username', c.tg_username, 'tg_linked_at', c.tg_linked_at,
    'group_linked', c.tg_group_chat_id IS NOT NULL, 'group_title', c.tg_group_title, 'group_linked_at', c.tg_group_linked_at,
    'owner_name', c.owner_name, 'owner_phone', c.owner_phone, 'owner_email', c.owner_email,
    'waiting', CASE WHEN c.tg_link_expires > now() THEN c.tg_link_purpose END,
    'bot_ready', v_bot IS NOT NULL, 'bot_username', v_bot,
    'docs_enabled', coalesce(s.tg_docs_enabled, false),
    'docs_sent_today', (SELECT count(*) FROM tg_doc_queue q WHERE q.tenant_id = p_tenant AND q.state = 'sent'
                         AND q.sent_at >= ((now() AT TIME ZONE 'Africa/Cairo')::date::timestamp AT TIME ZONE 'Africa/Cairo')),
    'docs_failed', (SELECT count(*) FROM tg_doc_queue q WHERE q.tenant_id = p_tenant AND q.state = 'failed'),
    'plan_daily_report', public.tenant_feature_allowed(p_tenant, 'svc.daily_report'),
    'plan_telegram', public.tenant_feature_allowed(p_tenant, 'svc.telegram_eta'),
    'last_report', (SELECT jsonb_build_object('day', r.day, 'sent_at', r.sent_at, 'error', r.error)
                      FROM daily_report_runs r WHERE r.tenant_id = p_tenant ORDER BY r.day DESC LIMIT 1),
    'audit_rows', (SELECT count(*) FROM audit_log WHERE tenant_id = p_tenant));
END $function$;

REVOKE ALL ON FUNCTION public.super_tg_invite(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.super_tg_docs_set(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.super_tg_daily_set(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_tg_invite(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_tg_docs_set(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_tg_daily_set(uuid, boolean) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('super_tg_invite', '0273', 'a company''s group / owner Telegram link (super)'),
  ('super_tg_docs_set', '0273', 'documents to a company''s Telegram group on / off (super)'),
  ('super_tg_daily_set', '0273', 'a company''s daily Telegram report on / off (super)')
ON CONFLICT (function_name) DO NOTHING;
