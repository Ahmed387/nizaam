
CREATE OR REPLACE FUNCTION public.edit_voucher(
  p_voucher_id uuid,
  p_category_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_voucher_date date,
  p_party_type voucher_party_type DEFAULT NULL,
  p_party_id uuid DEFAULT NULL,
  p_party_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_transferred_to text DEFAULT NULL,
  p_transferred_from text DEFAULT NULL,
  p_fee_amount numeric DEFAULT 0,
  p_edit_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old vouchers%ROWTYPE;
  v_new_id uuid;
  v_changes jsonb := '{}'::jsonb;
  v_old_cat_name text;
  v_new_cat_name text;
BEGIN
  IF p_edit_reason IS NULL OR btrim(p_edit_reason) = '' THEN
    RAISE EXCEPTION 'سبب التعديل مطلوب';
  END IF;

  SELECT * INTO v_old FROM vouchers WHERE id = p_voucher_id;
  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'السند غير موجود';
  END IF;
  IF v_old.status <> 'active' THEN
    RAISE EXCEPTION 'لا يمكن تعديل سند غير نشط';
  END IF;
  IF v_old.source = 'system' THEN
    RAISE EXCEPTION 'لا يمكن تعديل السندات النظامية — عدّل المستند الأصلي بدلاً من ذلك';
  END IF;

  -- Permission mirrors create_manual_voucher
  IF NOT (
    is_admin(auth.uid())
    OR (user_in_branch(auth.uid(), v_old.branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role))
    OR is_super_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية لتعديل السند';
  END IF;

  -- Build change diff
  SELECT name INTO v_old_cat_name FROM voucher_categories WHERE id = v_old.category_id;
  SELECT name INTO v_new_cat_name FROM voucher_categories WHERE id = p_category_id;

  IF v_old.amount <> p_amount THEN
    v_changes := v_changes || jsonb_build_object('amount', jsonb_build_object('old', v_old.amount, 'new', p_amount));
  END IF;
  IF v_old.voucher_date <> p_voucher_date THEN
    v_changes := v_changes || jsonb_build_object('voucher_date', jsonb_build_object('old', v_old.voucher_date, 'new', p_voucher_date));
  END IF;
  IF v_old.category_id <> p_category_id THEN
    v_changes := v_changes || jsonb_build_object('category', jsonb_build_object('old', v_old_cat_name, 'new', v_new_cat_name));
  END IF;
  IF COALESCE(v_old.payment_method,'') <> COALESCE(p_payment_method,'') THEN
    v_changes := v_changes || jsonb_build_object('payment_method', jsonb_build_object('old', v_old.payment_method, 'new', p_payment_method));
  END IF;
  IF COALESCE(v_old.party_name,'') <> COALESCE(p_party_name,'') OR COALESCE(v_old.party_id::text,'') <> COALESCE(p_party_id::text,'') THEN
    v_changes := v_changes || jsonb_build_object('party', jsonb_build_object('old', v_old.party_name, 'new', p_party_name));
  END IF;
  IF COALESCE(v_old.description,'') <> COALESCE(p_description,'') THEN
    v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('old', v_old.description, 'new', p_description));
  END IF;
  IF COALESCE(v_old.reference_number,'') <> COALESCE(p_reference_number,'') THEN
    v_changes := v_changes || jsonb_build_object('reference_number', jsonb_build_object('old', v_old.reference_number, 'new', p_reference_number));
  END IF;
  IF COALESCE(v_old.transferred_to,'') <> COALESCE(p_transferred_to,'') THEN
    v_changes := v_changes || jsonb_build_object('transferred_to', jsonb_build_object('old', v_old.transferred_to, 'new', p_transferred_to));
  END IF;
  IF COALESCE(v_old.fee_amount,0) <> COALESCE(p_fee_amount,0) THEN
    v_changes := v_changes || jsonb_build_object('fee_amount', jsonb_build_object('old', v_old.fee_amount, 'new', p_fee_amount));
  END IF;

  IF v_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'لم يتم تغيير أي حقل';
  END IF;

  -- Cancel original (this reverses all accounting side-effects)
  PERFORM public.cancel_voucher(
    p_voucher_id,
    'تعديل السند: ' || p_edit_reason
  );

  -- Create replacement
  v_new_id := public.create_manual_voucher(
    p_branch_id => v_old.branch_id,
    p_type => v_old.type,
    p_category_id => p_category_id,
    p_amount => p_amount,
    p_payment_method => p_payment_method,
    p_reference_number => p_reference_number,
    p_transferred_to => p_transferred_to,
    p_fee_amount => p_fee_amount,
    p_party_type => p_party_type,
    p_party_id => p_party_id,
    p_party_name => p_party_name,
    p_description => p_description,
    p_voucher_date => p_voucher_date,
    p_transferred_from => p_transferred_from
  );

  -- Audit log
  BEGIN
    INSERT INTO audit_log (tenant_id, branch_id, user_id, action, entity_type, entity_id, details)
    VALUES (
      v_old.tenant_id,
      v_old.branch_id,
      auth.uid(),
      'edit_voucher',
      'voucher',
      v_new_id,
      jsonb_build_object(
        'old_voucher_id', p_voucher_id,
        'old_voucher_number', v_old.voucher_number,
        'reason', p_edit_reason,
        'changes', v_changes
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Audit failure shouldn't break the edit
    NULL;
  END;

  RETURN jsonb_build_object(
    'new_voucher_id', v_new_id,
    'old_voucher_id', p_voucher_id,
    'changes', v_changes
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.edit_voucher(uuid, uuid, numeric, text, date, voucher_party_type, uuid, text, text, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_voucher(uuid, uuid, numeric, text, date, voucher_party_type, uuid, text, text, text, text, text, numeric, text) TO authenticated;
