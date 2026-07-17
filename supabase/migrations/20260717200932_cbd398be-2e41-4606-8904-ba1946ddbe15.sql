
-- 1) Audit columns on payment_transactions
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_by_tx_id uuid REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reverses_tx_id uuid REFERENCES public.payment_transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pt_voided_at ON public.payment_transactions(voided_at);
CREATE INDEX IF NOT EXISTS idx_pt_reverses_tx_id ON public.payment_transactions(reverses_tx_id);

-- 2) RPC: void_payment_transaction
CREATE OR REPLACE FUNCTION public.void_payment_transaction(
  p_tx_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tx           record;
  v_plan         record;
  v_new_tx_id    uuid;
  v_rev_treasury uuid;
  v_rev_fee_tres uuid;
  v_uid          uuid := auth.uid();
  v_rev_direction text;
BEGIN
  IF p_tx_id IS NULL THEN RAISE EXCEPTION 'tx id required'; END IF;

  SELECT * INTO v_tx FROM public.payment_transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction not found'; END IF;
  IF v_tx.voided_at IS NOT NULL THEN RAISE EXCEPTION 'transaction already voided'; END IF;
  IF v_tx.reverses_tx_id IS NOT NULL THEN RAISE EXCEPTION 'cannot void a reversal entry'; END IF;

  IF v_tx.payment_plan_id IS NULL THEN RAISE EXCEPTION 'transaction not linked to a payment plan'; END IF;

  SELECT * INTO v_plan FROM public.payment_plans WHERE id = v_tx.payment_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan not found'; END IF;

  v_rev_direction := CASE WHEN v_tx.direction = 'in' THEN 'out' ELSE 'in' END;

  -- Reverse main treasury entry (opposite type, same amount)
  INSERT INTO public.treasury(
    branch_id, type, category, amount, description,
    payment_method, reference_number, transfer_to_account, transfer_from_account,
    created_by, tenant_id
  ) VALUES (
    v_tx.branch_id,
    (CASE WHEN v_tx.direction = 'in' THEN 'expense' ELSE 'income' END)::treasury_type,
    CASE WHEN v_tx.direction = 'in' THEN 'payment_in_void' ELSE 'payment_out_void' END,
    v_tx.amount,
    'إلغاء دفعة #' || substr(v_tx.id::text, 1, 8)
      || COALESCE(' — ' || v_plan.entity_name, '')
      || COALESCE(' — ' || p_reason, ''),
    v_tx.payment_method, v_tx.reference_number,
    v_tx.transfer_to_account, v_tx.transfer_from_account,
    v_uid, v_tx.tenant_id
  ) RETURNING id INTO v_rev_treasury;

  -- Reverse fee entries if any (fee was borne by company)
  IF COALESCE(v_tx.fee_amount, 0) > 0 AND v_tx.fee_treasury_id IS NOT NULL THEN
    -- opposite expense entry (as income offset)
    INSERT INTO public.expenses(
      branch_id, type, amount, description, date,
      payment_method, reference_number, is_fee, created_by, tenant_id
    ) VALUES (
      v_tx.branch_id, 'إلغاء عمولة تحويل', -v_tx.fee_amount,
      'إلغاء عمولة ' || v_tx.payment_method || ' — دفعة #' || substr(v_tx.id::text, 1, 8),
      CURRENT_DATE, v_tx.payment_method, v_tx.reference_number, true, v_uid, v_tx.tenant_id
    );

    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      payment_method, is_fee, created_by, tenant_id
    ) VALUES (
      v_tx.branch_id, 'income'::treasury_type, 'fee_void', v_tx.fee_amount,
      'إلغاء عمولة ' || v_tx.payment_method, v_tx.payment_method, true, v_uid, v_tx.tenant_id
    ) RETURNING id INTO v_rev_fee_tres;
  END IF;

  -- Insert the reversal payment_transactions row (linked to original)
  INSERT INTO public.payment_transactions(
    payment_plan_id, installment_id, branch_id, tenant_id, contact_id,
    direction, amount, payment_method, fee_amount, fee_type, total_with_fee,
    reference_number, transfer_to_account, transfer_from_account, received_by_name,
    treasury_id, fee_treasury_id, created_by, reverses_tx_id
  ) VALUES (
    v_tx.payment_plan_id, v_tx.installment_id, v_tx.branch_id, v_tx.tenant_id, v_tx.contact_id,
    v_rev_direction, v_tx.amount, v_tx.payment_method,
    COALESCE(v_tx.fee_amount, 0), v_tx.fee_type,
    v_tx.amount + COALESCE(CASE WHEN v_tx.total_with_fee > v_tx.amount THEN v_tx.fee_amount ELSE 0 END, 0),
    v_tx.reference_number, v_tx.transfer_to_account, v_tx.transfer_from_account,
    'إلغاء — ' || COALESCE(v_tx.received_by_name, ''),
    v_rev_treasury, v_rev_fee_tres, v_uid, v_tx.id
  ) RETURNING id INTO v_new_tx_id;

  -- Roll back installment
  IF v_tx.installment_id IS NOT NULL THEN
    UPDATE public.payment_installments
       SET paid_amount = GREATEST(COALESCE(paid_amount, 0) - v_tx.amount, 0),
           paid_at     = NULL,
           status      = 'pending',
           updated_at  = now()
     WHERE id = v_tx.installment_id;
  END IF;

  -- Roll back payment plan
  UPDATE public.payment_plans
     SET paid_amount      = GREATEST(COALESCE(paid_amount, 0) - v_tx.amount, 0),
         remaining_amount = LEAST(total_amount, COALESCE(remaining_amount, 0) + v_tx.amount),
         status           = CASE
                              WHEN status = 'settled'
                                AND (COALESCE(paid_amount, 0) - v_tx.amount) < total_amount
                              THEN 'active'
                              ELSE status
                            END,
         updated_at       = now()
   WHERE id = v_tx.payment_plan_id;

  -- Mark the original as voided
  UPDATE public.payment_transactions
     SET voided_at       = now(),
         voided_by       = v_uid,
         void_reason     = p_reason,
         voided_by_tx_id = v_new_tx_id
   WHERE id = v_tx.id;

  RETURN v_new_tx_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.void_payment_transaction(uuid, text) TO authenticated;
