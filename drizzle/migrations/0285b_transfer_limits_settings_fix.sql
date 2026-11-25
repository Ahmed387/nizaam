-- 0285b — set_transfer_approval_limits: settings.scope is generated from tenant_id (insert without it).
CREATE OR REPLACE FUNCTION public.set_transfer_approval_limits(p_money numeric, p_goods numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid := public.current_tenant_id();
BEGIN
  IF NOT (public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'حد موافقة التحويلات بيحدده صاحب الشركة بس' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_money, 0) < 0 OR coalesce(p_goods, 0) < 0 THEN RAISE EXCEPTION 'الحد لازم يكون صفر أو أكبر'; END IF;
  INSERT INTO public.settings (key, value, tenant_id, updated_at, updated_by)
  VALUES ('transfer_approval_limits',
          jsonb_build_object('money', round(coalesce(p_money, 0), 2), 'goods', round(coalesce(p_goods, 0), 2)), v_t, now(), auth.uid())
  ON CONFLICT (scope, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();
  RETURN public.get_transfer_approval_limits();
END $function$;
