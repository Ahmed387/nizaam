CREATE OR REPLACE FUNCTION public.create_manual_voucher(p_branch_id uuid, p_type voucher_type, p_category_id uuid, p_amount numeric, p_payment_method text, p_reference_number text DEFAULT NULL::text, p_transferred_to text DEFAULT NULL::text, p_fee_amount numeric DEFAULT 0, p_party_type voucher_party_type DEFAULT NULL::voucher_party_type, p_party_id uuid DEFAULT NULL::uuid, p_party_name text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_voucher_date date DEFAULT CURRENT_DATE, p_transferred_from text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID; v_id UUID; vnum TEXT; tr_id UUID; fee_tr_id UUID; uname TEXT; cat_name TEXT; cat_active BOOLEAN;
BEGIN
  PERFORM public._validate_transfer_payment(p_payment_method, p_reference_number, p_transferred_from, p_transferred_to);

  IF NOT (
    is_admin(auth.uid())
    OR (user_in_branch(auth.uid(), p_branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role))
    OR is_super_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية لإضافة سند';
  END IF;

  SELECT tenant_id INTO v_tenant FROM branches WHERE id = p_branch_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'الفرع غير موجود'; END IF;

  SELECT name, is_active INTO cat_name, cat_active FROM voucher_categories
   WHERE id = p_category_id AND tenant_id = v_tenant AND type = p_type;
  IF cat_name IS NULL THEN RAISE EXCEPTION 'تصنيف غير صالح'; END IF;
  IF NOT COALESCE(cat_active, false) THEN
    RAISE EXCEPTION 'التصنيف "%" معطّل — لا يمكن إنشاء سند به', cat_name;
  END IF;

  SELECT name INTO uname FROM profiles WHERE id = auth.uid();
  vnum := next_voucher_number(v_tenant, p_type);

  PERFORM set_config('app.skip_treasury_voucher','1', true);

  INSERT INTO treasury (
    tenant_id, branch_id, type, category, amount, description,
    payment_method, reference_number, transfer_to_account, transfer_from_account,
    is_fee, created_by
  ) VALUES (
    v_tenant, p_branch_id,
    CASE WHEN p_type='receipt' THEN 'income'::treasury_type ELSE 'expense'::treasury_type END,
    cat_name, p_amount, p_description,
    p_payment_method, p_reference_number, p_transferred_to, p_transferred_from,
    false, auth.uid()
  ) RETURNING id INTO tr_id;

  INSERT INTO vouchers (
    tenant_id, branch_id, voucher_number, type, source,
    treasury_id, category_id, amount, payment_method,
    fee_amount, reference_number, transferred_to, transferred_from,
    party_type, party_id, party_name, description,
    voucher_date, created_by, created_by_name
  ) VALUES (
    v_tenant, p_branch_id, vnum, p_type, 'manual',
    tr_id, p_category_id, p_amount, p_payment_method,
    COALESCE(p_fee_amount,0), p_reference_number, p_transferred_to, p_transferred_from,
    p_party_type, p_party_id, p_party_name, p_description,
    p_voucher_date, auth.uid(), uname
  ) RETURNING id INTO v_id;

  IF COALESCE(p_fee_amount,0) > 0 THEN
    INSERT INTO treasury (
      tenant_id, branch_id, type, category, amount, description,
      payment_method, is_fee, created_by
    ) VALUES (
      v_tenant, p_branch_id, 'expense'::treasury_type, 'عمولات تحويل',
      p_fee_amount, 'عمولة سند ' || vnum, p_payment_method, true, auth.uid()
    ) RETURNING id INTO fee_tr_id;

    INSERT INTO vouchers (
      tenant_id, branch_id, voucher_number, type, source, source_type, source_id,
      treasury_id, category_id, amount, payment_method,
      description, voucher_date, created_by, created_by_name
    ) VALUES (
      v_tenant, p_branch_id, next_voucher_number(v_tenant,'payment'),
      'payment', 'system', 'voucher_fee', v_id,
      fee_tr_id, get_system_category(v_tenant,'payment','transfer_fee'),
      p_fee_amount, p_payment_method,
      'عمولة تحويل سند ' || vnum, p_voucher_date, auth.uid(), uname
    );
  END IF;

  PERFORM set_config('app.skip_treasury_voucher','0', true);

  INSERT INTO audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (auth.uid(), COALESCE(uname,'?'), v_tenant, p_branch_id, 'CREATE', 'voucher', v_id::text,
          jsonb_build_object('voucher_number', vnum, 'type', p_type, 'amount', p_amount));

  RETURN v_id;
END;
$function$;