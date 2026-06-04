-- 1) Add contact_id link to payment_transactions for ad-hoc payments
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pt_contact ON public.payment_transactions(contact_id);

-- 2) Update the RPC to populate it
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
  p_notes text DEFAULT NULL
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

  INSERT INTO treasury(tenant_id, branch_id, type, category, amount, description, reference_id, created_by)
  VALUES (
    v_tenant, p_branch_id,
    CASE WHEN p_direction = 'in' THEN 'income' ELSE 'expense' END,
    CASE WHEN p_direction = 'in' THEN 'customer_payment' ELSE 'supplier_payment' END,
    v_total_with_fee,
    COALESCE(p_notes, CASE WHEN p_direction='in' THEN 'تحصيل من ' ELSE 'سداد إلى ' END || v_contact.name)
      || ' — ' || p_payment_method,
    p_contact_id, v_uid
  ) RETURNING id INTO v_treasury_id;

  IF COALESCE(p_fee_amount,0) > 0 AND NOT p_fee_on_customer THEN
    INSERT INTO treasury(tenant_id, branch_id, type, category, amount, description, reference_id, created_by)
    VALUES (
      v_tenant, p_branch_id, 'expense', 'transfer_fee', p_fee_amount,
      'عمولة تحويل (' || p_payment_method || ') — ' || v_contact.name, p_contact_id, v_uid
    ) RETURNING id INTO v_fee_treasury_id;
  END IF;

  INSERT INTO payment_transactions(
    tenant_id, branch_id, payment_plan_id, installment_id, direction,
    amount, payment_method, fee_amount, fee_type, total_with_fee,
    reference_number, transfer_to_account, received_by_name,
    created_by, treasury_id, fee_treasury_id, contact_id
  ) VALUES (
    v_tenant, p_branch_id, NULL, NULL, p_direction,
    p_amount, p_payment_method, COALESCE(p_fee_amount,0), p_fee_type, v_total_with_fee,
    p_reference_number, p_transfer_to_account, p_received_by_name,
    v_uid, v_treasury_id, v_fee_treasury_id, p_contact_id
  ) RETURNING id INTO v_tx_id;

  UPDATE contacts
  SET balance = balance + CASE WHEN p_direction = 'in' THEN -p_amount ELSE p_amount END
  WHERE id = p_contact_id;

  RETURN v_tx_id;
END;
$$;