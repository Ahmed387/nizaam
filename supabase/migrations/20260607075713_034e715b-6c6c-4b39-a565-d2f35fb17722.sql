
CREATE OR REPLACE FUNCTION public.record_contact_payment(
  p_contact_id uuid, p_branch_id uuid, p_direction text, p_amount numeric,
  p_payment_method text, p_reference_number text, p_transfer_to_account text,
  p_received_by_name text, p_fee_amount numeric, p_fee_type text,
  p_fee_on_customer boolean, p_notes text DEFAULT NULL::text,
  p_transfer_from_account text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_uid uuid := auth.uid();
  v_total_with_fee numeric;
  v_tx_id uuid;
  v_treasury_id uuid;
  v_fee_treasury_id uuid;
  v_contact record;
  v_remaining numeric;
  v_plan record;
  v_inst record;
  v_alloc numeric;
  v_inst_alloc numeric;
  v_plan_remaining numeric;
  v_inst_remaining numeric;
  v_balance_delta numeric;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_direction NOT IN ('in','out') THEN RAISE EXCEPTION 'direction must be in/out'; END IF;

  SELECT * INTO v_contact FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contact not found'; END IF;
  v_tenant := v_contact.tenant_id;

  v_total_with_fee := p_amount + CASE WHEN p_fee_on_customer THEN COALESCE(p_fee_amount,0) ELSE 0 END;

  -- Treasury entry
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

  -- Single payment_transactions row (for transaction history)
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

  -- ====== Auto-allocate to open payment_plans (FIFO oldest first) ======
  v_remaining := p_amount;
  v_balance_delta := 0;

  IF p_direction = 'out' THEN
    -- Supplier: pay against open supplier payment plans
    FOR v_plan IN
      SELECT * FROM payment_plans
      WHERE entity_type = 'supplier'
        AND entity_id = p_contact_id
        AND tenant_id = v_tenant
        AND status = 'active'
        AND COALESCE(remaining_amount, total_amount - COALESCE(paid_amount,0)) > 0.01
      ORDER BY created_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0.01;
      v_plan_remaining := GREATEST(0, COALESCE(v_plan.total_amount,0) - COALESCE(v_plan.paid_amount,0));
      v_alloc := LEAST(v_remaining, v_plan_remaining);
      IF v_alloc <= 0 THEN CONTINUE; END IF;

      -- Distribute across plan's pending installments
      DECLARE v_left numeric := v_alloc;
      BEGIN
        FOR v_inst IN
          SELECT * FROM payment_installments
          WHERE payment_plan_id = v_plan.id
            AND status <> 'paid'
            AND COALESCE(amount,0) - COALESCE(paid_amount,0) > 0.01
          ORDER BY installment_number ASC
        LOOP
          EXIT WHEN v_left <= 0.01;
          v_inst_remaining := GREATEST(0, COALESCE(v_inst.amount,0) - COALESCE(v_inst.paid_amount,0));
          v_inst_alloc := LEAST(v_left, v_inst_remaining);
          UPDATE payment_installments
          SET paid_amount = COALESCE(paid_amount,0) + v_inst_alloc,
              status = CASE WHEN COALESCE(paid_amount,0) + v_inst_alloc >= COALESCE(amount,0) - 0.01 THEN 'paid' ELSE 'partial' END,
              paid_at = CASE WHEN COALESCE(paid_amount,0) + v_inst_alloc >= COALESCE(amount,0) - 0.01 THEN now() ELSE paid_at END,
              updated_at = now()
          WHERE id = v_inst.id;
          v_left := v_left - v_inst_alloc;
        END LOOP;
      END;

      -- Update the plan totals
      UPDATE payment_plans
      SET paid_amount = COALESCE(paid_amount,0) + v_alloc,
          remaining_amount = GREATEST(0, COALESCE(total_amount,0) - (COALESCE(paid_amount,0) + v_alloc)),
          status = CASE WHEN (COALESCE(paid_amount,0) + v_alloc) >= COALESCE(total_amount,0) - 0.01 THEN 'completed' ELSE status END,
          updated_at = now()
      WHERE id = v_plan.id;

      v_remaining := v_remaining - v_alloc;
    END LOOP;

    -- Any overpayment → supplier credit (positive balance)
    v_balance_delta := v_remaining;
  ELSE
    -- direction = 'in' from customer: decrease balance (similar logic could apply to invoice plans, keep existing)
    v_balance_delta := -p_amount;
  END IF;

  UPDATE contacts
  SET balance = COALESCE(balance,0) + v_balance_delta
  WHERE id = p_contact_id;

  RETURN v_tx_id;
END;
$function$;

-- Ensure realtime
ALTER TABLE public.payment_plans REPLICA IDENTITY FULL;
ALTER TABLE public.payment_installments REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_plans;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_installments;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
