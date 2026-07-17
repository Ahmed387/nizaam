
-- 1) Audit columns on invoice_payments
ALTER TABLE public.invoice_payments
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_by_payment_id uuid REFERENCES public.invoice_payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reverses_payment_id uuid REFERENCES public.invoice_payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ip_voided_at ON public.invoice_payments(voided_at);
CREATE INDEX IF NOT EXISTS idx_ip_reverses_payment_id ON public.invoice_payments(reverses_payment_id);

-- 2) RPC: void_invoice_payment
CREATE OR REPLACE FUNCTION public.void_invoice_payment(
  p_payment_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pay       record;
  v_inv       record;
  v_new_id    uuid;
  v_uid       uuid := auth.uid();
BEGIN
  IF p_payment_id IS NULL THEN RAISE EXCEPTION 'payment id required'; END IF;

  SELECT * INTO v_pay FROM public.invoice_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment not found'; END IF;
  IF v_pay.voided_at IS NOT NULL THEN RAISE EXCEPTION 'payment already voided'; END IF;
  IF v_pay.reverses_payment_id IS NOT NULL THEN RAISE EXCEPTION 'cannot void a reversal entry'; END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = v_pay.invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;

  -- Reverse the treasury income (record an expense of same amount)
  INSERT INTO public.treasury(
    branch_id, type, category, amount, description,
    payment_method, reference_number, transfer_to_account, transfer_from_account,
    reference_id, created_by, tenant_id
  ) VALUES (
    v_pay.branch_id, 'expense', 'payment_in_void', v_pay.amount,
    'إلغاء دفعة أولية على فاتورة ' || COALESCE(v_inv.invoice_number, '')
      || COALESCE(' — ' || p_reason, ''),
    v_pay.payment_method, v_pay.reference_number,
    v_pay.transfer_to_account, v_pay.transfer_from_account,
    v_pay.invoice_id, v_uid, v_pay.tenant_id
  );

  -- Reverse fee if any (fee borne by company)
  IF COALESCE(v_pay.fee_amount, 0) > 0 AND NOT COALESCE(v_pay.fee_on_customer, false) THEN
    INSERT INTO public.expenses(
      branch_id, type, amount, description, date,
      payment_method, reference_number, is_fee, created_by, tenant_id
    ) VALUES (
      v_pay.branch_id, 'إلغاء عمولة تحويل', -v_pay.fee_amount,
      'إلغاء عمولة ' || v_pay.payment_method || ' — فاتورة ' || COALESCE(v_inv.invoice_number, ''),
      CURRENT_DATE, v_pay.payment_method, v_pay.reference_number, true, v_uid, v_pay.tenant_id
    );
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      payment_method, created_by, tenant_id
    ) VALUES (
      v_pay.branch_id, 'income', 'fee_void', v_pay.fee_amount,
      'إلغاء عمولة ' || v_pay.payment_method, v_pay.payment_method, v_uid, v_pay.tenant_id
    );
  END IF;

  -- Insert the reversal row (negative-like marker in invoice_payments)
  INSERT INTO public.invoice_payments(
    invoice_id, tenant_id, branch_id, payment_method, amount, reference_number,
    received_by_name, transfer_to_account, transfer_from_account,
    fee_amount, fee_on_customer, reverses_payment_id
  ) VALUES (
    v_pay.invoice_id, v_pay.tenant_id, v_pay.branch_id, v_pay.payment_method,
    v_pay.amount, v_pay.reference_number,
    'إلغاء — ' || COALESCE(v_pay.received_by_name, ''),
    v_pay.transfer_to_account, v_pay.transfer_from_account,
    COALESCE(v_pay.fee_amount, 0), COALESCE(v_pay.fee_on_customer, false),
    v_pay.id
  ) RETURNING id INTO v_new_id;

  -- Mark original as voided
  UPDATE public.invoice_payments
     SET voided_at = now(),
         voided_by = v_uid,
         void_reason = p_reason,
         voided_by_payment_id = v_new_id
   WHERE id = v_pay.id;

  RETURN v_new_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.void_invoice_payment(uuid, text) TO authenticated;

-- 3) RPC: add_invoice_payment (adds a new payment on any invoice, even cash-only)
CREATE OR REPLACE FUNCTION public.add_invoice_payment(
  p_invoice_id uuid,
  p_payment_method text,
  p_amount numeric,
  p_reference_number text DEFAULT NULL,
  p_transfer_to_account text DEFAULT NULL,
  p_transfer_from_account text DEFAULT NULL,
  p_fee_amount numeric DEFAULT 0,
  p_fee_on_customer boolean DEFAULT false,
  p_received_by_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inv record;
  v_uid uuid := auth.uid();
  v_uname text;
  v_new_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;

  SELECT name INTO v_uname FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.invoice_payments(
    invoice_id, tenant_id, branch_id, payment_method, amount,
    reference_number, received_by_name, transfer_to_account, transfer_from_account,
    fee_amount, fee_on_customer
  ) VALUES (
    p_invoice_id, v_inv.tenant_id, v_inv.branch_id, p_payment_method, p_amount,
    NULLIF(p_reference_number,''), COALESCE(NULLIF(p_received_by_name,''), v_uname),
    NULLIF(p_transfer_to_account,''), NULLIF(p_transfer_from_account,''),
    COALESCE(p_fee_amount, 0), COALESCE(p_fee_on_customer, false)
  ) RETURNING id INTO v_new_id;

  -- Treasury income
  INSERT INTO public.treasury(
    branch_id, type, category, amount, description,
    payment_method, reference_number, transfer_to_account,
    reference_id, created_by, tenant_id
  ) VALUES (
    v_inv.branch_id, 'income', 'sales_extra_payment', p_amount,
    'دفعة إضافية على فاتورة ' || COALESCE(v_inv.invoice_number, ''),
    p_payment_method, NULLIF(p_reference_number,''),
    NULLIF(p_transfer_to_account,''),
    p_invoice_id, v_uid, v_inv.tenant_id
  );

  -- Fee expense if borne by company
  IF COALESCE(p_fee_amount, 0) > 0 AND NOT COALESCE(p_fee_on_customer, false) THEN
    INSERT INTO public.expenses(
      branch_id, type, amount, description, date,
      payment_method, reference_number, is_fee, created_by, tenant_id
    ) VALUES (
      v_inv.branch_id, 'عمولة تحويل', p_fee_amount,
      'عمولة ' || p_payment_method || ' — فاتورة ' || COALESCE(v_inv.invoice_number, ''),
      CURRENT_DATE, p_payment_method, NULLIF(p_reference_number,''), true, v_uid, v_inv.tenant_id
    );
  END IF;

  RETURN v_new_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.add_invoice_payment(uuid, text, numeric, text, text, text, numeric, boolean, text) TO authenticated;
