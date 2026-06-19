
CREATE OR REPLACE FUNCTION public.reject_transfer(p_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  t public.stock_transfers%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  SELECT * INTO t FROM public.stock_transfers
   WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;
  IF t.status <> 'pending' THEN RAISE EXCEPTION 'transfer_not_pending'; END IF;

  IF NOT public.user_in_branch(v_user, t.to_branch_id) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على فرع المستلم';
  END IF;

  -- transfer_stock_multi_atomic only deducted products.quantity at source
  -- (did NOT consume batches). Reverse the reservation:
  UPDATE public.products
     SET quantity = COALESCE(quantity, 0) + t.quantity
   WHERE id = t.product_id;

  UPDATE public.stock_transfers
     SET status = 'rejected', confirmed_by = v_user
   WHERE id = t.id;

  RETURN jsonb_build_object('returned', t.quantity, 'transfer_id', t.id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reject_transfer(uuid) TO authenticated;
