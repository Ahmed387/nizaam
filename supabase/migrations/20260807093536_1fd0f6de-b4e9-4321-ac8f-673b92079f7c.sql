CREATE OR REPLACE FUNCTION public.create_inventory_session(p_branch_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session_id uuid;
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no tenant'; END IF;

  IF NOT public.user_in_branch(auth.uid(), p_branch_id) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على هذا الفرع';
  END IF;

  IF NOT (
      public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR
      public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'branch_manager') OR
      public.has_role(auth.uid(),'warehouse') OR public.has_role(auth.uid(),'accountant') OR
      public.has_role(auth.uid(),'supervisor')
  ) THEN
    RAISE EXCEPTION 'الجرد للمدير أو أمين المخزن بس';
  END IF;

  INSERT INTO public.inventory_sessions (tenant_id, branch_id, notes, created_by, status)
  VALUES (v_tenant, p_branch_id, p_notes, auth.uid(), 'counting')
  RETURNING id INTO v_session_id;

  INSERT INTO public.inventory_session_items
    (session_id, product_id, product_name, product_code, unit, system_quantity)
  SELECT
    v_session_id, p.id, p.name, p.sku, 'قطعة',
    GREATEST(
      COALESCE(p.quantity, 0) - COALESCE((
        SELECT SUM(r.reserved_quantity)
          FROM public.inventory_reservations r
         WHERE r.product_id = p.id
           AND r.branch_id  = p.branch_id
           AND r.status     = 'active'
           AND (r.expires_at IS NULL OR r.expires_at > now())
      ), 0),
      0
    )
  FROM public.products p
  WHERE p.branch_id = p_branch_id AND p.tenant_id = v_tenant;

  RETURN v_session_id;
END $function$;