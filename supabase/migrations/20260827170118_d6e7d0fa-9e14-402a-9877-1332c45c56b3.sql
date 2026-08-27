CREATE OR REPLACE FUNCTION public.delete_partner_transaction(_tx_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.partner_transactions%ROWTYPE;
BEGIN
  IF NOT (is_admin(auth.uid()) OR is_super_admin(auth.uid()) OR has_role(auth.uid(), 'owner'::app_role)) THEN
    RAISE EXCEPTION 'غير مسموح — الحذف للمالك والمدير فقط';
  END IF;

  SELECT * INTO v_old FROM public.partner_transactions WHERE id = _tx_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحركة غير موجودة'; END IF;

  IF v_old.related_voucher_id IS NOT NULL OR v_old.related_treasury_id IS NOT NULL THEN
    RAISE EXCEPTION 'الحركة دي مرتبطة بسند/خزينة — الغِ السند الأصلي بدل حذف الحركة';
  END IF;

  DELETE FROM public.partner_transactions WHERE id = _tx_id;

  INSERT INTO public.audit_log (user_id, user_name, action, entity, entity_id, details, tenant_id)
  VALUES (
    auth.uid(),
    (SELECT COALESCE(name, username) FROM public.profiles WHERE id = auth.uid()),
    'delete',
    'partner_transactions',
    _tx_id,
    jsonb_build_object(
      'partner_id', v_old.partner_id,
      'transaction_type', v_old.transaction_type,
      'amount', v_old.amount,
      'description', v_old.description,
      'month_year', v_old.month_year
    ),
    v_old.tenant_id
  );
END $function$;

GRANT EXECUTE ON FUNCTION public.delete_partner_transaction(uuid) TO authenticated;