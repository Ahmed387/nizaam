
-- Unified validator: requires reference + from + to whenever method != 'cash'
CREATE OR REPLACE FUNCTION public._validate_transfer_payment(
  p_method text, p_reference text, p_from text, p_to text
) RETURNS void
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_method IS NULL OR p_method = 'cash' THEN RETURN; END IF;
  IF COALESCE(BTRIM(p_reference), '') = '' THEN
    RAISE EXCEPTION 'رقم العملية مطلوب للدفع غير النقدي';
  END IF;
  IF COALESCE(BTRIM(p_from), '') = '' THEN
    RAISE EXCEPTION 'رقم/حساب المُحوَّل منه مطلوب للدفع غير النقدي';
  END IF;
  IF COALESCE(BTRIM(p_to), '') = '' THEN
    RAISE EXCEPTION 'رقم/حساب المُحوَّل إليه مطلوب للدفع غير النقدي';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public._validate_transfer_payment(text,text,text,text) TO authenticated, service_role;

-- Patch record_payment_transaction — add validation at top
CREATE OR REPLACE FUNCTION public.record_payment_transaction(
  p_payment_plan_id uuid, p_installment_id uuid, p_amount numeric, p_payment_method text,
  p_reference_number text, p_transfer_to_account text, p_received_by_name text,
  p_fee_amount numeric, p_fee_type text, p_fee_on_customer boolean, p_direction text,
  p_transfer_from_account text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tx_id uuid; v_treasury_id uuid; v_fee_treasury_id uuid;
  v_branch uuid; v_tenant uuid; v_plan record; v_installment record;
  v_total_with_fee numeric; v_uid uuid := auth.uid(); v_contact_id uuid;
BEGIN
  PERFORM public._validate_transfer_payment(p_payment_method, p_reference_number, p_transfer_from_account, p_transfer_to_account);

  IF p_payment_plan_id IS NULL THEN RAISE EXCEPTION 'payment_plan_id required'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_direction NOT IN ('in','out') THEN RAISE EXCEPTION 'direction must be in/out'; END IF;

  SELECT * INTO v_plan FROM payment_plans WHERE id = p_payment_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan not found'; END IF;
  v_branch := v_plan.branch_id; v_tenant := v_plan.tenant_id;
  v_contact_id := CASE WHEN v_plan.entity_type IN ('supplier','customer','contact') THEN v_plan.entity_id ELSE NULL END;

  v_total_with_fee := p_amount + CASE WHEN p_fee_on_customer THEN COALESCE(p_fee_amount,0) ELSE 0 END;

  INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, reference_number, transfer_to_account, transfer_from_account, created_by, tenant_id)
  VALUES (v_branch,
    (CASE WHEN p_direction='in' THEN 'income' ELSE 'expense' END)::treasury_type,
    CASE WHEN p_direction='in' THEN 'payment_in' ELSE 'payment_out' END,
    p_amount,
    'دفعة خطة #' || substr(p_payment_plan_id::text,1,8) || ' — ' || v_plan.entity_name,
    p_payment_method, p_reference_number, p_transfer_to_account, p_transfer_from_account, v_uid, v_tenant)
  RETURNING id INTO v_treasury_id;

  IF COALESCE(p_fee_amount,0) > 0 AND NOT p_fee_on_customer THEN
    INSERT INTO expenses(branch_id, type, amount, description, date, payment_method, reference_number, is_fee, created_by, tenant_id)
    VALUES (v_branch, 'عمولة تحويل', p_fee_amount,
      'عمولة ' || p_payment_method || ' — دفعة خطة #' || substr(p_payment_plan_id::text,1,8),
      CURRENT_DATE, p_payment_method, p_reference_number, true, v_uid, v_tenant);
    INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, is_fee, created_by, tenant_id)
    VALUES (v_branch, 'expense'::treasury_type, 'fee', p_fee_amount, 'عمولة ' || p_payment_method, p_payment_method, true, v_uid, v_tenant)
    RETURNING id INTO v_fee_treasury_id;
  END IF;

  INSERT INTO payment_transactions(
    payment_plan_id, installment_id, branch_id, tenant_id, contact_id,
    direction, amount, payment_method, fee_amount, fee_type, total_with_fee,
    reference_number, transfer_to_account, transfer_from_account, received_by_name,
    treasury_id, fee_treasury_id, created_by
  ) VALUES (
    p_payment_plan_id, p_installment_id, v_branch, v_tenant, v_contact_id,
    p_direction, p_amount, p_payment_method, COALESCE(p_fee_amount,0), p_fee_type, v_total_with_fee,
    p_reference_number, p_transfer_to_account, p_transfer_from_account, p_received_by_name,
    v_treasury_id, v_fee_treasury_id, v_uid
  ) RETURNING id INTO v_tx_id;

  IF p_installment_id IS NOT NULL THEN
    SELECT * INTO v_installment FROM payment_installments WHERE id = p_installment_id;
    UPDATE payment_installments SET
      paid_amount = COALESCE(paid_amount,0) + p_amount,
      paid_at = CASE WHEN COALESCE(paid_amount,0) + p_amount >= amount THEN now() ELSE paid_at END,
      status = CASE WHEN COALESCE(paid_amount,0) + p_amount >= amount THEN 'paid' ELSE 'pending' END,
      updated_at = now()
    WHERE id = p_installment_id;
  END IF;

  UPDATE payment_plans SET
    paid_amount = COALESCE(paid_amount,0) + p_amount,
    remaining_amount = GREATEST(total_amount - (COALESCE(paid_amount,0) + p_amount), 0),
    status = CASE WHEN total_amount - (COALESCE(paid_amount,0) + p_amount) <= 0 THEN 'settled' ELSE status END,
    updated_at = now()
  WHERE id = p_payment_plan_id;

  RETURN v_tx_id;
END;
$function$;

-- Patch record_contact_payment
CREATE OR REPLACE FUNCTION public.record_contact_payment(
  p_contact_id uuid, p_branch_id uuid, p_direction text, p_amount numeric, p_payment_method text,
  p_reference_number text, p_transfer_to_account text, p_received_by_name text,
  p_fee_amount numeric, p_fee_type text, p_fee_on_customer boolean,
  p_notes text DEFAULT NULL::text, p_transfer_from_account text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_uid uuid := auth.uid(); v_total_with_fee numeric;
  v_tx_id uuid; v_treasury_id uuid; v_fee_treasury_id uuid;
  v_contact record; v_remaining numeric; v_plan record; v_inst record;
  v_alloc numeric; v_inst_alloc numeric; v_plan_remaining numeric;
  v_inst_remaining numeric; v_balance_delta numeric; v_left numeric;
BEGIN
  PERFORM public._validate_transfer_payment(p_payment_method, p_reference_number, p_transfer_from_account, p_transfer_to_account);

  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_direction NOT IN ('in','out') THEN RAISE EXCEPTION 'direction must be in/out'; END IF;
  SELECT * INTO v_contact FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contact not found'; END IF;
  v_tenant := v_contact.tenant_id;
  v_total_with_fee := p_amount + CASE WHEN p_fee_on_customer THEN COALESCE(p_fee_amount,0) ELSE 0 END;

  INSERT INTO treasury(tenant_id, branch_id, type, category, amount, description, reference_id, created_by, payment_method, reference_number, transfer_to_account, transfer_from_account)
  VALUES (v_tenant, p_branch_id,
    (CASE WHEN p_direction = 'in' THEN 'income' ELSE 'expense' END)::treasury_type,
    CASE WHEN p_direction = 'in' THEN 'customer_payment' ELSE 'supplier_payment' END,
    v_total_with_fee,
    COALESCE(p_notes, CASE WHEN p_direction='in' THEN 'تحصيل من ' ELSE 'سداد إلى ' END || v_contact.name) || ' — ' || p_payment_method,
    p_contact_id, v_uid, p_payment_method, p_reference_number, p_transfer_to_account, p_transfer_from_account)
  RETURNING id INTO v_treasury_id;

  IF COALESCE(p_fee_amount,0) > 0 AND NOT p_fee_on_customer THEN
    INSERT INTO treasury(tenant_id, branch_id, type, category, amount, description, reference_id, created_by, payment_method, is_fee)
    VALUES (v_tenant, p_branch_id, 'expense'::treasury_type, 'transfer_fee', p_fee_amount,
      'عمولة تحويل (' || p_payment_method || ') — ' || v_contact.name, p_contact_id, v_uid, p_payment_method, true)
    RETURNING id INTO v_fee_treasury_id;
  END IF;

  INSERT INTO payment_transactions(tenant_id, branch_id, payment_plan_id, installment_id, direction, amount, payment_method, fee_amount, fee_type, total_with_fee, reference_number, transfer_to_account, transfer_from_account, received_by_name, created_by, treasury_id, fee_treasury_id, contact_id)
  VALUES (v_tenant, p_branch_id, NULL, NULL, p_direction, p_amount, p_payment_method, COALESCE(p_fee_amount,0), p_fee_type, v_total_with_fee, p_reference_number, p_transfer_to_account, p_transfer_from_account, p_received_by_name, v_uid, v_treasury_id, v_fee_treasury_id, p_contact_id)
  RETURNING id INTO v_tx_id;

  v_remaining := p_amount; v_balance_delta := 0;

  IF p_direction = 'out' THEN
    FOR v_plan IN
      SELECT * FROM payment_plans
      WHERE entity_type='supplier' AND entity_id=p_contact_id AND tenant_id=v_tenant
        AND status='active' AND COALESCE(total_amount,0) - COALESCE(paid_amount,0) > 0.01
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0.01;
      v_plan_remaining := GREATEST(0, v_plan.total_amount - COALESCE(v_plan.paid_amount,0));
      v_alloc := LEAST(v_remaining, v_plan_remaining);
      IF v_alloc <= 0 THEN CONTINUE; END IF;
      v_left := v_alloc;
      FOR v_inst IN
        SELECT * FROM payment_installments
        WHERE payment_plan_id=v_plan.id AND status <> 'paid'
          AND COALESCE(amount,0) - COALESCE(paid_amount,0) > 0.01
        ORDER BY installment_number ASC
      LOOP
        EXIT WHEN v_left <= 0.01;
        v_inst_remaining := GREATEST(0, v_inst.amount - COALESCE(v_inst.paid_amount,0));
        v_inst_alloc := LEAST(v_left, v_inst_remaining);
        UPDATE payment_installments
        SET paid_amount = COALESCE(paid_amount,0) + v_inst_alloc,
            status = CASE WHEN COALESCE(paid_amount,0) + v_inst_alloc >= amount - 0.01 THEN 'paid' ELSE 'partial' END,
            paid_at = CASE WHEN COALESCE(paid_amount,0) + v_inst_alloc >= amount - 0.01 THEN now() ELSE paid_at END,
            updated_at = now()
        WHERE id = v_inst.id;
        v_left := v_left - v_inst_alloc;
      END LOOP;
      UPDATE payment_plans
      SET paid_amount = COALESCE(paid_amount,0) + v_alloc,
          remaining_amount = GREATEST(0, total_amount - (COALESCE(paid_amount,0) + v_alloc)),
          status = CASE WHEN (COALESCE(paid_amount,0) + v_alloc) >= total_amount - 0.01 THEN 'settled' ELSE status END,
          updated_at = now()
      WHERE id = v_plan.id;
      v_remaining := v_remaining - v_alloc;
    END LOOP;
    v_balance_delta := v_remaining;
  ELSE
    v_balance_delta := -p_amount;
  END IF;

  UPDATE contacts SET balance = COALESCE(balance,0) + v_balance_delta WHERE id = p_contact_id;
  RETURN v_tx_id;
END;
$function$;

-- Patch create_manual_voucher (latest signature with p_transferred_from)
CREATE OR REPLACE FUNCTION public.create_manual_voucher(
  p_branch_id uuid, p_type voucher_type, p_category_id uuid, p_amount numeric, p_payment_method text,
  p_reference_number text DEFAULT NULL::text, p_transferred_to text DEFAULT NULL::text,
  p_fee_amount numeric DEFAULT 0, p_party_type voucher_party_type DEFAULT NULL::voucher_party_type,
  p_party_id uuid DEFAULT NULL::uuid, p_party_name text DEFAULT NULL::text,
  p_description text DEFAULT NULL::text, p_voucher_date date DEFAULT CURRENT_DATE,
  p_transferred_from text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID; v_id UUID; vnum TEXT; tr_id UUID; fee_tr_id UUID; uname TEXT; cat_name TEXT;
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

  SELECT name INTO cat_name FROM voucher_categories
   WHERE id = p_category_id AND tenant_id = v_tenant AND type = p_type;
  IF cat_name IS NULL THEN RAISE EXCEPTION 'تصنيف غير صالح'; END IF;

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
