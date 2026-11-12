-- 0202: owner 2026-11-11 «اعمل تابة للأرشفة وتحط فيه كل المتأرشف سواء عملاء أو كروت صنف». Archived accounts had no way back.
-- restore_contact(id): admin only, same company; an account archived by a MERGE (merged_into set) is not restored — its
-- documents live on the kept account. Products already have restore_product.
CREATE OR REPLACE FUNCTION public.restore_contact(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid; v_ct uuid; v_name text; v_merged uuid;
BEGIN
  v_tenant := public.assert_company_access(NULL);
  IF NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'استرجاع حساب مؤرشف للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id, name, merged_into INTO v_ct, v_name, v_merged FROM public.contacts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحساب غير موجود' USING ERRCODE = 'P0002'; END IF;
  IF v_ct IS DISTINCT FROM v_tenant AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'غير مصرح: الحساب يخص شركة أخرى' USING ERRCODE = '42501';
  END IF;
  IF v_merged IS NOT NULL THEN RAISE EXCEPTION 'الحساب «%» اتدمج في حساب تاني — مستنداته هناك ومينفعش يرجع', v_name; END IF;
  UPDATE public.contacts SET is_archived = false WHERE id = p_id;
  PERFORM public.log_audit_event('UPDATE', 'Contact', p_id::text, NULL, jsonb_build_object('name', v_name, 'mode', 'restore'));
END
$function$;
REVOKE ALL ON FUNCTION public.restore_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_contact(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
