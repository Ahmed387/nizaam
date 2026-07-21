
CREATE OR REPLACE FUNCTION public.edit_voucher(
  p_voucher_id     UUID,
  p_category_id    UUID,
  p_amount         NUMERIC,
  p_payment_method TEXT,
  p_voucher_date   DATE,
  p_party_type     voucher_party_type DEFAULT NULL,
  p_party_id       UUID DEFAULT NULL,
  p_party_name     TEXT DEFAULT NULL,
  p_description    TEXT DEFAULT NULL,
  p_reference_number TEXT DEFAULT NULL,
  p_transferred_to TEXT DEFAULT NULL,
  p_fee_amount     NUMERIC DEFAULT 0,
  p_edit_reason    TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old vouchers%ROWTYPE;
  v_new_id UUID;
  v_uname TEXT;
  v_diff JSONB := '{}'::jsonb;
  v_old_cat_name TEXT;
  v_new_cat_name TEXT;
  v_original_number TEXT;
  v_note TEXT;
BEGIN
  SELECT * INTO v_old FROM vouchers WHERE id = p_voucher_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'السند غير موجود'; END IF;

  -- Permission
  IF NOT (
    is_admin(auth.uid())
    OR is_super_admin(auth.uid())
    OR (user_in_branch(auth.uid(), v_old.branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role))
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية لتعديل السند';
  END IF;

  IF v_old.status = 'cancelled' THEN
    RAISE EXCEPTION 'السند ملغي — لا يمكن تعديله';
  END IF;

  IF v_old.source <> 'manual' THEN
    RAISE EXCEPTION 'السندات التلقائية لا تُعدَّل — عدّل المصدر الأصلي';
  END IF;

  IF COALESCE(NULLIF(trim(p_edit_reason),''), NULL) IS NULL THEN
    RAISE EXCEPTION 'سبب التعديل مطلوب';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر';
  END IF;

  -- Compute diff (only user-editable fields)
  IF v_old.amount <> p_amount THEN
    v_diff := v_diff || jsonb_build_object('amount', jsonb_build_object('old', v_old.amount, 'new', p_amount));
  END IF;
  IF v_old.voucher_date <> p_voucher_date THEN
    v_diff := v_diff || jsonb_build_object('voucher_date', jsonb_build_object('old', v_old.voucher_date, 'new', p_voucher_date));
  END IF;
  IF v_old.category_id <> p_category_id THEN
    SELECT name INTO v_old_cat_name FROM voucher_categories WHERE id = v_old.category_id;
    SELECT name INTO v_new_cat_name FROM voucher_categories WHERE id = p_category_id;
    v_diff := v_diff || jsonb_build_object('category', jsonb_build_object('old', v_old_cat_name, 'new', v_new_cat_name));
  END IF;
  IF COALESCE(v_old.payment_method,'') <> COALESCE(p_payment_method,'') THEN
    v_diff := v_diff || jsonb_build_object('payment_method', jsonb_build_object('old', v_old.payment_method, 'new', p_payment_method));
  END IF;
  IF COALESCE(v_old.party_name,'') <> COALESCE(p_party_name,'') OR COALESCE(v_old.party_id::text,'') <> COALESCE(p_party_id::text,'') THEN
    v_diff := v_diff || jsonb_build_object('party', jsonb_build_object('old', v_old.party_name, 'new', p_party_name));
  END IF;
  IF COALESCE(v_old.description,'') <> COALESCE(p_description,'') THEN
    v_diff := v_diff || jsonb_build_object('description', jsonb_build_object('old', v_old.description, 'new', p_description));
  END IF;
  IF COALESCE(v_old.reference_number,'') <> COALESCE(p_reference_number,'') THEN
    v_diff := v_diff || jsonb_build_object('reference_number', jsonb_build_object('old', v_old.reference_number, 'new', p_reference_number));
  END IF;
  IF COALESCE(v_old.transferred_to,'') <> COALESCE(p_transferred_to,'') THEN
    v_diff := v_diff || jsonb_build_object('transferred_to', jsonb_build_object('old', v_old.transferred_to, 'new', p_transferred_to));
  END IF;
  IF COALESCE(v_old.fee_amount,0) <> COALESCE(p_fee_amount,0) THEN
    v_diff := v_diff || jsonb_build_object('fee_amount', jsonb_build_object('old', v_old.fee_amount, 'new', p_fee_amount));
  END IF;

  IF v_diff = '{}'::jsonb THEN
    RAISE EXCEPTION 'لا توجد تغييرات لحفظها';
  END IF;

  v_original_number := v_old.voucher_number;
  v_note := 'مُعدَّل من السند ' || v_original_number || ' — السبب: ' || p_edit_reason;

  -- Step 1: reverse the old voucher (cancel_voucher handles treasury reversal & GL reversal via triggers)
  PERFORM cancel_voucher(p_voucher_id, 'تعديل السند — ' || p_edit_reason);

  -- Step 2: create a fresh voucher with the new data (new number, new GL entry)
  v_new_id := create_manual_voucher(
    v_old.branch_id,
    v_old.type,
    p_category_id,
    p_amount,
    p_payment_method,
    p_reference_number,
    p_transferred_to,
    COALESCE(p_fee_amount, 0),
    p_party_type,
    p_party_id,
    p_party_name,
    COALESCE(p_description, '') || E'\n[' || v_note || ']',
    p_voucher_date
  );

  -- Audit
  SELECT name INTO v_uname FROM profiles WHERE id = auth.uid();
  INSERT INTO audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (
    auth.uid(), COALESCE(v_uname,'?'), v_old.tenant_id, v_old.branch_id,
    'EDIT', 'voucher', v_new_id::text,
    jsonb_build_object(
      'original_voucher_id', p_voucher_id,
      'original_voucher_number', v_original_number,
      'new_voucher_id', v_new_id,
      'reason', p_edit_reason,
      'changes', v_diff
    )
  );

  RETURN jsonb_build_object(
    'new_voucher_id', v_new_id,
    'original_voucher_number', v_original_number,
    'changes', v_diff
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_voucher(UUID, UUID, NUMERIC, TEXT, DATE, voucher_party_type, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO authenticated;
