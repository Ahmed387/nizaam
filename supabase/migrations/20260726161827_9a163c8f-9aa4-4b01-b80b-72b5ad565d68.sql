
-- 1) payment_transactions: add invoice_id + widen payment_method check
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payment_transactions_invoice_id ON public.payment_transactions(invoice_id);

ALTER TABLE public.payment_transactions
  DROP CONSTRAINT IF EXISTS payment_transactions_payment_method_check;
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_payment_method_check
  CHECK (payment_method = ANY (ARRAY['cash','vodafone','instapay','bank','settlement','credit_balance']));

-- 2) record_contact_payment: accept optional p_invoice_id + settlement method
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
  p_notes text DEFAULT NULL::text,
  p_transfer_from_account text DEFAULT NULL::text,
  p_invoice_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_uid uuid := auth.uid(); v_total_with_fee numeric;
  v_tx_id uuid; v_treasury_id uuid; v_fee_treasury_id uuid;
  v_contact record; v_remaining numeric; v_plan record; v_inst record;
  v_alloc numeric; v_inst_alloc numeric; v_plan_remaining numeric; v_inst_remaining numeric;
  v_is_settlement boolean := (p_payment_method = 'settlement');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT v_is_settlement THEN
    PERFORM public._validate_transfer_payment(p_payment_method, p_reference_number, p_transfer_from_account, p_transfer_to_account);
  END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_direction NOT IN ('in','out') THEN RAISE EXCEPTION 'direction must be in/out'; END IF;
  SELECT * INTO v_contact FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contact not found'; END IF;

  IF v_contact.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'contact does not belong to your tenant'; END IF;
  IF NOT (
    public.is_super_admin(v_uid)
    OR public.has_role(v_uid, 'admin'::app_role)
    OR (public.user_in_branch(v_uid, p_branch_id)
        AND (public.has_role(v_uid, 'branch_manager'::app_role)
             OR public.has_role(v_uid, 'accountant'::app_role)
             OR public.has_role(v_uid, 'cashier'::app_role)))
  ) THEN RAISE EXCEPTION 'insufficient permissions'; END IF;

  v_tenant := v_contact.tenant_id;
  v_total_with_fee := p_amount + CASE WHEN p_fee_on_customer THEN COALESCE(p_fee_amount,0) ELSE 0 END;

  -- Settlement does NOT move cash; skip treasury row.
  IF NOT v_is_settlement THEN
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
  END IF;

  INSERT INTO payment_transactions(tenant_id, branch_id, invoice_id, payment_plan_id, installment_id, direction, amount, payment_method, fee_amount, fee_type, total_with_fee, reference_number, transfer_to_account, transfer_from_account, received_by_name, created_by, treasury_id, fee_treasury_id, contact_id)
  VALUES (v_tenant, p_branch_id, p_invoice_id, NULL, NULL, p_direction, p_amount, p_payment_method, COALESCE(p_fee_amount,0), p_fee_type, v_total_with_fee, p_reference_number, p_transfer_to_account, p_transfer_from_account, p_received_by_name, v_uid, v_treasury_id, v_fee_treasury_id, p_contact_id)
  RETURNING id INTO v_tx_id;

  -- Mirror into invoice_payments when this payment is against a specific invoice
  IF p_invoice_id IS NOT NULL THEN
    INSERT INTO invoice_payments(invoice_id, tenant_id, branch_id, payment_method, amount, reference_number, received_by_name, transfer_to_account, transfer_from_account, fee_amount, fee_on_customer)
    VALUES (p_invoice_id, v_tenant, p_branch_id, p_payment_method, p_amount, p_reference_number, p_received_by_name, p_transfer_to_account, p_transfer_from_account, COALESCE(p_fee_amount,0), COALESCE(p_fee_on_customer,false));
  END IF;

  v_remaining := p_amount;
  IF p_direction = 'out' AND NOT v_is_settlement THEN
    FOR v_plan IN SELECT * FROM payment_plans
      WHERE entity_type='supplier' AND entity_id=p_contact_id AND tenant_id=v_tenant
        AND status='active' AND COALESCE(total_amount,0) - COALESCE(paid_amount,0) > 0.01
      ORDER BY created_at ASC LOOP
      EXIT WHEN v_remaining <= 0.01;
      v_plan_remaining := GREATEST(0, v_plan.total_amount - COALESCE(v_plan.paid_amount,0));
      v_alloc := LEAST(v_remaining, v_plan_remaining);
      IF v_alloc <= 0 THEN CONTINUE; END IF;
      FOR v_inst IN SELECT * FROM payment_installments
        WHERE payment_plan_id=v_plan.id AND status <> 'paid'
          AND COALESCE(amount,0) - COALESCE(paid_amount,0) > 0.01
        ORDER BY installment_number ASC LOOP
        EXIT WHEN v_alloc <= 0.01;
        v_inst_remaining := GREATEST(0, v_inst.amount - COALESCE(v_inst.paid_amount,0));
        v_inst_alloc := LEAST(v_alloc, v_inst_remaining);
        UPDATE payment_installments
        SET paid_amount = COALESCE(paid_amount,0) + v_inst_alloc,
            status = CASE WHEN COALESCE(paid_amount,0) + v_inst_alloc >= amount - 0.01 THEN 'paid' ELSE 'partial' END,
            paid_at = CASE WHEN COALESCE(paid_amount,0) + v_inst_alloc >= amount - 0.01 THEN now() ELSE paid_at END,
            updated_at = now()
        WHERE id = v_inst.id;
        v_alloc := v_alloc - v_inst_alloc;
      END LOOP;
      UPDATE payment_plans
      SET paid_amount = COALESCE(paid_amount,0) + LEAST(v_remaining, v_plan_remaining),
          remaining_amount = GREATEST(0, total_amount - (COALESCE(paid_amount,0) + LEAST(v_remaining, v_plan_remaining))),
          status = CASE WHEN (COALESCE(paid_amount,0) + LEAST(v_remaining, v_plan_remaining)) >= total_amount - 0.01 THEN 'settled' ELSE status END,
          updated_at = now()
      WHERE id = v_plan.id;
      v_remaining := v_remaining - LEAST(v_remaining, v_plan_remaining);
    END LOOP;
  END IF;

  PERFORM public.recalc_contact_balance(p_contact_id);
  RETURN v_tx_id;
END;
$function$;

-- 3) Batch upsert for inventory counts (single round-trip)
CREATE OR REPLACE FUNCTION public.upsert_inventory_counts(
  _session_id uuid,
  _items jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer := 0;
  v_item jsonb;
  v_session record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO v_session FROM inventory_sessions WHERE id = _session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found'; END IF;

  IF v_session.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'session does not belong to your tenant';
  END IF;
  IF v_session.status <> 'counting' THEN
    RAISE EXCEPTION 'session is not in counting stage';
  END IF;
  IF NOT (
    public.is_super_admin(v_uid)
    OR public.has_role(v_uid, 'admin'::app_role)
    OR public.has_role(v_uid, 'warehouse'::app_role)
  ) THEN
    RAISE EXCEPTION 'insufficient permissions';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    UPDATE inventory_session_items
    SET actual_quantity = NULLIF((v_item->>'actual_quantity'),'')::numeric,
        updated_at = now()
    WHERE id = (v_item->>'id')::uuid
      AND session_id = _session_id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;
