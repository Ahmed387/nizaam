-- 0243 — the platform owner links a company's invoices GROUP himself (owner 2026-11-16 «انا كصاحب منصة انا اللي هكريت كل
-- الجروبات … لكل الشركات»): `super_tg_link_start(tenant)` gives the t.me/<bot>?startgroup=<code> link for that company
-- (15 min, same code flow as the company owner's button); `super_tg_unlink_group(tenant)`. `super_tenant_ops_get` now
-- returns the group's title too.
CREATE OR REPLACE FUNCTION public.super_tg_link_start(p_tenant uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_code text; v_bot text;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant) THEN RAISE EXCEPTION 'الشركة مش موجودة'; END IF;
  SELECT bot_username INTO v_bot FROM platform_telegram WHERE id = 1 AND ok_at IS NOT NULL;
  IF v_bot IS NULL THEN RAISE EXCEPTION 'جهّز بوت التليجرام الأول من «نظرة عامة»'; END IF;
  v_code := encode(extensions.gen_random_bytes(12), 'hex');
  INSERT INTO tenant_owner_contact (tenant_id, tg_link_code, tg_link_expires, tg_link_purpose, updated_by)
  VALUES (p_tenant, v_code, now() + interval '15 minutes', 'group', auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET tg_link_code = v_code, tg_link_expires = now() + interval '15 minutes',
     tg_link_purpose = 'group', updated_at = now(), updated_by = auth.uid();
  RETURN jsonb_build_object('url', 'https://t.me/' || v_bot || '?startgroup=' || v_code, 'expires_in', 900);
END $$;

CREATE OR REPLACE FUNCTION public.super_tg_unlink_group(p_tenant uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'لإدارة المنصة بس' USING ERRCODE = '42501'; END IF;
  UPDATE tenant_owner_contact SET tg_group_chat_id = NULL, tg_group_title = NULL, tg_group_linked_at = NULL, updated_at = now(), updated_by = auth.uid()
   WHERE tenant_id = p_tenant;
END $$;

DO $m$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.super_tenant_ops_get(uuid)'::regprocedure);
  n := replace(d, $a$'tg_linked', c.tg_chat_id IS NOT NULL,$a$,
    $b$'tg_linked', c.tg_chat_id IS NOT NULL, 'group_linked', c.tg_group_chat_id IS NOT NULL, 'group_title', c.tg_group_title,$b$);
  IF n = d THEN RAISE EXCEPTION '0243: anchor'; END IF;
  EXECUTE n;
END $m$;

REVOKE ALL ON FUNCTION public.super_tg_link_start(uuid), public.super_tg_unlink_group(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.super_tg_link_start(uuid), public.super_tg_unlink_group(uuid) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('super_tg_link_start', '0243', 'link a company''s invoices group (super)'),
  ('super_tg_unlink_group', '0243', 'unlink a company''s invoices group (super)')
ON CONFLICT DO NOTHING;
DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.security_exposed_definer_functions()) THEN RAISE EXCEPTION '0243: exposed'; END IF;
END $chk$;
