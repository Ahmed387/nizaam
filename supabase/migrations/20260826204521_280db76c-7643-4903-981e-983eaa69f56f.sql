CREATE OR REPLACE FUNCTION public.edit_partner_transaction(_tx_id uuid, _transaction_type text, _amount numeric, _description text DEFAULT NULL::text, _month_year text DEFAULT NULL::text, _created_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.partner_transactions%ROWTYPE;
BEGIN
  IF NOT (is_admin(auth.uid()) OR is_super_admin(auth.uid()) OR has_role(auth.uid(), 'owner'::app_role)) THEN
    RAISE EXCEPTION 'غير مسموح — التعديل للمالك والمدير فقط';
  END IF;

  SELECT * INTO v_old FROM public.partner_transactions WHERE id = _tx_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الحركة غير موجودة'; END IF;

  IF _transaction_type NOT IN ('contribution','drawing','profit_share','capital_adjustment') THEN
    RAISE EXCEPTION 'نوع الحركة غير صحيح';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر';
  END IF;

  UPDATE public.partner_transactions SET
    transaction_type = _transaction_type,
    amount = _amount,
    description = _description,
    month_year = _month_year,
    created_at = COALESCE(_created_at, created_at)
  WHERE id = _tx_id;

  INSERT INTO public.audit_log (user_id, user_name, action, entity, entity_id, details, tenant_id)
  VALUES (
    auth.uid(),
    (SELECT COALESCE(name, username) FROM public.profiles WHERE id = auth.uid()),
    'update',
    'partner_transaction',
    _tx_id,
    jsonb_build_object(
      'old', jsonb_build_object('type', v_old.transaction_type, 'amount', v_old.amount, 'description', v_old.description, 'month_year', v_old.month_year, 'created_at', v_old.created_at),
      'new', jsonb_build_object('type', _transaction_type, 'amount', _amount, 'description', _description, 'month_year', _month_year, 'created_at', COALESCE(_created_at, v_old.created_at))
    ),
    v_old.tenant_id
  );
END;
$function$;