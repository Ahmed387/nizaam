
-- ============= Atomic approve_advance_request RPC =============
CREATE OR REPLACE FUNCTION public.approve_advance_request(
  p_request_id uuid,
  p_decision text,           -- 'approve' | 'reject'
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_req record;
  v_balance numeric;
  v_advance_id uuid;
  v_new_status advance_request_status;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'قرار غير صالح'; END IF;

  SELECT * INTO v_req FROM public.advance_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الطلب غير موجود'; END IF;

  IF NOT (public.is_admin(v_user) OR public.is_super_admin(v_user)) THEN
    RAISE EXCEPTION 'الموافقة/الرفض للمدير العام فقط';
  END IF;

  IF v_req.status::text <> 'pending_admin' THEN
    RAISE EXCEPTION 'لا يمكن اتخاذ قرار على هذا الطلب في حالته الحالية';
  END IF;

  IF p_decision = 'reject' THEN
    IF COALESCE(NULLIF(trim(p_note),''), NULL) IS NULL THEN
      RAISE EXCEPTION 'سبب الرفض مطلوب';
    END IF;
    UPDATE public.advance_requests
       SET status='rejected'::advance_request_status,
           admin_id=v_user, admin_decision_at=now(),
           admin_note=p_note, rejection_reason=p_note,
           updated_at=now()
     WHERE id = p_request_id;
    RETURN jsonb_build_object('status','rejected');
  END IF;

  -- approve path: check balance
  SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
    INTO v_balance FROM public.treasury WHERE branch_id = v_req.branch_id;

  IF v_balance < v_req.amount THEN
    v_new_status := 'approved_pending_funds'::advance_request_status;
    UPDATE public.advance_requests
       SET status=v_new_status, admin_id=v_user, admin_decision_at=now(),
           admin_note=p_note, updated_at=now()
     WHERE id = p_request_id;
    RETURN jsonb_build_object('status','approved_pending_funds');
  END IF;

  -- create advance + treasury atomically
  INSERT INTO public.advances(employee_id, amount, monthly_deduct, remaining, reason, tenant_id)
  VALUES (v_req.employee_id, v_req.amount, v_req.monthly_deduct, v_req.amount, v_req.reason, v_req.tenant_id)
  RETURNING id INTO v_advance_id;

  INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id)
  VALUES (v_req.branch_id, 'expense', 'advance', v_req.amount,
          'صرف سلفة معتمدة', v_advance_id, v_user, v_req.tenant_id);

  UPDATE public.advance_requests
     SET status='approved'::advance_request_status,
         admin_id=v_user, admin_decision_at=now(),
         admin_note=p_note,
         resulting_advance_id=v_advance_id,
         updated_at=now()
   WHERE id = p_request_id;

  RETURN jsonb_build_object('status','approved','advance_id',v_advance_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_advance_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_advance_request(uuid, text, text) TO authenticated;

-- ============= Extend cancel_voucher to reverse advances =============
CREATE OR REPLACE FUNCTION public.cancel_voucher(p_voucher_id UUID, p_reason TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v vouchers%ROWTYPE;
  uname TEXT;
  v_cat_key TEXT;
  v_advance_id UUID;
  v_paid_count INT;
BEGIN
  SELECT * INTO v FROM vouchers WHERE id = p_voucher_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'السند غير موجود'; END IF;
  IF v.status = 'cancelled' THEN RAISE EXCEPTION 'السند ملغي بالفعل'; END IF;

  IF NOT (
    is_admin(auth.uid())
    OR is_super_admin(auth.uid())
    OR (user_in_branch(auth.uid(), v.branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role))
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية لإلغاء السند';
  END IF;

  IF v.source = 'system' AND v.source_type <> 'treasury' THEN
    RAISE EXCEPTION 'السند مرتبط بـ % — قم بإلغاء المصدر أولاً', v.source_type;
  END IF;

  IF v.source = 'system' AND NOT is_admin(auth.uid()) AND NOT is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'السندات التلقائية لا تُلغى إلا من قبل المدير العام';
  END IF;

  IF COALESCE(NULLIF(trim(p_reason),''), NULL) IS NULL THEN
    RAISE EXCEPTION 'سبب الإلغاء مطلوب';
  END IF;

  -- Check if this voucher belongs to an employee advance category
  SELECT system_key INTO v_cat_key FROM voucher_categories WHERE id = v.category_id;

  IF v_cat_key = 'advance' AND v.treasury_id IS NOT NULL THEN
    SELECT reference_id INTO v_advance_id FROM treasury WHERE id = v.treasury_id;
    IF v_advance_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_paid_count FROM advance_payments WHERE advance_id = v_advance_id;
      IF v_paid_count > 0 THEN
        RAISE EXCEPTION 'لا يمكن إلغاء سند سلفة تم سداد % قسط/أقساط منها', v_paid_count;
      END IF;
      -- Reverse the linked advance_request (if any)
      UPDATE advance_requests
         SET status = 'rejected'::advance_request_status,
             admin_note = COALESCE(admin_note,'') || ' [تم إلغاء سند السلفة: ' || p_reason || ']',
             updated_at = now()
       WHERE resulting_advance_id = v_advance_id;
      DELETE FROM advances WHERE id = v_advance_id;
    END IF;
  END IF;

  -- Delete the linked treasury row (its delete trigger will cancel any other linked voucher)
  PERFORM set_config('app.skip_treasury_voucher','1', true);
  IF v.treasury_id IS NOT NULL THEN
    DELETE FROM treasury WHERE id = v.treasury_id;
  END IF;
  PERFORM set_config('app.skip_treasury_voucher','0', true);

  UPDATE vouchers
     SET status='cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = p_reason
   WHERE id = p_voucher_id;

  SELECT name INTO uname FROM profiles WHERE id = auth.uid();
  INSERT INTO audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (auth.uid(), COALESCE(uname,'?'), v.tenant_id, v.branch_id, 'CANCEL', 'voucher', v.id::text,
          jsonb_build_object('voucher_number', v.voucher_number, 'reason', p_reason));
END;
$$;
