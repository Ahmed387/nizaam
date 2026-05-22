
CREATE OR REPLACE FUNCTION public.transfer_treasury_atomic(
  p_from_branch uuid,
  p_to_branch uuid,
  p_amount numeric,
  p_reason text,
  p_payment_method text DEFAULT 'cash'::text,
  p_fee_amount numeric DEFAULT 0,
  p_reference_number text DEFAULT NULL::text,
  p_transfer_to_account text DEFAULT NULL::text,
  p_fee_actually_charged boolean DEFAULT true
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_transfer_id uuid;
  v_wallet_balance numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'مبلغ غير صحيح'; END IF;
  IF p_payment_method NOT IN ('cash','vodafone','instapay','bank') THEN RAISE EXCEPTION 'طريقة دفع غير صحيحة'; END IF;
  IF NOT public.user_in_branch(v_user, p_from_branch) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على فرع المرسل';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
    INTO v_wallet_balance
    FROM public.treasury
    WHERE branch_id = p_from_branch AND payment_method = p_payment_method;

  IF v_wallet_balance < (p_amount + COALESCE(p_fee_amount,0)) THEN
    RAISE EXCEPTION 'رصيد وعاء % غير كافٍ — المتاح: % ج.م', p_payment_method, v_wallet_balance;
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_from_branch;

  INSERT INTO public.treasury_transfers(
    from_branch_id, to_branch_id, amount, reason, transferred_by, tenant_id,
    payment_method, fee_amount, reference_number, transfer_to_account, fee_actually_charged
  ) VALUES (
    p_from_branch, p_to_branch, p_amount, p_reason, v_user, v_tenant,
    p_payment_method, COALESCE(p_fee_amount,0), p_reference_number, p_transfer_to_account,
    COALESCE(p_fee_actually_charged, true)
  ) RETURNING id INTO v_transfer_id;

  INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_number, transfer_to_account)
  VALUES (p_from_branch, 'expense', 'transfer', p_amount,
          'تحويل لفرع: ' || COALESCE(p_reason, ''), v_user, v_tenant,
          p_payment_method, p_reference_number, p_transfer_to_account);

  IF COALESCE(p_fee_amount,0) > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, is_fee, reference_number)
    VALUES (p_from_branch, 'expense', 'transfer_fee', p_fee_amount,
            'عمولة تحويل (' || p_payment_method || ')', v_user, v_tenant,
            p_payment_method, true, p_reference_number);
  END IF;

  INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_number)
  VALUES (p_to_branch, 'income', 'transfer', p_amount,
          'تحويل وارد: ' || COALESCE(p_reason, ''), v_user, v_tenant,
          p_payment_method, p_reference_number);

  RETURN v_transfer_id;
END;
$function$;
