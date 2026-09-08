CREATE OR REPLACE FUNCTION public.confirm_transfer_group(p_group uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_count int := 0;
  t record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  FOR t IN
    SELECT st.* FROM public.stock_transfers st
    WHERE st.group_id = p_group AND st.status = 'pending'
    ORDER BY st.created_at
  LOOP
    PERFORM public.assert_same_tenant(t.tenant_id);
    IF NOT (public.is_super_admin(v_user) OR public.is_admin(v_user)
            OR public.has_role(v_user,'owner')
            OR public.user_in_branch(v_user, t.to_branch_id)) THEN
      RAISE EXCEPTION 'لا تملك صلاحية على فرع المستلم';
    END IF;

    PERFORM public.partial_confirm_transfer__impl(t.id, t.quantity);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END
$function$;

CREATE OR REPLACE FUNCTION public.reject_transfer_group(p_group uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_count int := 0;
  t record;
  v_cost numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  FOR t IN SELECT * FROM public.stock_transfers
           WHERE group_id = p_group AND status = 'pending'
           ORDER BY created_at
  LOOP
    PERFORM public.assert_same_tenant(t.tenant_id);
    IF NOT (public.is_super_admin(v_user) OR public.is_admin(v_user)
            OR public.has_role(v_user,'owner')
            OR public.user_in_branch(v_user, t.to_branch_id)) THEN
      RAISE EXCEPTION 'لا تملك صلاحية على فرع المستلم';
    END IF;

    SELECT COALESCE(cost_price, 0) INTO v_cost FROM public.products WHERE id = t.product_id;

    UPDATE public.products SET quantity = COALESCE(quantity,0) + t.quantity
      WHERE id = t.product_id;

    INSERT INTO public.product_batches (
      product_id, branch_id, quantity_purchased, quantity_remaining,
      cost_price, base_purchase_price, batch_type, tenant_id
    ) VALUES (
      t.product_id, t.from_branch_id, t.quantity, t.quantity,
      COALESCE(v_cost,0), COALESCE(v_cost,0), 'transfer_return', t.tenant_id
    );

    UPDATE public.stock_transfers
      SET status = 'rejected', confirmed_by = v_user, received_quantity = 0
      WHERE id = t.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $function$;