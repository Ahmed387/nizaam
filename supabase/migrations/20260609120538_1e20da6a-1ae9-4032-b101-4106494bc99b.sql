
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS total_paid_before_cancel numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_method text,
  ADD COLUMN IF NOT EXISTS refund_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_processed_by uuid,
  ADD COLUMN IF NOT EXISTS refund_processed_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.invoices ADD CONSTRAINT invoices_refund_method_chk
    CHECK (refund_method IS NULL OR refund_method IN ('cash','credit','none'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.payment_installments DROP CONSTRAINT IF EXISTS payment_installments_status_check;
ALTER TABLE public.payment_installments
  ADD CONSTRAINT payment_installments_status_check
  CHECK (status = ANY (ARRAY['pending','paid','overdue','partial','cancelled']));

ALTER TABLE public.payment_installments
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS adjustment_reason text,
  ADD COLUMN IF NOT EXISTS adjusted_at timestamptz;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS credit_balance numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_status text NOT NULL DEFAULT 'none';

DO $$ BEGIN
  ALTER TABLE public.contacts ADD CONSTRAINT contacts_refund_status_chk
    CHECK (refund_status IN ('none','refunded_cash','credit_added','credit_used'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.customer_credit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL,
  type text NOT NULL CHECK (type IN ('credit_added','credit_used')),
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_credit_log TO authenticated;
GRANT ALL ON public.customer_credit_log TO service_role;
ALTER TABLE public.customer_credit_log ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.customer_credit_log;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.customer_credit_log
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_user();

DROP POLICY IF EXISTS ccl_read ON public.customer_credit_log;
DROP POLICY IF EXISTS ccl_write ON public.customer_credit_log;
CREATE POLICY ccl_read ON public.customer_credit_log FOR SELECT
  USING (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id()));
CREATE POLICY ccl_write ON public.customer_credit_log FOR INSERT
  WITH CHECK (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id()));

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_credit_log;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.cancel_invoice_with_refund(
  _invoice_id uuid,
  _reason text,
  _refund_method text DEFAULT 'none'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv invoices%ROWTYPE;
  v_paid numeric := 0;
  v_uid uuid := auth.uid();
  v_plan_id uuid;
  v_cancelled_count int := 0;
BEGIN
  SELECT * INTO v_inv FROM invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  IF v_inv.status = 'cancelled' THEN RAISE EXCEPTION 'invoice already cancelled'; END IF;
  IF COALESCE(_reason,'') = '' THEN RAISE EXCEPTION 'reason required'; END IF;

  SELECT id INTO v_plan_id FROM payment_plans
    WHERE reference_type='invoice' AND reference_id=_invoice_id LIMIT 1;

  IF v_plan_id IS NOT NULL THEN
    SELECT COALESCE(SUM(paid_amount),0) INTO v_paid
      FROM payment_installments WHERE payment_plan_id = v_plan_id;
  END IF;

  v_paid := v_paid + COALESCE((
    SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = _invoice_id
  ), 0);

  IF v_plan_id IS NOT NULL THEN
    UPDATE payment_installments
      SET status='cancelled', cancelled_at=now(), cancelled_by=v_uid,
          adjustment_reason='تم إلغاء الفاتورة'
      WHERE payment_plan_id = v_plan_id
        AND status IN ('pending','overdue','partial');
    GET DIAGNOSTICS v_cancelled_count = ROW_COUNT;
    UPDATE payment_plans SET status='cancelled', remaining_amount=0
      WHERE id=v_plan_id;
  END IF;

  UPDATE invoices SET
    status='cancelled',
    cancel_reason=_reason,
    cancelled_by=v_uid,
    cancelled_at=now(),
    total_paid_before_cancel=v_paid,
    refund_method = CASE WHEN v_paid > 0 THEN _refund_method ELSE 'none' END,
    refund_amount = CASE WHEN v_paid > 0 AND _refund_method IN ('cash','credit') THEN v_paid ELSE 0 END,
    refund_processed_by = CASE WHEN v_paid > 0 AND _refund_method IN ('cash','credit') THEN v_uid END,
    refund_processed_at = CASE WHEN v_paid > 0 AND _refund_method IN ('cash','credit') THEN now() END
  WHERE id=_invoice_id;

  IF v_paid > 0 AND _refund_method = 'credit' AND v_inv.contact_id IS NOT NULL THEN
    UPDATE contacts SET credit_balance = COALESCE(credit_balance,0) + v_paid,
                        refund_status = 'credit_added'
      WHERE id = v_inv.contact_id;
    INSERT INTO customer_credit_log(contact_id, invoice_id, amount, type, notes, created_by)
      VALUES (v_inv.contact_id, _invoice_id, v_paid, 'credit_added',
              'إلغاء فاتورة ' || v_inv.invoice_number, v_uid);
  ELSIF v_paid > 0 AND _refund_method = 'cash' THEN
    INSERT INTO treasury(branch_id, type, category, amount, description, reference_id, created_by)
      VALUES (v_inv.branch_id, 'expense', 'sales_refund', v_paid,
              'رد مبلغ فاتورة ملغاة ' || v_inv.invoice_number, _invoice_id, v_uid);
    IF v_inv.contact_id IS NOT NULL THEN
      UPDATE contacts SET refund_status = 'refunded_cash' WHERE id = v_inv.contact_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'total_paid', v_paid,
    'cancelled_installments', v_cancelled_count,
    'refund_method', CASE WHEN v_paid > 0 THEN _refund_method ELSE 'none' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.redistribute_installments_after_return(
  _invoice_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv invoices%ROWTYPE;
  v_plan payment_plans%ROWTYPE;
  v_returned numeric := 0;
  v_new_balance numeric;
  v_paid numeric := 0;
  v_remaining_due numeric;
  v_future_count int;
  v_per numeric;
BEGIN
  SELECT * INTO v_inv FROM invoices WHERE id=_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;

  SELECT * INTO v_plan FROM payment_plans
    WHERE reference_type='invoice' AND reference_id=_invoice_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('skipped','no_plan'); END IF;

  SELECT COALESCE(SUM(total_refund),0) INTO v_returned
    FROM returns WHERE invoice_id=_invoice_id AND status='active';

  v_new_balance := GREATEST(v_inv.total - v_returned, 0);

  SELECT COALESCE(SUM(paid_amount),0) INTO v_paid
    FROM payment_installments WHERE payment_plan_id=v_plan.id;

  v_remaining_due := v_new_balance - v_paid;

  SELECT COUNT(*) INTO v_future_count FROM payment_installments
    WHERE payment_plan_id=v_plan.id AND status IN ('pending','overdue','partial');

  IF v_remaining_due <= 0 THEN
    UPDATE payment_installments
      SET status='cancelled', cancelled_at=now(),
          adjustment_reason='تم الإلغاء بسبب مرتجع تجاوز قيمة المتبقي'
      WHERE payment_plan_id=v_plan.id
        AND status IN ('pending','overdue','partial');
    UPDATE payment_plans SET total_amount=v_new_balance, remaining_amount=0
      WHERE id=v_plan.id;
    RETURN jsonb_build_object('overpayment', ABS(v_remaining_due), 'cancelled_all', true);
  END IF;

  IF v_future_count > 0 THEN
    v_per := ROUND(v_remaining_due / v_future_count, 2);
    UPDATE payment_installments
      SET amount = v_per,
          adjustment_reason = 'تم التعديل بسبب مرتجع جزئي — ' || to_char(now(),'YYYY-MM-DD'),
          adjusted_at = now()
      WHERE payment_plan_id=v_plan.id
        AND status IN ('pending','overdue','partial');
  END IF;

  UPDATE payment_plans SET total_amount=v_new_balance,
                           remaining_amount=v_remaining_due
    WHERE id=v_plan.id;

  RETURN jsonb_build_object('new_balance', v_new_balance,
                            'remaining', v_remaining_due,
                            'updated_installments', v_future_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_invoice_with_refund(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redistribute_installments_after_return(uuid) TO authenticated;
