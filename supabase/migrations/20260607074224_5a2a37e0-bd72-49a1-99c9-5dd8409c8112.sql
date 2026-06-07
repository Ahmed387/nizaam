
-- Drop ALL overloads of record_contact_payment to avoid ambiguity
DROP FUNCTION IF EXISTS public.record_contact_payment(uuid, uuid, text, numeric, text, text, text, text, numeric, text, boolean, text);
DROP FUNCTION IF EXISTS public.record_contact_payment(uuid, uuid, text, numeric, text, text, text, text, numeric, text, boolean, text, text);

-- Recreate with explicit treasury_type casts
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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

  INSERT INTO treasury(
    tenant_id, branch_id, type, category, amount, description, reference_id,
    created_by, payment_method, reference_number, transfer_to_account, transfer_from_account
  ) VALUES (
    v_tenant, p_branch_id,
    (CASE WHEN p_direction = 'in' THEN 'income' ELSE 'expense' END)::treasury_type,
    CASE WHEN p_direction = 'in' THEN 'customer_payment' ELSE 'supplier_payment' END,
    v_total_with_fee,
    COALESCE(p_notes, CASE WHEN p_direction='in' THEN 'تحصيل من ' ELSE 'سداد إلى ' END || v_contact.name)
      || ' — ' || p_payment_method,
    p_contact_id, v_uid,
    p_payment_method, p_reference_number, p_transfer_to_account, p_transfer_from_account
  ) RETURNING id INTO v_treasury_id;

  IF COALESCE(p_fee_amount,0) > 0 AND NOT p_fee_on_customer THEN
    INSERT INTO treasury(
      tenant_id, branch_id, type, category, amount, description, reference_id,
      created_by, payment_method, is_fee
    ) VALUES (
      v_tenant, p_branch_id, 'expense'::treasury_type, 'transfer_fee', p_fee_amount,
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

  -- Update contact balance:
  -- direction='in' (we receive) → balance decreases (less owed to them / more credit to us)
  -- direction='out' (we pay) → balance increases (more credit accumulates if overpaid)
  -- Convention: +balance = credit at supplier (they owe us back), -balance = we owe them
  UPDATE contacts
  SET balance = COALESCE(balance,0) + CASE WHEN p_direction = 'in' THEN -p_amount ELSE p_amount END
  WHERE id = p_contact_id;

  RETURN v_tx_id;
END;
$function$;

-- New function: apply supplier credit to a payment plan automatically
CREATE OR REPLACE FUNCTION public.apply_supplier_credit(
  p_contact_id uuid,
  p_payment_plan_id uuid,
  p_branch_id uuid
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_credit numeric;
  v_remaining numeric;
  v_apply numeric;
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_treasury_id uuid;
BEGIN
  SELECT COALESCE(balance,0), tenant_id INTO v_credit, v_tenant FROM contacts WHERE id = p_contact_id;
  IF v_credit IS NULL OR v_credit <= 0 THEN RETURN 0; END IF;

  SELECT GREATEST(total_amount - COALESCE(paid_amount,0), 0) INTO v_remaining
  FROM payment_plans WHERE id = p_payment_plan_id;
  IF v_remaining IS NULL OR v_remaining <= 0 THEN RETURN 0; END IF;

  v_apply := LEAST(v_credit, v_remaining);
  IF v_apply <= 0 THEN RETURN 0; END IF;

  -- Record a synthetic payment transaction (no treasury impact, no real cash movement)
  INSERT INTO payment_transactions(
    tenant_id, branch_id, payment_plan_id, installment_id, direction,
    amount, payment_method, fee_amount, total_with_fee,
    created_by, contact_id
  ) VALUES (
    v_tenant, p_branch_id, p_payment_plan_id, NULL, 'out',
    v_apply, 'supplier_credit', 0, v_apply,
    v_uid, p_contact_id
  );

  -- Update plan
  UPDATE payment_plans SET
    paid_amount = COALESCE(paid_amount,0) + v_apply,
    remaining_amount = GREATEST(total_amount - (COALESCE(paid_amount,0) + v_apply), 0),
    status = CASE WHEN total_amount - (COALESCE(paid_amount,0) + v_apply) <= 0 THEN 'settled' ELSE status END,
    updated_at = now()
  WHERE id = p_payment_plan_id;

  -- Decrease supplier credit
  UPDATE contacts SET balance = COALESCE(balance,0) - v_apply WHERE id = p_contact_id;

  RETURN v_apply;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_supplier_credit(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_contact_payment(uuid, uuid, text, numeric, text, text, text, text, numeric, text, boolean, text, text) TO authenticated;

-- Ensure realtime is on for the relevant tables
ALTER TABLE public.payment_transactions REPLICA IDENTITY FULL;
ALTER TABLE public.contacts REPLICA IDENTITY FULL;
ALTER TABLE public.payment_plans REPLICA IDENTITY FULL;

DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_transactions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.contacts; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_plans; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
