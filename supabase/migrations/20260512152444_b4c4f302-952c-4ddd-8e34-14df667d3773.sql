
CREATE OR REPLACE FUNCTION public.disburse_pending_advance(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_req record;
  v_balance numeric;
  v_advance_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  SELECT * INTO v_req FROM public.advance_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الطلب غير موجود'; END IF;

  IF v_req.status::text <> 'approved_pending_funds' THEN
    RAISE EXCEPTION 'هذا الطلب ليس في انتظار توفر الرصيد';
  END IF;

  IF NOT (public.is_admin(v_user) OR (public.has_role(v_user,'branch_manager') AND public.user_in_branch(v_user, v_req.branch_id))) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
    INTO v_balance FROM public.treasury WHERE branch_id = v_req.branch_id;

  IF v_balance < v_req.amount THEN
    RAISE EXCEPTION 'رصيد الخزنة غير كافٍ — الرصيد الحالي: % جنيه', v_balance;
  END IF;

  INSERT INTO public.advances(employee_id, amount, monthly_deduct, remaining, reason, tenant_id)
  VALUES (v_req.employee_id, v_req.amount, v_req.monthly_deduct, v_req.amount, v_req.reason, v_req.tenant_id)
  RETURNING id INTO v_advance_id;

  INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id)
  VALUES (v_req.branch_id, 'expense', 'advance', v_req.amount,
          'صرف سلفة معتمدة', v_advance_id, v_user, v_req.tenant_id);

  UPDATE public.advance_requests
     SET status = 'approved'::advance_request_status,
         resulting_advance_id = v_advance_id,
         updated_at = now()
   WHERE id = p_request_id;

  RETURN v_advance_id;
END;
$$;
