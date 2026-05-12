
-- 1) Balance check trigger on treasury for any outgoing entry
CREATE OR REPLACE FUNCTION public.check_treasury_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
BEGIN
  IF NEW.type = 'expense' THEN
    SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
      INTO v_balance
      FROM public.treasury
      WHERE branch_id = NEW.branch_id;

    IF v_balance < NEW.amount THEN
      RAISE EXCEPTION 'رصيد الخزنة غير كافٍ — الرصيد الحالي: % جنيه', v_balance
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_treasury_balance ON public.treasury;
CREATE TRIGGER trg_check_treasury_balance
BEFORE INSERT ON public.treasury
FOR EACH ROW EXECUTE FUNCTION public.check_treasury_balance();

-- 2) Pre-check inside transfer RPC for clearer error
CREATE OR REPLACE FUNCTION public.transfer_treasury_atomic(p_from_branch uuid, p_to_branch uuid, p_amount numeric, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_transfer_id uuid;
  v_balance numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'مبلغ غير صحيح'; END IF;
  IF NOT public.user_in_branch(v_user, p_from_branch) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على فرع المرسل';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
    INTO v_balance
    FROM public.treasury
    WHERE branch_id = p_from_branch;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'رصيد الخزنة غير كافٍ — الرصيد الحالي: % جنيه', v_balance;
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_from_branch;

  INSERT INTO public.treasury_transfers(
    from_branch_id, to_branch_id, amount, reason, transferred_by, tenant_id
  ) VALUES (
    p_from_branch, p_to_branch, p_amount, p_reason, v_user, v_tenant
  ) RETURNING id INTO v_transfer_id;

  INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id)
  VALUES
    (p_from_branch, 'expense', 'transfer', p_amount, 'تحويل لفرع: ' || COALESCE(p_reason, ''), v_user, v_tenant),
    (p_to_branch,   'income',  'transfer', p_amount, 'تحويل وارد: '  || COALESCE(p_reason, ''), v_user, v_tenant);

  RETURN v_transfer_id;
END;
$function$;
