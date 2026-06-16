
-- ============================================================
-- STEP 1: Drop legacy delta triggers (double-counting bugs)
-- ============================================================
DROP TRIGGER IF EXISTS trg_shipments_contact_balance ON public.shipments;
DROP TRIGGER IF EXISTS trg_supplier_payments_contact_balance ON public.supplier_payments;
DROP TRIGGER IF EXISTS trg_purchase_returns_contact_balance ON public.purchase_returns;
DROP FUNCTION IF EXISTS public.tg_shipments_contact_balance() CASCADE;
DROP FUNCTION IF EXISTS public.tg_supplier_payments_contact_balance() CASCADE;
DROP FUNCTION IF EXISTS public.tg_purchase_returns_contact_balance() CASCADE;
DROP FUNCTION IF EXISTS public.contact_balance_apply(uuid, numeric) CASCADE;

-- ============================================================
-- STEP 3: Unify record_contact_payment with recalc system
-- Approach A: include payment_transactions (standalone, no plan)
-- in recalc_contact_balance, and add trigger on payment_transactions
-- to refresh the balance automatically. Remove the direct UPDATE
-- inside record_contact_payment so trigger is the single source.
-- ============================================================

CREATE OR REPLACE FUNCTION public.recalc_contact_balance(_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_type text;
  v_balance numeric := 0;
BEGIN
  SELECT type INTO c_type FROM public.contacts WHERE id = _contact_id;
  IF c_type IS NULL THEN RETURN; END IF;

  IF c_type = 'customer' THEN
    v_balance := v_balance + COALESCE((
      SELECT SUM(total) FROM public.invoices
       WHERE contact_id = _contact_id AND status = 'active'
    ), 0);
    v_balance := v_balance - COALESCE((
      SELECT SUM(ip.amount) FROM public.invoice_payments ip
       JOIN public.invoices i ON i.id = ip.invoice_id
       WHERE i.contact_id = _contact_id AND i.status = 'active'
    ), 0);
    v_balance := v_balance - COALESCE((
      SELECT SUM(COALESCE(r.refund_balance_amount, 0)) FROM public.returns r
       JOIN public.invoices i ON i.id = r.invoice_id
       WHERE i.contact_id = _contact_id AND COALESCE(r.status, 'active') = 'active'
    ), 0);
    v_balance := v_balance - COALESCE((
      SELECT SUM(amount) FROM public.vouchers
       WHERE party_id = _contact_id AND party_type = 'customer'
         AND source = 'manual' AND status = 'active'
    ), 0);
    -- NEW: standalone contact payments (no plan / no installment)
    -- direction='in' (we received) -> reduces customer debt -> subtract
    -- direction='out' (we refunded) -> increases customer credit balance -> add
    v_balance := v_balance + COALESCE((
      SELECT SUM(CASE WHEN direction = 'out' THEN amount ELSE -amount END)
        FROM public.payment_transactions
       WHERE contact_id = _contact_id
         AND payment_plan_id IS NULL
         AND installment_id IS NULL
    ), 0);

  ELSIF c_type = 'supplier' THEN
    v_balance := v_balance - COALESCE((
      SELECT SUM(si.quantity * COALESCE(si.true_unit_cost, si.cost_price, 0))
        FROM public.shipments s
        JOIN public.shipment_items si ON si.shipment_id = s.id
       WHERE s.contact_id = _contact_id
    ), 0);
    v_balance := v_balance + COALESCE((
      SELECT SUM(amount) FROM public.supplier_payments WHERE contact_id = _contact_id
    ), 0);
    v_balance := v_balance + COALESCE((
      SELECT SUM(COALESCE(total_amount, 0)) FROM public.purchase_returns WHERE contact_id = _contact_id
    ), 0);
    v_balance := v_balance + COALESCE((
      SELECT SUM(CASE WHEN type='payment' THEN amount ELSE -amount END)
        FROM public.vouchers
       WHERE party_id = _contact_id AND party_type = 'supplier'
         AND source = 'manual' AND status = 'active'
    ), 0);
    -- NEW: standalone contact payments (no plan / no installment)
    -- direction='out' (we paid supplier) -> reduces what we owe -> add
    -- direction='in' (supplier paid us back) -> reduces what they owe us -> subtract
    v_balance := v_balance + COALESCE((
      SELECT SUM(CASE WHEN direction = 'out' THEN amount ELSE -amount END)
        FROM public.payment_transactions
       WHERE contact_id = _contact_id
         AND payment_plan_id IS NULL
         AND installment_id IS NULL
    ), 0);
  END IF;

  UPDATE public.contacts SET balance = v_balance WHERE id = _contact_id;
END;
$function$;

-- Trigger on payment_transactions to recompute the affected contact's balance
CREATE OR REPLACE FUNCTION public.trg_payment_tx_refresh_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  old_cid uuid;
  new_cid uuid;
BEGIN
  old_cid := (CASE WHEN TG_OP <> 'INSERT' THEN OLD.contact_id END);
  new_cid := (CASE WHEN TG_OP <> 'DELETE' THEN NEW.contact_id END);
  IF old_cid IS NOT NULL THEN PERFORM public.recalc_contact_balance(old_cid); END IF;
  IF new_cid IS NOT NULL AND new_cid IS DISTINCT FROM old_cid THEN
    PERFORM public.recalc_contact_balance(new_cid);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_balance_payment_transactions ON public.payment_transactions;
CREATE TRIGGER trg_balance_payment_transactions
AFTER INSERT OR UPDATE OR DELETE ON public.payment_transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_payment_tx_refresh_balance();

-- Patch record_contact_payment: remove the direct balance UPDATE
-- (trigger above is now the single source of truth)
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
  v_tenant uuid; v_uid uuid := auth.uid(); v_total_with_fee numeric;
  v_tx_id uuid; v_treasury_id uuid; v_fee_treasury_id uuid;
  v_contact record; v_remaining numeric; v_plan record; v_inst record;
  v_alloc numeric; v_inst_alloc numeric; v_plan_remaining numeric;
  v_inst_remaining numeric;
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

  v_remaining := p_amount;

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
      FOR v_inst IN
        SELECT * FROM payment_installments
        WHERE payment_plan_id=v_plan.id AND status <> 'paid'
          AND COALESCE(amount,0) - COALESCE(paid_amount,0) > 0.01
        ORDER BY installment_number ASC
      LOOP
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

  -- NOTE: balance update is now handled automatically by
  -- trg_balance_payment_transactions on payment_transactions insert.
  RETURN v_tx_id;
END;
$function$;

-- ============================================================
-- STEP 4: Full recalculation pass for all contacts
-- ============================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.contacts LOOP
    PERFORM public.recalc_contact_balance(r.id);
  END LOOP;
END $$;
