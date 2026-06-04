
ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS transfer_from_account text;
ALTER TABLE public.invoice_payments ADD COLUMN IF NOT EXISTS transfer_from_account text;
ALTER TABLE public.pre_order_transactions ADD COLUMN IF NOT EXISTS transfer_from_account text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS transfer_from_account text;

-- Update record_payment_transaction RPC
CREATE OR REPLACE FUNCTION public.record_payment_transaction(
  p_payment_plan_id uuid,
  p_installment_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text,
  p_transfer_to_account text,
  p_received_by_name text,
  p_fee_amount numeric,
  p_fee_type text,
  p_fee_on_customer boolean,
  p_direction text,
  p_transfer_from_account text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id uuid;
  v_treasury_id uuid;
  v_fee_treasury_id uuid;
  v_branch uuid;
  v_tenant uuid;
  v_plan record;
  v_installment record;
  v_total_with_fee numeric;
  v_uid uuid := auth.uid();
BEGIN
  IF p_payment_plan_id IS NULL THEN RAISE EXCEPTION 'payment_plan_id required'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_direction NOT IN ('in','out') THEN RAISE EXCEPTION 'direction must be in/out'; END IF;

  SELECT * INTO v_plan FROM payment_plans WHERE id = p_payment_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan not found'; END IF;
  v_branch := v_plan.branch_id;
  v_tenant := v_plan.tenant_id;

  v_total_with_fee := p_amount + CASE WHEN p_fee_on_customer THEN COALESCE(p_fee_amount,0) ELSE 0 END;

  INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, reference_number, transfer_to_account, transfer_from_account, created_by, tenant_id)
  VALUES (
    v_branch,
    CASE WHEN p_direction='in' THEN 'income' ELSE 'expense' END,
    CASE WHEN p_direction='in' THEN 'payment_in' ELSE 'payment_out' END,
    p_amount,
    'دفعة خطة #' || substr(p_payment_plan_id::text,1,8) || ' — ' || v_plan.entity_name,
    p_payment_method, p_reference_number, p_transfer_to_account, p_transfer_from_account,
    v_uid, v_tenant
  ) RETURNING id INTO v_treasury_id;

  IF COALESCE(p_fee_amount,0) > 0 AND NOT p_fee_on_customer THEN
    INSERT INTO expenses(branch_id, type, amount, description, date, payment_method, reference_number, is_fee, created_by, tenant_id)
    VALUES (
      v_branch, 'عمولة تحويل', p_fee_amount,
      'عمولة ' || p_payment_method || ' — دفعة خطة #' || substr(p_payment_plan_id::text,1,8),
      CURRENT_DATE, p_payment_method, p_reference_number, true, v_uid, v_tenant
    );
    INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, is_fee, created_by, tenant_id)
    VALUES (v_branch, 'expense', 'fee', p_fee_amount, 'عمولة ' || p_payment_method, p_payment_method, true, v_uid, v_tenant)
    RETURNING id INTO v_fee_treasury_id;
  END IF;

  INSERT INTO payment_transactions(
    payment_plan_id, installment_id, branch_id, tenant_id,
    direction, amount, payment_method, fee_amount, fee_type, total_with_fee,
    reference_number, transfer_to_account, transfer_from_account, received_by_name,
    treasury_id, fee_treasury_id, created_by
  ) VALUES (
    p_payment_plan_id, p_installment_id, v_branch, v_tenant,
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
    status = CASE WHEN total_amount - (COALESCE(paid_amount,0) + p_amount) <= 0 THEN 'completed' ELSE status END,
    updated_at = now()
  WHERE id = p_payment_plan_id;

  RETURN v_tx_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_payment_transaction(uuid,uuid,numeric,text,text,text,text,numeric,text,boolean,text,text) TO authenticated;

-- Update record_contact_payment RPC
CREATE OR REPLACE FUNCTION public.record_contact_payment(
  p_contact_id uuid,
  p_branch_id uuid,
  p_direction text,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text,
  p_transfer_to_account text,
  p_received_by_name text,
  p_fee_amount numeric,
  p_fee_type text,
  p_fee_on_customer boolean,
  p_notes text DEFAULT NULL,
  p_transfer_from_account text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_uid uuid := auth.uid();
  v_total_with_fee numeric;
  v_tx_id uuid;
  v_treasury_id uuid;
  v_fee_treasury_id uuid;
  v_contact record;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_direction NOT IN ('in','out') THEN RAISE EXCEPTION 'direction must be in/out'; END IF;

  SELECT * INTO v_contact FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contact not found'; END IF;
  v_tenant := v_contact.tenant_id;

  v_total_with_fee := p_amount + CASE WHEN p_fee_on_customer THEN COALESCE(p_fee_amount,0) ELSE 0 END;

  INSERT INTO treasury(tenant_id, branch_id, type, category, amount, description, reference_id, created_by, payment_method, reference_number, transfer_to_account, transfer_from_account)
  VALUES (
    v_tenant, p_branch_id,
    CASE WHEN p_direction = 'in' THEN 'income' ELSE 'expense' END,
    CASE WHEN p_direction = 'in' THEN 'customer_payment' ELSE 'supplier_payment' END,
    v_total_with_fee,
    COALESCE(p_notes, CASE WHEN p_direction='in' THEN 'تحصيل من ' ELSE 'سداد إلى ' END || v_contact.name)
      || ' — ' || p_payment_method,
    p_contact_id, v_uid,
    p_payment_method, p_reference_number, p_transfer_to_account, p_transfer_from_account
  ) RETURNING id INTO v_treasury_id;

  IF COALESCE(p_fee_amount,0) > 0 AND NOT p_fee_on_customer THEN
    INSERT INTO treasury(tenant_id, branch_id, type, category, amount, description, reference_id, created_by, payment_method, is_fee)
    VALUES (
      v_tenant, p_branch_id, 'expense', 'transfer_fee', p_fee_amount,
      'عمولة تحويل (' || p_payment_method || ') — ' || v_contact.name, p_contact_id, v_uid,
      p_payment_method, true
    ) RETURNING id INTO v_fee_treasury_id;
  END IF;

  INSERT INTO payment_transactions(
    tenant_id, branch_id, payment_plan_id, installment_id, direction,
    amount, payment_method, fee_amount, fee_type, total_with_fee,
    reference_number, transfer_to_account, transfer_from_account, received_by_name,
    created_by, treasury_id, fee_treasury_id, contact_id
  ) VALUES (
    v_tenant, p_branch_id, NULL, NULL, p_direction,
    p_amount, p_payment_method, COALESCE(p_fee_amount,0), p_fee_type, v_total_with_fee,
    p_reference_number, p_transfer_to_account, p_transfer_from_account, p_received_by_name,
    v_uid, v_treasury_id, v_fee_treasury_id, p_contact_id
  ) RETURNING id INTO v_tx_id;

  UPDATE contacts
  SET balance = balance + CASE WHEN p_direction = 'in' THEN -p_amount ELSE p_amount END
  WHERE id = p_contact_id;

  RETURN v_tx_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_contact_payment(uuid,uuid,text,numeric,text,text,text,text,numeric,text,boolean,text,text) TO authenticated;
