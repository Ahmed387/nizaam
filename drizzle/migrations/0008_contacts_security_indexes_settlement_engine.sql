-- =====================================================================
-- PHASE 1: security + performance hardening for the contacts balance layer
-- =====================================================================

-- 1) Enforce RLS of the executing user on the canonical balance view
ALTER VIEW public.v_contact_balances SET (security_invoker = true);

-- Balances are never a public surface
REVOKE SELECT ON public.v_contact_balances FROM anon;
GRANT SELECT ON public.v_contact_balances TO authenticated;
GRANT SELECT ON public.v_contact_balances TO service_role;

-- 2) Composite indexes that remove the sequential scans behind v_contact_balances
CREATE INDEX IF NOT EXISTS idx_invoices_contact_tenant_status
  ON public.invoices (contact_id, tenant_id, status)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice_created
  ON public.invoice_payments (invoice_id, created_at);

-- NOTE: receipts and payments live in ONE unified table (public.vouchers),
-- so the receipt/payment voucher indexes are expressed on that table.
CREATE INDEX IF NOT EXISTS idx_vouchers_party_tenant_type
  ON public.vouchers (party_id, tenant_id, type, status)
  WHERE party_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_contact_tenant
  ON public.shipments (contact_id, tenant_id)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_returns_contact_tenant
  ON public.purchase_returns (contact_id, tenant_id, status)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_returns_invoice_status
  ON public.returns (invoice_id, status);

-- 3) Dual-type contacts: supplier credit must accept type = 'both'
CREATE OR REPLACE FUNCTION public.apply_supplier_credit(
  p_contact_id uuid,
  p_payment_plan_id uuid,
  p_branch_id uuid
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_contact_type text;
  v_credit numeric;
  v_remaining numeric;
  v_apply numeric;
  v_plan_total numeric;
  v_plan_paid numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  SELECT tenant_id, type, COALESCE(credit_balance, 0)
    INTO v_tenant, v_contact_type, v_credit
  FROM public.contacts
  WHERE id = p_contact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المورد غير موجود';
  END IF;

  -- الجهات المزدوجة (عميل ومورد) مقبولة صراحةً
  IF v_contact_type NOT IN ('supplier', 'both') THEN
    RAISE EXCEPTION 'جهة الاتصال ليست مورداً';
  END IF;

  PERFORM public.assert_same_tenant(v_tenant);

  IF public.current_tenant_is_suspended() AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'الشركة موقوفة — لا يمكن تنفيذ العملية';
  END IF;

  PERFORM 1 FROM public.branches
  WHERE id = p_branch_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الفرع لا ينتمي لنفس الشركة';
  END IF;

  IF NOT (
    public.is_super_admin(v_uid)
    OR public.is_admin(v_uid)
    OR (
      public.user_in_branch(v_uid, p_branch_id)
      AND public.has_permission(v_uid, 'shipments.create')
    )
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تطبيق رصيد المورد';
  END IF;

  IF v_credit <= 0 THEN
    RETURN 0;
  END IF;

  SELECT total_amount, COALESCE(paid_amount, 0)
    INTO v_plan_total, v_plan_paid
  FROM public.payment_plans
  WHERE id = p_payment_plan_id
    AND tenant_id = v_tenant
    AND entity_type = 'supplier'
    AND entity_id = p_contact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'خطة الدفع غير موجودة أو لا تخص هذا المورد';
  END IF;

  v_remaining := GREATEST(v_plan_total - v_plan_paid, 0);
  IF v_remaining <= 0 THEN
    RETURN 0;
  END IF;

  v_apply := LEAST(v_credit, v_remaining);
  IF v_apply <= 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.payment_transactions(
    tenant_id, branch_id, payment_plan_id, installment_id, direction,
    amount, payment_method, fee_amount, total_with_fee,
    created_by, contact_id
  ) VALUES (
    v_tenant, p_branch_id, p_payment_plan_id, NULL, 'out',
    v_apply, 'settlement', 0, v_apply,
    v_uid, p_contact_id
  );

  UPDATE public.payment_plans SET
    paid_amount = COALESCE(paid_amount, 0) + v_apply,
    remaining_amount = GREATEST(total_amount - (COALESCE(paid_amount, 0) + v_apply), 0),
    status = CASE
      WHEN total_amount - (COALESCE(paid_amount, 0) + v_apply) <= 0 THEN 'settled'
      ELSE status
    END,
    updated_at = now()
  WHERE id = p_payment_plan_id;

  UPDATE public.contacts
  SET credit_balance = COALESCE(credit_balance, 0) - v_apply
  WHERE id = p_contact_id;

  RETURN v_apply;
END;
$fn$;

-- 4) Symmetrical sovereign RPC: apply a customer's prepaid credit to open invoices.
-- SIGN CONVENTION (documented, matches v_contact_balances math):
--   total_balance = ledger_balance + credit_balance
--   credit_balance < 0  => party prepaid / we owe them (surplus parked)
--   credit_balance > 0  => funds parked at the party (they owe us)
-- Applying customer credit inserts invoice_payments with payment_method
-- 'credit_applied' (COUNTED in total_paid) and moves credit_balance toward zero,
-- so the net balance stays invariant and no treasury/cash row is created
-- (the money was already received when the surplus was parked).
CREATE OR REPLACE FUNCTION public.apply_customer_credit(
  p_contact_id uuid,
  p_branch_id uuid,
  p_invoice_id uuid DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_type text;
  v_credit numeric;
  v_avail numeric;
  v_applied numeric := 0;
  v_alloc numeric;
  v_debt numeric;
  v_uname text;
  r record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  SELECT tenant_id, type, COALESCE(credit_balance, 0)
    INTO v_tenant, v_type, v_credit
  FROM public.contacts
  WHERE id = p_contact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الجهة غير موجودة';
  END IF;

  IF v_type NOT IN ('customer', 'both') THEN
    RAISE EXCEPTION 'جهة الاتصال ليست عميلاً';
  END IF;

  PERFORM public.assert_same_tenant(v_tenant);

  IF public.current_tenant_is_suspended() AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'الشركة موقوفة — لا يمكن تنفيذ العملية';
  END IF;

  PERFORM 1 FROM public.branches WHERE id = p_branch_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الفرع لا ينتمي لنفس الشركة';
  END IF;

  IF NOT (
    public.is_super_admin(v_uid)
    OR public.is_admin(v_uid)
    OR (
      public.user_in_branch(v_uid, p_branch_id)
      AND (
        public.has_role(v_uid, 'cashier'::app_role)
        OR public.has_role(v_uid, 'branch_manager'::app_role)
        OR public.has_role(v_uid, 'accountant'::app_role)
        OR public.has_permission(v_uid, 'invoices.update')
      )
    )
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تطبيق رصيد العميل';
  END IF;

  v_avail := GREATEST(-v_credit, 0);
  IF v_avail <= 0 THEN
    RETURN 0;
  END IF;

  SELECT name INTO v_uname FROM public.profiles WHERE id = v_uid;

  FOR r IN
    SELECT i.id, i.branch_id, i.tenant_id
    FROM public.invoices i
    WHERE i.contact_id = p_contact_id
      AND i.tenant_id = v_tenant
      AND i.status = 'active'
      AND (p_invoice_id IS NULL OR i.id = p_invoice_id)
    ORDER BY i.invoice_date ASC, i.created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_avail <= 0;
    v_debt := public.invoice_outstanding_debt(r.id, NULL);
    IF v_debt <= 0 THEN CONTINUE; END IF;
    v_alloc := LEAST(v_avail, v_debt);

    INSERT INTO public.invoice_payments(
      invoice_id, tenant_id, branch_id, payment_method, amount,
      received_by_name, fee_amount, fee_on_customer
    ) VALUES (
      r.id, r.tenant_id, r.branch_id, 'credit_applied', v_alloc,
      COALESCE(v_uname, 'رصيد دائن'), 0, false
    );

    v_avail := v_avail - v_alloc;
    v_applied := v_applied + v_alloc;
  END LOOP;

  IF v_applied > 0 THEN
    UPDATE public.contacts
    SET credit_balance = COALESCE(credit_balance, 0) + v_applied
    WHERE id = p_contact_id;
  END IF;

  RETURN v_applied;
END;
$fn$;

-- =====================================================================
-- PHASE 2: sovereign cross-branch invoice settlement engine
-- Payment status stays DERIVED from invoice_payments (no stored columns).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.settle_contact_invoices_sovereign(
  p_contact_id uuid,
  p_payment_amount numeric,
  p_payment_method text,
  p_receiving_branch_id uuid,
  p_selected_invoices jsonb DEFAULT NULL,
  p_settlement_type text DEFAULT 'fifo'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_type text;
  v_uname text;
  v_left numeric;
  v_alloc numeric;
  v_debt numeric;
  v_total_alloc numeric := 0;
  v_count int := 0;
  v_surplus numeric := 0;
  v_ids uuid[] := '{}';
  r record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF p_payment_amount IS NULL OR p_payment_amount <= 0 THEN
    RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر';
  END IF;
  IF COALESCE(NULLIF(p_payment_method, ''), '') = '' THEN
    RAISE EXCEPTION 'طريقة الدفع مطلوبة';
  END IF;

  SELECT tenant_id, type INTO v_tenant, v_type
  FROM public.contacts WHERE id = p_contact_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الجهة غير موجودة';
  END IF;
  IF v_type NOT IN ('customer', 'both') THEN
    RAISE EXCEPTION 'السداد على الفواتير متاح للعملاء والجهات المزدوجة فقط';
  END IF;

  PERFORM public.assert_same_tenant(v_tenant);

  IF public.current_tenant_is_suspended() AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'الشركة موقوفة — لا يمكن تنفيذ العملية';
  END IF;

  PERFORM 1 FROM public.branches
  WHERE id = p_receiving_branch_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الفرع المستلم لا ينتمي لنفس الشركة';
  END IF;

  IF NOT (
    public.is_super_admin(v_uid)
    OR public.is_admin(v_uid)
    OR (
      public.user_in_branch(v_uid, p_receiving_branch_id)
      AND (
        public.has_role(v_uid, 'cashier'::app_role)
        OR public.has_role(v_uid, 'branch_manager'::app_role)
        OR public.has_role(v_uid, 'accountant'::app_role)
        OR public.has_permission(v_uid, 'invoices.update')
      )
    )
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية سداد وإقفال فواتير هذه الجهة';
  END IF;

  SELECT name INTO v_uname FROM public.profiles WHERE id = v_uid;
  v_left := p_payment_amount;

  IF p_selected_invoices IS NOT NULL
     AND jsonb_typeof(p_selected_invoices) = 'array'
     AND jsonb_array_length(p_selected_invoices) > 0 THEN
    SELECT array_agg((e ->> 'invoice_id')::uuid ORDER BY ord)
      INTO v_ids
    FROM jsonb_array_elements(p_selected_invoices) WITH ORDINALITY AS t(e, ord)
    WHERE (e ->> 'invoice_id') IS NOT NULL;
  END IF;

  FOR r IN
    SELECT i.id, i.branch_id, i.tenant_id, i.invoice_number
    FROM public.invoices i
    WHERE i.contact_id = p_contact_id
      AND i.tenant_id = v_tenant
      AND i.status = 'active'
      AND (COALESCE(array_length(v_ids, 1), 0) = 0 OR i.id = ANY(v_ids))
    ORDER BY
      CASE WHEN COALESCE(array_length(v_ids, 1), 0) = 0 THEN 0
           ELSE array_position(v_ids, i.id) END,
      i.invoice_date ASC, i.created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_debt := public.invoice_outstanding_debt(r.id, NULL);
    IF v_debt <= 0 THEN CONTINUE; END IF;
    v_alloc := LEAST(v_left, v_debt);

    -- سجل دفعة مرتبط بالفرع المستلم (قد يختلف عن فرع الفاتورة)
    INSERT INTO public.invoice_payments(
      invoice_id, tenant_id, branch_id, payment_method, amount,
      reference_number, received_by_name, fee_amount, fee_on_customer
    ) VALUES (
      r.id, r.tenant_id, p_receiving_branch_id, p_payment_method, v_alloc,
      'SETTLE-' || to_char(now(), 'YYYYMMDDHH24MISS'),
      COALESCE(v_uname, 'سداد'), 0, false
    );

    -- أثر الخزينة في الفرع المستلم للنقدية
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      payment_method, reference_id, created_by, tenant_id
    ) VALUES (
      p_receiving_branch_id, 'income', 'contact_settlement', v_alloc,
      'سداد فاتورة ' || COALESCE(r.invoice_number, ''),
      p_payment_method, r.id, v_uid, r.tenant_id
    );

    v_left := v_left - v_alloc;
    v_total_alloc := v_total_alloc + v_alloc;
    v_count := v_count + 1;
  END LOOP;

  IF v_left > 0 THEN
    v_surplus := v_left;
    -- الفائض يُحفظ كرصيد دائن للجهة (سالب = علينا لها) ويدخل الخزينة كنقدية فعلية
    UPDATE public.contacts
    SET credit_balance = COALESCE(credit_balance, 0) - v_surplus
    WHERE id = p_contact_id;

    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      payment_method, reference_id, created_by, tenant_id
    ) VALUES (
      p_receiving_branch_id, 'income', 'contact_settlement_surplus', v_surplus,
      'فائض سداد — رصيد دائن للجهة',
      p_payment_method, p_contact_id, v_uid, v_tenant
    );
  END IF;

  RETURN jsonb_build_object(
    'allocated_count', v_count,
    'allocated_total', v_total_alloc,
    'surplus', v_surplus,
    'receiving_branch_id', p_receiving_branch_id,
    'settlement_type', CASE WHEN COALESCE(array_length(v_ids, 1), 0) = 0 THEN 'fifo' ELSE COALESCE(p_settlement_type, 'selected') END
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.apply_customer_credit(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_contact_invoices_sovereign(uuid, numeric, text, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_customer_credit(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_contact_invoices_sovereign(uuid, numeric, text, uuid, jsonb, text) TO authenticated, service_role;