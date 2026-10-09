-- Step 6D (migration 0057) part 1 — write paths read the unified ledger.
CREATE OR REPLACE FUNCTION public.ledger_refresh_contact(p_contact uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF p_contact IS NULL THEN RETURN; END IF;
  BEGIN
    PERFORM public.ledger_sync_contact(p_contact);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO ledger_sync_errors (tenant_id, contact_id, context, error)
    VALUES ((SELECT tenant_id FROM contacts WHERE id = p_contact), p_contact, 'refresh_before_write', SQLERRM);
  END;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_doc_open(p_doc_type text, p_doc_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN d.ok THEN round(d.amt - COALESCE((
            SELECT sum(pa.amount) FROM payment_allocations pa
             WHERE pa.status = 'active' AND pa.debt_type = p_doc_type AND pa.debt_id = p_doc_id), 0), 2) END
    FROM (SELECT i.total AS amt,
                 (i.status = 'active' AND i.total > 0 AND public.ledger_day(i.invoice_date) >= public.ledger_cutoff()) AS ok
            FROM invoices i WHERE p_doc_type = 'invoice' AND i.id = p_doc_id
          UNION ALL
          SELECT s.total_cost,
                 (s.status = 'active' AND s.total_cost > 0
                  AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) >= public.ledger_cutoff())
            FROM shipments s WHERE p_doc_type = 'shipment' AND s.id = p_doc_id) d
$$;

CREATE OR REPLACE FUNCTION public.ledger_doc_paid(p_doc_type text, p_doc_id uuid, OUT money numeric, OUT by_returns numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT round(COALESCE(sum(pa.amount) FILTER (WHERE mv.kind <> 'return_credit'), 0), 2),
         round(COALESCE(sum(pa.amount) FILTER (WHERE mv.kind = 'return_credit'), 0), 2)
    FROM payment_allocations pa JOIN money_movements mv ON mv.id = pa.movement_id
   WHERE pa.status = 'active' AND pa.debt_type = p_doc_type AND pa.debt_id = p_doc_id
$$;

CREATE OR REPLACE FUNCTION public.ledger_side_advance(p_contact uuid, p_side text)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT round(COALESCE(sum(m.amount - COALESCE(a.s, 0)), 0), 2)
    FROM money_movements m
    LEFT JOIN (SELECT pa.movement_id, sum(pa.amount) AS s FROM payment_allocations pa
                WHERE pa.status = 'active' AND pa.contact_id = p_contact GROUP BY 1) a ON a.movement_id = m.id
   WHERE m.contact_id = p_contact AND m.side = p_side AND m.status = 'active' AND m.effect = 'settle'
$$;

CREATE OR REPLACE FUNCTION public.ledger_mirror_credit_balance(p_contact uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_type text; v numeric;
BEGIN
  SELECT type INTO v_type FROM contacts WHERE id = p_contact;
  IF v_type IS NULL THEN RETURN NULL; END IF;
  v := CASE WHEN v_type = 'supplier' THEN public.ledger_side_advance(p_contact, 'supplier')
            ELSE -public.ledger_side_advance(p_contact, 'customer') END;
  PERFORM set_config('app.credit_sync', '1', true);
  UPDATE contacts SET credit_balance = v WHERE id = p_contact AND credit_balance IS DISTINCT FROM v;
  PERFORM set_config('app.credit_sync', '0', true);
  RETURN v;
END
$fn$;

CREATE OR REPLACE FUNCTION public.recompute_contact_credit(p_contact_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN public.ledger_mirror_credit_balance(p_contact_id);
END
$fn$;

CREATE OR REPLACE FUNCTION public.apply_customer_credit(p_contact_id uuid, p_branch_id uuid, p_invoice_id uuid DEFAULT NULL::uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_tenant uuid; v_type text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT tenant_id, type INTO v_tenant, v_type FROM public.contacts WHERE id = p_contact_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الجهة غير موجودة'; END IF;
  IF v_type NOT IN ('customer', 'both') THEN RAISE EXCEPTION 'جهة الاتصال ليست عميلاً'; END IF;
  PERFORM public.assert_same_tenant(v_tenant);
  IF public.current_tenant_is_suspended() AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'الشركة موقوفة — لا يمكن تنفيذ العملية';
  END IF;
  PERFORM 1 FROM public.branches WHERE id = p_branch_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفرع لا ينتمي لنفس الشركة'; END IF;
  IF NOT (public.is_super_admin(v_uid) OR public.is_admin(v_uid)
          OR (public.user_in_branch(v_uid, p_branch_id)
              AND (public.has_role(v_uid, 'cashier'::app_role) OR public.has_role(v_uid, 'branch_manager'::app_role)
                   OR public.has_role(v_uid, 'accountant'::app_role) OR public.has_permission(v_uid, 'invoices.update')))) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تطبيق رصيد العميل';
  END IF;

  PERFORM public.ledger_refresh_contact(p_contact_id);
  RETURN COALESCE((
    SELECT round(sum(pa.amount), 2)
      FROM payment_allocations pa JOIN money_movements mv ON mv.id = pa.movement_id
     WHERE pa.status = 'active' AND pa.contact_id = p_contact_id AND pa.side = 'customer' AND pa.debt_type = 'invoice'
       AND (p_invoice_id IS NULL OR pa.debt_id = p_invoice_id)
       AND mv.kind IN ('deposit', 'opening', 'payment', 'return_credit')
       AND mv.target_doc_id IS DISTINCT FROM pa.debt_id), 0);
END
$fn$;

CREATE OR REPLACE FUNCTION public.apply_supplier_credit(p_contact_id uuid, p_payment_plan_id uuid, p_branch_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_tenant uuid; v_type text; v_credit numeric;
  v_total numeric; v_paid numeric; v_remaining numeric; v_apply numeric; v_ref uuid; v_used numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT tenant_id, type INTO v_tenant, v_type FROM public.contacts WHERE id = p_contact_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المورد غير موجود'; END IF;
  IF v_type NOT IN ('supplier', 'both') THEN RAISE EXCEPTION 'جهة الاتصال ليست مورداً'; END IF;
  PERFORM public.assert_same_tenant(v_tenant);
  IF public.current_tenant_is_suspended() AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'الشركة موقوفة — لا يمكن تنفيذ العملية';
  END IF;
  PERFORM 1 FROM public.branches WHERE id = p_branch_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفرع لا ينتمي لنفس الشركة'; END IF;
  IF NOT (public.is_super_admin(v_uid) OR public.is_admin(v_uid)
          OR (public.user_in_branch(v_uid, p_branch_id) AND public.has_permission(v_uid, 'shipments.create'))) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تطبيق رصيد المورد';
  END IF;

  SELECT total_amount, COALESCE(paid_amount, 0), reference_id INTO v_total, v_paid, v_ref
    FROM public.payment_plans
   WHERE id = p_payment_plan_id AND tenant_id = v_tenant AND entity_type = 'supplier' AND entity_id = p_contact_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'خطة الدفع غير موجودة أو لا تخص هذا المورد'; END IF;

  PERFORM public.ledger_refresh_contact(p_contact_id);
  v_credit := public.ledger_side_advance(p_contact_id, 'supplier')
            + COALESCE((SELECT sum(pa.amount) FROM payment_allocations pa JOIN money_movements mv ON mv.id = pa.movement_id
                         WHERE pa.status = 'active' AND pa.debt_type = 'shipment' AND pa.debt_id = v_ref AND pa.mode = 'fifo'
                           AND mv.target_doc_id IS DISTINCT FROM v_ref), 0);
  IF v_credit <= 0 THEN RETURN 0; END IF;
  v_remaining := GREATEST(v_total - v_paid, 0);
  v_apply := round(LEAST(v_credit, v_remaining), 2);
  IF v_apply <= 0 THEN RETURN 0; END IF;

  INSERT INTO public.payment_transactions(tenant_id, branch_id, payment_plan_id, installment_id, direction,
    amount, payment_method, fee_amount, total_with_fee, created_by, contact_id)
  VALUES (v_tenant, p_branch_id, p_payment_plan_id, NULL, 'out', v_apply, 'credit_balance', 0, v_apply, v_uid, p_contact_id);

  UPDATE public.payment_plans SET
    paid_amount = COALESCE(paid_amount, 0) + v_apply,
    remaining_amount = GREATEST(total_amount - (COALESCE(paid_amount, 0) + v_apply), 0),
    status = CASE WHEN total_amount - (COALESCE(paid_amount, 0) + v_apply) <= 0 THEN 'settled' ELSE status END,
    updated_at = now()
  WHERE id = p_payment_plan_id;

  PERFORM set_config('app.skip_journal', '1', true);
  INSERT INTO public.supplier_payments(tenant_id, contact_id, branch_id, amount, notes, paid_by)
  VALUES (v_tenant, p_contact_id, p_branch_id, v_apply, 'خصم من الرصيد المسبق لدى المورد (بدون حركة خزينة)', v_uid);
  PERFORM set_config('app.skip_journal', '0', true);

  INSERT INTO public.customer_credit_log(tenant_id, contact_id, amount, type, balance_delta, notes, created_by)
  VALUES (v_tenant, p_contact_id, v_apply, 'credit_used', -v_apply, 'خصم رصيد مسبق على فاتورة شراء', v_uid);
  RETURN v_apply;
END
$fn$;

CREATE OR REPLACE FUNCTION public.settle_contact_invoices_sovereign(p_contact_id uuid, p_payment_amount numeric, p_payment_method text,
  p_receiving_branch_id uuid, p_selected_invoices jsonb DEFAULT NULL::jsonb, p_settlement_type text DEFAULT 'fifo'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_tenant uuid; v_type text; v_uname text;
  v_left numeric; v_alloc numeric; v_debt numeric; v_total_alloc numeric := 0; v_count int := 0; v_surplus numeric := 0;
  v_ids uuid[] := '{}'; r record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_payment_amount IS NULL OR p_payment_amount <= 0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;
  IF COALESCE(NULLIF(p_payment_method, ''), '') = '' THEN RAISE EXCEPTION 'طريقة الدفع مطلوبة'; END IF;
  IF p_payment_method IN ('settlement', 'credit_balance', 'credit_applied') THEN
    RAISE EXCEPTION 'المقاصة ممنوعة — السداد لازم يكون فلوس فعلية';
  END IF;

  SELECT tenant_id, type INTO v_tenant, v_type FROM public.contacts WHERE id = p_contact_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الجهة غير موجودة'; END IF;
  IF v_type NOT IN ('customer', 'both') THEN RAISE EXCEPTION 'السداد على الفواتير متاح للعملاء والجهات المزدوجة فقط'; END IF;
  PERFORM public.assert_same_tenant(v_tenant);
  IF public.current_tenant_is_suspended() AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'الشركة موقوفة — لا يمكن تنفيذ العملية';
  END IF;
  PERFORM 1 FROM public.branches WHERE id = p_receiving_branch_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفرع المستلم لا ينتمي لنفس الشركة'; END IF;
  IF NOT (public.is_super_admin(v_uid) OR public.is_admin(v_uid)
          OR (public.user_in_branch(v_uid, p_receiving_branch_id)
              AND (public.has_role(v_uid, 'cashier'::app_role) OR public.has_role(v_uid, 'branch_manager'::app_role)
                   OR public.has_role(v_uid, 'accountant'::app_role) OR public.has_permission(v_uid, 'invoices.update')))) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية سداد وإقفال فواتير هذه الجهة';
  END IF;

  PERFORM public.ledger_refresh_contact(p_contact_id);
  SELECT name INTO v_uname FROM public.profiles WHERE id = v_uid;
  v_left := round(p_payment_amount, 2);

  IF p_selected_invoices IS NOT NULL AND jsonb_typeof(p_selected_invoices) = 'array' AND jsonb_array_length(p_selected_invoices) > 0 THEN
    SELECT array_agg((e ->> 'invoice_id')::uuid ORDER BY ord) INTO v_ids
      FROM jsonb_array_elements(p_selected_invoices) WITH ORDINALITY AS t(e, ord)
     WHERE (e ->> 'invoice_id') IS NOT NULL;
  END IF;

  FOR r IN
    SELECT i.id, i.branch_id, i.tenant_id, i.invoice_number
      FROM public.invoices i
     WHERE i.contact_id = p_contact_id AND i.tenant_id = v_tenant AND i.status = 'active'
       AND public.ledger_day(i.invoice_date) >= public.ledger_cutoff()
       AND (COALESCE(array_length(v_ids, 1), 0) = 0 OR i.id = ANY (v_ids))
     ORDER BY CASE WHEN COALESCE(array_length(v_ids, 1), 0) = 0 THEN 0 ELSE array_position(v_ids, i.id) END,
              public.ledger_day(i.invoice_date), i.created_at, i.id
     FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_debt := COALESCE(public.ledger_doc_open('invoice', r.id), 0);
    IF v_debt <= 0.005 THEN CONTINUE; END IF;
    v_alloc := LEAST(v_left, v_debt);

    INSERT INTO public.invoice_payments(invoice_id, tenant_id, branch_id, payment_method, amount,
      reference_number, received_by_name, fee_amount, fee_on_customer)
    VALUES (r.id, r.tenant_id, p_receiving_branch_id, p_payment_method, v_alloc,
      'SETTLE-' || to_char(now(), 'YYYYMMDDHH24MISS'), COALESCE(v_uname, 'سداد'), 0, false);

    INSERT INTO public.treasury(branch_id, type, category, amount, description, payment_method, reference_id, created_by, tenant_id)
    VALUES (p_receiving_branch_id, 'income', 'contact_settlement', v_alloc,
      'سداد فاتورة ' || COALESCE(r.invoice_number, ''), p_payment_method, r.id, v_uid, r.tenant_id);

    v_left := v_left - v_alloc;
    v_total_alloc := v_total_alloc + v_alloc;
    v_count := v_count + 1;
  END LOOP;

  IF v_left > 0 THEN
    v_surplus := v_left;
    INSERT INTO public.customer_credit_log (tenant_id, contact_id, amount, type, notes, created_by)
    VALUES (v_tenant, p_contact_id, v_surplus, 'credit_added', 'فائض سداد — رصيد مسبق للجهة', v_uid);
    INSERT INTO public.treasury(branch_id, type, category, amount, description, payment_method, reference_id, created_by, tenant_id)
    VALUES (p_receiving_branch_id, 'income', 'contact_settlement_surplus', v_surplus,
      'فائض سداد — رصيد دائن للجهة', p_payment_method, p_contact_id, v_uid, v_tenant);
  END IF;

  RETURN jsonb_build_object('allocated_count', v_count, 'allocated_total', v_total_alloc, 'surplus', v_surplus,
    'receiving_branch_id', p_receiving_branch_id,
    'settlement_type', CASE WHEN COALESCE(array_length(v_ids, 1), 0) = 0 THEN 'fifo' ELSE COALESCE(p_settlement_type, 'selected') END);
END
$fn$;

CREATE OR REPLACE FUNCTION public.process_sale_full(p_branch_id uuid, p_customer_id uuid, p_subtotal numeric, p_discount_amount numeric,
  p_discount_percent numeric, p_discount_reason text, p_total numeric, p_payment_method text, p_items jsonb, p_payments jsonb,
  p_vat_rate numeric, p_vat_amount numeric, p_invoice_date date, p_recipient text DEFAULT NULL::text, p_notes text DEFAULT NULL::text,
  p_credit_to_apply numeric DEFAULT 0, p_received_by_name text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_inv uuid; v_uid uuid := auth.uid(); v_gate record; v_adv numeric; v_open numeric; v_tenant uuid; v_type text;
  v_admin boolean := is_admin(auth.uid()) OR is_super_admin(auth.uid());
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_payments IS NULL THEN RAISE EXCEPTION 'قائمة الدفعات مطلوبة (أرسل [] للآجل)'; END IF;

  IF NOT v_admin THEN
    SELECT * INTO v_gate FROM shift_sale_gate(p_branch_id) LIMIT 1;
    IF v_gate IS NULL OR NOT COALESCE(v_gate.allowed, false) THEN
      RAISE EXCEPTION 'لازم تفتح وردية برصيد بداية الدرج قبل البيع (%)', COALESCE(v_gate.reason, 'no_shift');
    END IF;
    IF p_invoice_date IS NOT NULL AND p_invoice_date <> cairo_today() THEN
      RAISE EXCEPTION 'تغيير تاريخ الفاتورة متاح لمدير النظام فقط';
    END IF;
  END IF;

  IF COALESCE(p_credit_to_apply, 0) > 0 THEN
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'الخصم من الرصيد المسبق يحتاج عميل'; END IF;
    SELECT tenant_id, type INTO v_tenant, v_type FROM contacts WHERE id = p_customer_id FOR UPDATE;
    IF v_type NOT IN ('customer', 'both') THEN RAISE EXCEPTION 'الخصم من الرصيد المسبق متاح لحساب العميل بس'; END IF;
    PERFORM public.ledger_refresh_contact(p_customer_id);
    v_adv := public.ledger_side_advance(p_customer_id, 'customer');
    IF p_credit_to_apply > v_adv + 0.005 THEN
      RAISE EXCEPTION 'الرصيد المسبق المتاح للعميل (%) أقل من المطلوب خصمه (%)', v_adv, p_credit_to_apply;
    END IF;
  END IF;

  v_inv := process_sale(p_branch_id, p_customer_id, p_subtotal, p_discount_amount, p_discount_percent,
                        p_discount_reason, p_total, p_payment_method, p_items, p_payments,
                        p_vat_rate, p_vat_amount, p_invoice_date);

  IF NULLIF(trim(COALESCE(p_recipient, '')), '') IS NOT NULL OR NULLIF(trim(COALESCE(p_notes, '')), '') IS NOT NULL THEN
    PERFORM set_document_annotations('invoice', v_inv, p_recipient, p_notes);
  END IF;
  IF NULLIF(trim(COALESCE(p_notes, '')), '') IS NOT NULL THEN
    PERFORM set_invoice_meta(v_inv, NULL, trim(p_notes));
  END IF;

  IF COALESCE(p_credit_to_apply, 0) > 0 THEN
    SELECT round(i.total - COALESCE((SELECT sum(ip.amount) FROM invoice_payments ip
                                      WHERE ip.invoice_id = i.id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
                                        AND ip.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement')), 0), 2)
      INTO v_open FROM invoices i WHERE i.id = v_inv;
    IF p_credit_to_apply > COALESCE(v_open, 0) + 0.005 THEN
      RAISE EXCEPTION 'الخصم من الرصيد أكبر من المتبقي على الفاتورة';
    END IF;
    INSERT INTO invoice_payments (invoice_id, tenant_id, branch_id, payment_method, amount, received_by_name, created_at)
    SELECT v_inv, v_tenant, p_branch_id, 'credit_balance', p_credit_to_apply, COALESCE(p_received_by_name, 'رصيد مسبق'),
           CASE WHEN (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date = cairo_today() THEN now() ELSE i.invoice_date END
      FROM invoices i WHERE i.id = v_inv;
    UPDATE contacts SET refund_status = CASE WHEN v_adv - p_credit_to_apply <= 0.005 THEN 'credit_used' ELSE 'credit_added' END
     WHERE id = p_customer_id;
    INSERT INTO customer_credit_log (contact_id, invoice_id, amount, type, notes, created_by)
    VALUES (p_customer_id, v_inv, p_credit_to_apply, 'credit_used', 'خصم من الرصيد المسبق في فاتورة بيع', v_uid);
  END IF;

  RETURN v_inv;
END
$fn$;

CREATE OR REPLACE FUNCTION public.allocate_sale_return_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_total numeric := COALESCE(NEW.total_refund, 0);
  v_debt numeric := 0; v_bal numeric := 0; v_excess numeric := 0; v_money_cap numeric := 0;
  v_paid_money numeric := 0; v_prior_money numeric := 0; v_has_nonmoney boolean := false;
  v_method text := COALESCE(NULLIF(NEW.refund_method, ''), 'cash');
  v_contact uuid; v_inv_method text; v_in_ledger boolean; v_own numeric := 0; v_own_ret numeric := 0;
  v_paid record;
BEGIN
  IF COALESCE(NEW.status, 'active') = 'draft' THEN NEW.status := 'active'; END IF;
  IF COALESCE(NEW.status, 'active') <> 'active' THEN RETURN NEW; END IF;
  NEW.status := 'active';

  SELECT i.contact_id, i.payment_method,
         (i.status = 'active' AND public.ledger_day(i.invoice_date) >= public.ledger_cutoff())
    INTO v_contact, v_inv_method, v_in_ledger
    FROM public.invoices i WHERE i.id = NEW.invoice_id;

  IF v_contact IS NOT NULL AND v_in_ledger THEN
    PERFORM public.ledger_refresh_contact(v_contact);
    IF TG_OP = 'UPDATE' THEN
      SELECT COALESCE(sum(pa.amount), 0) INTO v_own
        FROM payment_allocations pa JOIN money_movements mv ON mv.id = pa.movement_id
       WHERE pa.status = 'active' AND pa.debt_type = 'invoice' AND pa.debt_id = NEW.invoice_id
         AND mv.source_table = 'returns' AND mv.source_id = NEW.id;
    END IF;
    v_debt := GREATEST(COALESCE(public.ledger_doc_open('invoice', NEW.invoice_id), 0) + v_own, 0);
    SELECT * INTO v_paid FROM public.ledger_doc_paid('invoice', NEW.invoice_id);
    v_paid_money := COALESCE(v_paid.money, 0);
  ELSIF v_contact IS NOT NULL THEN
    v_debt := public.invoice_outstanding_debt(NEW.invoice_id, NEW.id);
  END IF;

  v_bal := LEAST(v_total, v_debt);
  v_excess := GREATEST(v_total - v_bal, 0);

  IF NOT (v_contact IS NOT NULL AND v_in_ledger) THEN
    SELECT COALESCE(SUM(ip.amount) FILTER (WHERE ip.payment_method NOT IN ('settlement', 'credit_balance', 'credit_applied')), 0),
           COALESCE(bool_or(ip.payment_method IN ('settlement', 'credit_balance', 'credit_applied')), false)
      INTO v_paid_money, v_has_nonmoney
      FROM public.invoice_payments ip
     WHERE ip.invoice_id = NEW.invoice_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL;
    IF v_paid_money = 0 AND NOT v_has_nonmoney
       AND NOT EXISTS (SELECT 1 FROM public.invoice_payments WHERE invoice_id = NEW.invoice_id)
       AND COALESCE(v_inv_method, 'cash') NOT IN ('settlement', 'credit_balance', 'credit') THEN
      SELECT total INTO v_paid_money FROM public.invoices WHERE id = NEW.invoice_id;
    END IF;
  END IF;

  SELECT COALESCE(SUM(COALESCE(r.refund_cash_amount, 0) + COALESCE(r.refund_transfer_amount, 0)), 0)
    INTO v_prior_money FROM public.returns r
   WHERE r.invoice_id = NEW.invoice_id AND r.id <> NEW.id AND COALESCE(r.status, 'active') = 'active';

  v_money_cap := GREATEST(COALESCE(v_paid_money, 0) - v_prior_money, 0);

  IF v_contact IS NOT NULL AND v_excess > v_money_cap THEN
    v_bal := v_bal + (v_excess - v_money_cap);
    v_excess := v_money_cap;
  END IF;

  NEW.refund_balance_amount := v_bal;
  IF v_method IN ('cash', 'balance') THEN
    NEW.refund_cash_amount := v_excess;
    NEW.refund_transfer_amount := 0;
    IF v_excess > 0 AND v_method = 'balance' THEN NEW.refund_method := 'cash'; END IF;
    IF v_excess = 0 THEN NEW.refund_method := 'balance'; END IF;
  ELSE
    NEW.refund_cash_amount := 0;
    NEW.refund_transfer_amount := v_excess;
    IF v_excess = 0 THEN NEW.refund_method := 'balance'; END IF;
  END IF;
  RETURN NEW;
END
$fn$;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.cancel_invoice_with_refund(uuid,text,text)'::regprocedure);
  v_new := replace(v_def,
$a$  SELECT id INTO v_plan_id FROM payment_plans WHERE reference_type='invoice' AND reference_id=_invoice_id LIMIT 1;
  IF v_plan_id IS NOT NULL THEN
    SELECT COALESCE(SUM(paid_amount),0) INTO v_paid FROM payment_installments WHERE payment_plan_id = v_plan_id;
  END IF;
  v_paid := v_paid + COALESCE((SELECT SUM(amount) FROM invoice_payments
    WHERE invoice_id = _invoice_id AND voided_at IS NULL AND reverses_payment_id IS NULL), 0);$a$,
$b$  SELECT id INTO v_plan_id FROM payment_plans WHERE reference_type='invoice' AND reference_id=_invoice_id LIMIT 1;
  -- Step 6D: money paid on the invoice comes from the ledger (any branch, FIFO), counted once.
  IF v_inv.contact_id IS NOT NULL AND public.ledger_day(v_inv.invoice_date) >= public.ledger_cutoff() THEN
    PERFORM public.ledger_refresh_contact(v_inv.contact_id);
    v_paid := COALESCE((SELECT x.money FROM public.ledger_doc_paid('invoice', _invoice_id) x), 0);
  ELSE
    -- walk-in / before the ledger date: real payments, plan collections once (a mirrored collection is
    -- both a plan transaction and an invoice payment)
    IF v_plan_id IS NOT NULL THEN
      SELECT COALESCE(SUM(pt.amount), 0) INTO v_paid FROM payment_transactions pt
       WHERE pt.payment_plan_id = v_plan_id AND pt.direction = 'in' AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL
         AND pt.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement');
    END IF;
    v_paid := v_paid + COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip
      WHERE ip.invoice_id = _invoice_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
        AND ip.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement')
        AND NOT EXISTS (SELECT 1 FROM payment_transactions pt
                         WHERE pt.payment_plan_id = v_plan_id AND pt.created_at = ip.created_at
                           AND pt.payment_method = ip.payment_method)), 0);
  END IF;$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6D: cancel_invoice_with_refund body not found'; END IF;
  EXECUTE v_new;
END
$patch$;