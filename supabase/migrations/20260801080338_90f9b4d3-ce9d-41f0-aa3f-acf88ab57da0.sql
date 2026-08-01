CREATE OR REPLACE FUNCTION public.approve_inventory_session(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_s record;
  v_is_owner boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  SELECT tenant_id, branch_id INTO v_s FROM public.inventory_sessions WHERE id = p_session_id;
  IF v_s IS NULL THEN RAISE EXCEPTION 'session not found'; END IF;

  PERFORM public.assert_same_tenant(v_s.tenant_id);

  SELECT EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE t.id = v_s.tenant_id AND t.owner_user_id = v_user
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_user AND ur.role = 'owner' AND ur.tenant_id = v_s.tenant_id
  ) INTO v_is_owner;

  IF NOT (public.is_super_admin(v_user) OR v_is_owner) THEN
    RAISE EXCEPTION 'اعتماد الجرد متاح لمالك الشركة فقط';
  END IF;

  PERFORM public.approve_inventory_session__impl(p_session_id);
END $function$;