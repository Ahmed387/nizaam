
-- ================================================================
-- Direct edit for invoice payments & plan transactions with history
-- ================================================================

-- 1) Edit an invoice-level payment (initial payment on invoice)
CREATE OR REPLACE FUNCTION public.edit_invoice_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text DEFAULT NULL,
  p_transfer_to_account text DEFAULT NULL,
  p_transfer_from_account text DEFAULT NULL,
  p_fee_amount numeric DEFAULT NULL,
  p_fee_on_customer boolean DEFAULT NULL,
  p_received_by_name text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay record;
  v_inv record;
  v_uid uuid := auth.uid();
  v_new_amount numeric := COALESCE(p_amount, 0);
  v_new_fee numeric;
  v_new_fee_on_cust boolean;
  v_amount_delta numeric;
  v_fee_delta numeric;
  v_details jsonb;
BEGIN
  IF p_payment_id IS NULL THEN RAISE EXCEPTION 'payment id required'; END IF;
  IF v_new_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  IF p_payment_method IS NULL OR btrim(p_payment_method) = '' THEN
    RAISE EXCEPTION 'payment method required';
  END IF;

  SELECT * INTO v_pay FROM public.invoice_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment not found'; END IF;
  IF v_pay.voided_at IS NOT NULL THEN RAISE EXCEPTION 'cannot edit a voided payment'; END IF;
  IF v_pay.reverses_payment_id IS NOT NULL THEN RAISE EXCEPTION 'cannot edit a reversal entry'; END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = v_pay.invoice_id;

  v_new_fee := COALESCE(p_fee_amount, v_pay.fee_amount, 0);
  v_new_fee_on_cust := COALESCE(p_fee_on_customer, v_pay.fee_on_customer, false);
  v_amount_delta := v_new_amount - COALESCE(v_pay.amount, 0);
  v_fee_delta := v_new_fee - COALESCE(v_pay.fee_amount, 0);

  -- Treasury adjustment: reverse the OLD payment effect and apply the NEW.
  -- Two entries so audit trail on treasury is preserved.
  IF COALESCE(v_pay.amount, 0) <> 0 THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      payment_method, reference_number, transfer_to_account, transfer_from_account,
      reference_id, created_by, tenant_id
    ) VALUES (
      v_pay.branch_id, 'expense', 'payment_edit_reversal', v_pay.amount,
      'تصحيح دفعة على فاتورة ' || COALESCE(v_inv.invoice_number, '') || ' — عكس القيمة القديمة'
        || COALESCE(' — ' || p_reason, ''),
      v_pay.payment_method, v_pay.reference_number,
      v_pay.transfer_to_account, v_pay.transfer_from_account,
      v_pay.invoice_id, v_uid, v_pay.tenant_id
    );
  END IF;

  IF v_new_amount <> 0 THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      payment_method, reference_number, transfer_to_account, transfer_from_account,
      reference_id, created_by, tenant_id
    ) VALUES (
      v_pay.branch_id, 'income', 'payment_edit_new', v_new_amount,
      'تصحيح دفعة على فاتورة ' || COALESCE(v_inv.invoice_number, '') || ' — القيمة الجديدة'
        || COALESCE(' — ' || p_reason, ''),
      p_payment_method,
      COALESCE(p_reference_number, v_pay.reference_number),
      COALESCE(p_transfer_to_account, v_pay.transfer_to_account),
      COALESCE(p_transfer_from_account, v_pay.transfer_from_account),
      v_pay.invoice_id, v_uid, v_pay.tenant_id
    );
  END IF;

  -- Fee adjustments if fee (borne by company) changed
  IF v_fee_delta <> 0 AND NOT v_new_fee_on_cust THEN
    INSERT INTO public.expenses(
      branch_id, type, amount, description, date,
      payment_method, reference_number, is_fee, created_by, tenant_id
    ) VALUES (
      v_pay.branch_id, 'تعديل عمولة تحويل', v_fee_delta,
      'تعديل عمولة ' || p_payment_method || ' — فاتورة ' || COALESCE(v_inv.invoice_number, ''),
      CURRENT_DATE, p_payment_method,
      COALESCE(p_reference_number, v_pay.reference_number),
      true, v_uid, v_pay.tenant_id
    );
    IF v_fee_delta > 0 THEN
      INSERT INTO public.treasury(branch_id, type, category, amount, description, payment_method, created_by, tenant_id)
      VALUES (v_pay.branch_id, 'expense', 'fee_edit', v_fee_delta,
              'زيادة عمولة ' || p_payment_method, p_payment_method, v_uid, v_pay.tenant_id);
    ELSE
      INSERT INTO public.treasury(branch_id, type, category, amount, description, payment_method, created_by, tenant_id)
      VALUES (v_pay.branch_id, 'income', 'fee_edit', -v_fee_delta,
              'خصم عمولة ' || p_payment_method, p_payment_method, v_uid, v_pay.tenant_id);
    END IF;
  END IF;

  -- Build old/new snapshot for audit log
  v_details := jsonb_build_object(
    'old', jsonb_build_object(
      'amount', v_pay.amount,
      'payment_method', v_pay.payment_method,
      'reference_number', v_pay.reference_number,
      'transfer_to_account', v_pay.transfer_to_account,
      'transfer_from_account', v_pay.transfer_from_account,
      'fee_amount', v_pay.fee_amount,
      'fee_on_customer', v_pay.fee_on_customer,
      'received_by_name', v_pay.received_by_name
    ),
    'new', jsonb_build_object(
      'amount', v_new_amount,
      'payment_method', p_payment_method,
      'reference_number', COALESCE(p_reference_number, v_pay.reference_number),
      'transfer_to_account', COALESCE(p_transfer_to_account, v_pay.transfer_to_account),
      'transfer_from_account', COALESCE(p_transfer_from_account, v_pay.transfer_from_account),
      'fee_amount', v_new_fee,
      'fee_on_customer', v_new_fee_on_cust,
      'received_by_name', COALESCE(p_received_by_name, v_pay.received_by_name)
    ),
    'reason', p_reason,
    'invoice_id', v_pay.invoice_id,
    'invoice_number', v_inv.invoice_number
  );

  -- Update the payment row in-place
  UPDATE public.invoice_payments SET
    amount = v_new_amount,
    payment_method = p_payment_method,
    reference_number = COALESCE(p_reference_number, reference_number),
    transfer_to_account = COALESCE(p_transfer_to_account, transfer_to_account),
    transfer_from_account = COALESCE(p_transfer_from_account, transfer_from_account),
    fee_amount = v_new_fee,
    fee_on_customer = v_new_fee_on_cust,
    received_by_name = COALESCE(p_received_by_name, received_by_name)
  WHERE id = p_payment_id;

  -- History
  INSERT INTO public.audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
  VALUES (
    v_uid,
    (SELECT full_name FROM public.profiles WHERE id = v_uid),
    v_pay.branch_id, 'payment_edited', 'invoice_payment', p_payment_id::text,
    v_details, v_pay.tenant_id
  );

  RETURN p_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_invoice_payment(uuid, numeric, text, text, text, text, numeric, boolean, text, text) TO authenticated;


-- 2) Edit a plan payment transaction
CREATE OR REPLACE FUNCTION public.edit_payment_transaction(
  p_tx_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text DEFAULT NULL,
  p_transfer_to_account text DEFAULT NULL,
  p_transfer_from_account text DEFAULT NULL,
  p_fee_amount numeric DEFAULT NULL,
  p_received_by_name text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx record;
  v_plan record;
  v_uid uuid := auth.uid();
  v_new_amount numeric := COALESCE(p_amount, 0);
  v_new_fee numeric;
  v_amount_delta numeric;
  v_fee_delta numeric;
  v_signed_delta numeric;
  v_details jsonb;
BEGIN
  IF p_tx_id IS NULL THEN RAISE EXCEPTION 'tx id required'; END IF;
  IF v_new_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;

  SELECT * INTO v_tx FROM public.payment_transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction not found'; END IF;
  IF v_tx.voided_at IS NOT NULL THEN RAISE EXCEPTION 'cannot edit voided tx'; END IF;
  IF v_tx.reverses_tx_id IS NOT NULL THEN RAISE EXCEPTION 'cannot edit reversal entry'; END IF;

  SELECT * INTO v_plan FROM public.payment_plans WHERE id = v_tx.payment_plan_id FOR UPDATE;

  v_new_fee := COALESCE(p_fee_amount, v_tx.fee_amount, 0);
  v_amount_delta := v_new_amount - COALESCE(v_tx.amount, 0);
  v_fee_delta := v_new_fee - COALESCE(v_tx.fee_amount, 0);
  v_signed_delta := CASE WHEN v_tx.direction = 'in' THEN v_amount_delta ELSE -v_amount_delta END;

  -- Treasury reverse-then-reapply
  IF COALESCE(v_tx.amount, 0) <> 0 THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      payment_method, reference_number, transfer_to_account, transfer_from_account,
      created_by, tenant_id
    ) VALUES (
      v_tx.branch_id,
      (CASE WHEN v_tx.direction = 'in' THEN 'expense' ELSE 'income' END)::treasury_type,
      'payment_edit_reversal', v_tx.amount,
      'تصحيح دفعة #' || substr(v_tx.id::text,1,8) || ' — عكس القديم'
        || COALESCE(' — ' || p_reason, ''),
      v_tx.payment_method, v_tx.reference_number,
      v_tx.transfer_to_account, v_tx.transfer_from_account,
      v_uid, v_tx.tenant_id
    );
  END IF;

  IF v_new_amount <> 0 THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      payment_method, reference_number, transfer_to_account, transfer_from_account,
      created_by, tenant_id
    ) VALUES (
      v_tx.branch_id,
      (CASE WHEN v_tx.direction = 'in' THEN 'income' ELSE 'expense' END)::treasury_type,
      'payment_edit_new', v_new_amount,
      'تصحيح دفعة #' || substr(v_tx.id::text,1,8) || ' — القيمة الجديدة'
        || COALESCE(' — ' || p_reason, ''),
      p_payment_method,
      COALESCE(p_reference_number, v_tx.reference_number),
      COALESCE(p_transfer_to_account, v_tx.transfer_to_account),
      COALESCE(p_transfer_from_account, v_tx.transfer_from_account),
      v_uid, v_tx.tenant_id
    );
  END IF;

  -- Fee delta (borne by company only)
  IF v_fee_delta <> 0 THEN
    INSERT INTO public.expenses(
      branch_id, type, amount, description, date,
      payment_method, reference_number, is_fee, created_by, tenant_id
    ) VALUES (
      v_tx.branch_id, 'تعديل عمولة تحويل', v_fee_delta,
      'تعديل عمولة ' || p_payment_method || ' — دفعة #' || substr(v_tx.id::text,1,8),
      CURRENT_DATE, p_payment_method,
      COALESCE(p_reference_number, v_tx.reference_number), true, v_uid, v_tx.tenant_id
    );
    IF v_fee_delta > 0 THEN
      INSERT INTO public.treasury(branch_id, type, category, amount, description, payment_method, is_fee, created_by, tenant_id)
      VALUES (v_tx.branch_id, 'expense'::treasury_type, 'fee_edit', v_fee_delta,
              'زيادة عمولة ' || p_payment_method, p_payment_method, true, v_uid, v_tx.tenant_id);
    ELSE
      INSERT INTO public.treasury(branch_id, type, category, amount, description, payment_method, is_fee, created_by, tenant_id)
      VALUES (v_tx.branch_id, 'income'::treasury_type, 'fee_edit', -v_fee_delta,
              'خصم عمولة ' || p_payment_method, p_payment_method, true, v_uid, v_tx.tenant_id);
    END IF;
  END IF;

  -- Installment adjustment (only for direction 'in')
  IF v_tx.installment_id IS NOT NULL AND v_tx.direction = 'in' AND v_amount_delta <> 0 THEN
    UPDATE public.payment_installments
       SET paid_amount = GREATEST(COALESCE(paid_amount, 0) + v_amount_delta, 0),
           updated_at  = now()
     WHERE id = v_tx.installment_id;
  END IF;

  -- Plan adjustment
  IF v_plan.id IS NOT NULL AND v_tx.direction = 'in' AND v_amount_delta <> 0 THEN
    UPDATE public.payment_plans
       SET paid_amount      = GREATEST(COALESCE(paid_amount, 0) + v_amount_delta, 0),
           remaining_amount = GREATEST(COALESCE(total_amount, 0) - GREATEST(COALESCE(paid_amount, 0) + v_amount_delta, 0), 0),
           updated_at       = now()
     WHERE id = v_plan.id;
  END IF;

  v_details := jsonb_build_object(
    'old', jsonb_build_object(
      'amount', v_tx.amount,
      'payment_method', v_tx.payment_method,
      'reference_number', v_tx.reference_number,
      'transfer_to_account', v_tx.transfer_to_account,
      'transfer_from_account', v_tx.transfer_from_account,
      'fee_amount', v_tx.fee_amount,
      'received_by_name', v_tx.received_by_name
    ),
    'new', jsonb_build_object(
      'amount', v_new_amount,
      'payment_method', p_payment_method,
      'reference_number', COALESCE(p_reference_number, v_tx.reference_number),
      'transfer_to_account', COALESCE(p_transfer_to_account, v_tx.transfer_to_account),
      'transfer_from_account', COALESCE(p_transfer_from_account, v_tx.transfer_from_account),
      'fee_amount', v_new_fee,
      'received_by_name', COALESCE(p_received_by_name, v_tx.received_by_name)
    ),
    'reason', p_reason,
    'payment_plan_id', v_tx.payment_plan_id,
    'installment_id', v_tx.installment_id
  );

  UPDATE public.payment_transactions SET
    amount = v_new_amount,
    payment_method = p_payment_method,
    reference_number = COALESCE(p_reference_number, reference_number),
    transfer_to_account = COALESCE(p_transfer_to_account, transfer_to_account),
    transfer_from_account = COALESCE(p_transfer_from_account, transfer_from_account),
    fee_amount = v_new_fee,
    total_with_fee = v_new_amount + COALESCE(v_new_fee, 0),
    received_by_name = COALESCE(p_received_by_name, received_by_name)
  WHERE id = p_tx_id;

  INSERT INTO public.audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
  VALUES (
    v_uid,
    (SELECT full_name FROM public.profiles WHERE id = v_uid),
    v_tx.branch_id, 'payment_edited', 'payment_transaction', p_tx_id::text,
    v_details, v_tx.tenant_id
  );

  RETURN p_tx_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_payment_transaction(uuid, numeric, text, text, text, text, numeric, text, text) TO authenticated;
