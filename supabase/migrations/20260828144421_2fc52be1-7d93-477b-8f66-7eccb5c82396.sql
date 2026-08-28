-- ============ 1) post_journal: no phantom / unbalanced entries ============
CREATE OR REPLACE FUNCTION public.post_journal(p_tenant_id uuid, p_entry_date date, p_description text, p_source_type text, p_source_id uuid, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entry_id UUID; v_entry_number TEXT; v_line JSONB;
  v_account_id UUID; v_seq INTEGER;
  v_debit NUMERIC(18,2); v_credit NUMERIC(18,2);
  v_total_debit NUMERIC(18,2) := 0; v_total_credit NUMERIC(18,2) := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 2 THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || 'JE-'||to_char(p_entry_date,'YYYYMM')||'-'));
  SELECT COALESCE(MAX(CAST(SPLIT_PART(entry_number,'-',3) AS INTEGER)),0)+1 INTO v_seq
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id
     AND entry_number LIKE 'JE-'||to_char(p_entry_date,'YYYYMM')||'-%';
  v_entry_number := 'JE-'||to_char(p_entry_date,'YYYYMM')||'-'||LPAD(v_seq::TEXT,4,'0');

  INSERT INTO public.journal_entries(tenant_id, entry_number, entry_date, description, source_type, source_id, status)
  VALUES (p_tenant_id, v_entry_number, p_entry_date, p_description, p_source_type, p_source_id, 'draft')
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_debit  := COALESCE((v_line->>'debit')::NUMERIC, 0);
    v_credit := COALESCE((v_line->>'credit')::NUMERIC, 0);
    IF v_debit = 0 AND v_credit = 0 THEN CONTINUE; END IF;

    SELECT id INTO v_account_id FROM public.chart_of_accounts
      WHERE tenant_id = p_tenant_id AND code = v_line->>'account_code' LIMIT 1;
    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'حساب مفقود في شجرة الحسابات (%) — لا يمكن ترحيل المستند %/%',
        v_line->>'account_code', p_source_type, p_source_id;
    END IF;

    INSERT INTO public.journal_entry_lines(tenant_id, entry_id, account_id, debit, credit, description)
    VALUES (p_tenant_id, v_entry_id, v_account_id, v_debit, v_credit, v_line->>'description');

    v_total_debit  := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  IF v_total_debit = 0 AND v_total_credit = 0 THEN
    DELETE FROM public.journal_entries WHERE id = v_entry_id;
    RETURN NULL;
  END IF;

  IF ROUND(v_total_debit,2) <> ROUND(v_total_credit,2) THEN
    RAISE EXCEPTION 'القيد غير متزن للمستند %/%: مدين=% دائن=%',
      p_source_type, p_source_id, ROUND(v_total_debit,2), ROUND(v_total_credit,2);
  END IF;

  UPDATE public.journal_entries SET status = 'posted' WHERE id = v_entry_id;
  RETURN v_entry_id;
END $function$;

-- ============ 2) record_payment_transaction: settle invoice debt + concurrency safe ============
CREATE OR REPLACE FUNCTION public.record_payment_transaction(p_payment_plan_id uuid, p_installment_id uuid, p_amount numeric, p_payment_method text, p_reference_number text, p_transfer_to_account text, p_received_by_name text, p_fee_amount numeric, p_fee_type text, p_fee_on_customer boolean, p_direction text, p_transfer_from_account text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tx_id uuid; v_treasury_id uuid; v_fee_treasury_id uuid;
  v_branch uuid; v_tenant uuid; v_plan record;
  v_total_with_fee numeric; v_uid uuid := auth.uid(); v_contact_id uuid;
  v_inv record; v_inv_paid numeric; v_inv_remaining numeric; v_link_amount numeric;
  v_rest numeric; v_inst record; v_alloc numeric; v_uname text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  PERFORM public._validate_transfer_payment(p_payment_method, p_reference_number, p_transfer_from_account, p_transfer_to_account);
  IF p_payment_plan_id IS NULL THEN RAISE EXCEPTION 'payment_plan_id required'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_direction NOT IN ('in','out') THEN RAISE EXCEPTION 'direction must be in/out'; END IF;

  -- lock the plan row: serializes concurrent collections on the same plan
  SELECT * INTO v_plan FROM payment_plans WHERE id = p_payment_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan not found'; END IF;
  v_branch := v_plan.branch_id; v_tenant := v_plan.tenant_id;

  IF v_tenant IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'payment plan does not belong to your tenant'; END IF;
  IF NOT (
    public.is_super_admin(v_uid)
    OR public.has_role(v_uid, 'admin'::app_role)
    OR (public.user_in_branch(v_uid, v_branch)
        AND (public.has_role(v_uid, 'branch_manager'::app_role)
             OR public.has_role(v_uid, 'accountant'::app_role)
             OR public.has_role(v_uid, 'cashier'::app_role)))
  ) THEN RAISE EXCEPTION 'insufficient permissions'; END IF;

  IF p_direction = 'in' AND COALESCE(v_plan.remaining_amount, 0) > 0
     AND p_amount > COALESCE(v_plan.remaining_amount, 0) + 0.01 THEN
    RAISE EXCEPTION 'المبلغ (%) أكبر من المتبقي على الخطة (%)', p_amount, v_plan.remaining_amount;
  END IF;

  v_contact_id := CASE WHEN v_plan.entity_type IN ('supplier','customer','contact') THEN v_plan.entity_id ELSE NULL END;
  v_total_with_fee := p_amount + CASE WHEN p_fee_on_customer THEN COALESCE(p_fee_amount,0) ELSE 0 END;

  INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, reference_number, transfer_to_account, transfer_from_account, created_by, tenant_id)
  VALUES (v_branch,
    (CASE WHEN p_direction='in' THEN 'income' ELSE 'expense' END)::treasury_type,
    CASE WHEN p_direction='in' THEN 'payment_in' ELSE 'payment_out' END,
    p_amount,
    'دفعة خطة #' || substr(p_payment_plan_id::text,1,8) || ' — ' || v_plan.entity_name,
    p_payment_method, p_reference_number, p_transfer_to_account, p_transfer_from_account, v_uid, v_tenant)
  RETURNING id INTO v_treasury_id;

  IF COALESCE(p_fee_amount,0) > 0 AND NOT p_fee_on_customer THEN
    INSERT INTO expenses(branch_id, type, amount, description, date, payment_method, reference_number, is_fee, created_by, tenant_id)
    VALUES (v_branch, 'عمولة تحويل', p_fee_amount,
      'عمولة ' || p_payment_method || ' — دفعة خطة #' || substr(p_payment_plan_id::text,1,8),
      CURRENT_DATE, p_payment_method, p_reference_number, true, v_uid, v_tenant);
    INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, is_fee, created_by, tenant_id)
    VALUES (v_branch, 'expense'::treasury_type, 'fee', p_fee_amount, 'عمولة ' || p_payment_method, p_payment_method, true, v_uid, v_tenant)
    RETURNING id INTO v_fee_treasury_id;
  END IF;

  INSERT INTO payment_transactions(payment_plan_id, installment_id, branch_id, tenant_id, contact_id,
    direction, amount, payment_method, fee_amount, fee_type, total_with_fee,
    reference_number, transfer_to_account, transfer_from_account, received_by_name,
    treasury_id, fee_treasury_id, created_by)
  VALUES (p_payment_plan_id, p_installment_id, v_branch, v_tenant, v_contact_id,
    p_direction, p_amount, p_payment_method, COALESCE(p_fee_amount,0), p_fee_type, v_total_with_fee,
    p_reference_number, p_transfer_to_account, p_transfer_from_account, p_received_by_name,
    v_treasury_id, v_fee_treasury_id, v_uid)
  RETURNING id INTO v_tx_id;

  -- ===== link the collection to the originating sales invoice (settles customer debt) =====
  IF p_direction = 'in' AND v_plan.reference_type = 'invoice' AND v_plan.reference_id IS NOT NULL THEN
    SELECT * INTO v_inv FROM public.invoices
      WHERE id = v_plan.reference_id AND tenant_id = v_tenant AND status = 'active'
      FOR UPDATE;
    IF FOUND THEN
      SELECT COALESCE(SUM(amount),0) INTO v_inv_paid
      FROM public.invoice_payments
      WHERE invoice_id = v_inv.id AND voided_at IS NULL AND reverses_payment_id IS NULL;

      v_inv_remaining := ROUND(GREATEST(COALESCE(v_inv.total,0) - v_inv_paid, 0), 2);
      v_link_amount := LEAST(ROUND(p_amount,2), v_inv_remaining);

      IF v_link_amount > 0 THEN
        SELECT name INTO v_uname FROM public.profiles WHERE id = v_uid;
        INSERT INTO public.invoice_payments(
          invoice_id, tenant_id, branch_id, payment_method, amount,
          reference_number, received_by_name, transfer_to_account, transfer_from_account,
          fee_amount, fee_on_customer
        ) VALUES (
          v_inv.id, v_tenant, COALESCE(v_inv.branch_id, v_branch), p_payment_method, v_link_amount,
          NULLIF(p_reference_number,''), COALESCE(NULLIF(p_received_by_name,''), v_uname),
          NULLIF(p_transfer_to_account,''), NULLIF(p_transfer_from_account,''),
          0, false
        );
      END IF;
    END IF;
  END IF;

  -- ===== installments: explicit one first, then oldest-first for the rest =====
  v_rest := ROUND(p_amount, 2);

  IF p_installment_id IS NOT NULL THEN
    SELECT * INTO v_inst FROM payment_installments WHERE id = p_installment_id FOR UPDATE;
    IF FOUND THEN
      v_alloc := LEAST(v_rest, GREATEST(COALESCE(v_inst.amount,0) - COALESCE(v_inst.paid_amount,0), 0));
      IF v_alloc <= 0 THEN v_alloc := v_rest; END IF;
      UPDATE payment_installments SET
        paid_amount = COALESCE(paid_amount,0) + v_alloc,
        paid_at = CASE WHEN COALESCE(paid_amount,0) + v_alloc >= amount THEN now() ELSE paid_at END,
        status = CASE WHEN COALESCE(paid_amount,0) + v_alloc >= amount THEN 'paid'
                      WHEN COALESCE(paid_amount,0) + v_alloc > 0 THEN 'partial'
                      ELSE 'pending' END,
        updated_at = now()
      WHERE id = p_installment_id;
      v_rest := ROUND(v_rest - v_alloc, 2);
    END IF;
  END IF;

  IF v_rest > 0 THEN
    FOR v_inst IN
      SELECT * FROM payment_installments
      WHERE payment_plan_id = p_payment_plan_id
        AND COALESCE(paid_amount,0) < amount
        AND (p_installment_id IS NULL OR id <> p_installment_id)
      ORDER BY due_date NULLS LAST, created_at
      FOR UPDATE
    LOOP
      EXIT WHEN v_rest <= 0;
      v_alloc := LEAST(v_rest, GREATEST(COALESCE(v_inst.amount,0) - COALESCE(v_inst.paid_amount,0), 0));
      EXIT WHEN v_alloc <= 0;
      UPDATE payment_installments SET
        paid_amount = COALESCE(paid_amount,0) + v_alloc,
        paid_at = CASE WHEN COALESCE(paid_amount,0) + v_alloc >= amount THEN now() ELSE paid_at END,
        status = CASE WHEN COALESCE(paid_amount,0) + v_alloc >= amount THEN 'paid' ELSE 'partial' END,
        updated_at = now()
      WHERE id = v_inst.id;
      v_rest := ROUND(v_rest - v_alloc, 2);
    END LOOP;
  END IF;

  UPDATE payment_plans SET
    paid_amount = COALESCE(paid_amount,0) + p_amount,
    remaining_amount = GREATEST(total_amount - (COALESCE(paid_amount,0) + p_amount), 0),
    status = CASE WHEN total_amount - (COALESCE(paid_amount,0) + p_amount) <= 0 THEN 'settled' ELSE status END,
    updated_at = now()
  WHERE id = p_payment_plan_id;

  RETURN v_tx_id;
END;
$function$;

-- ============ 3) orphan journal cleanup ============
CREATE OR REPLACE FUNCTION public.purge_orphan_journal_entries(p_tenant uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_tenant IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.journal_entries j
  WHERE j.tenant_id = p_tenant
    AND (
      (j.source_type IN ('invoice','invoice_cogs')
        AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = j.source_id))
      OR (j.source_type = 'invoice_payment'
        AND NOT EXISTS (SELECT 1 FROM public.invoice_payments p WHERE p.id = j.source_id))
      OR (j.source_type = 'shipment'
        AND NOT EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = j.source_id))
      OR (j.source_type IN ('voucher','voucher_reversal')
        AND NOT EXISTS (SELECT 1 FROM public.vouchers v WHERE v.id = j.source_id))
      OR (j.source_type = 'return'
        AND NOT EXISTS (SELECT 1 FROM public.returns r WHERE r.id = j.source_id))
      OR (j.source_type = 'purchase_return'
        AND NOT EXISTS (SELECT 1 FROM public.purchase_returns pr WHERE pr.id = j.source_id))
      OR (j.source_type = 'partner_transaction'
        AND NOT EXISTS (SELECT 1 FROM public.partner_transactions pt WHERE pt.id = j.source_id))
      OR (j.source_type = 'expense'
        AND NOT EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = j.source_id))
      OR (j.source_type IN ('stock_adjustment','inventory_adjustment')
        AND NOT EXISTS (SELECT 1 FROM public.stock_adjustments sa WHERE sa.id = j.source_id))
      OR (j.source_type IN ('fixed_asset','asset_disposal')
        AND NOT EXISTS (SELECT 1 FROM public.fixed_assets fa WHERE fa.id = j.source_id))
      OR (j.source_type = 'depreciation'
        AND NOT EXISTS (SELECT 1 FROM public.depreciation_entries de WHERE de.id = j.source_id))
      OR (j.source_type = 'payment_transaction'
        AND NOT EXISTS (SELECT 1 FROM public.payment_transactions ptx WHERE ptx.id = j.source_id))
      OR (j.source_type = 'salary'
        AND NOT EXISTS (SELECT 1 FROM public.salaries sl WHERE sl.id = j.source_id))
    );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reset_vouchers(p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_n int := 0;
  v_je int := 0;
  v_ids uuid[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF NOT (public.has_role(v_user, 'admin'::app_role) OR public.is_super_admin(v_user)) THEN
    RAISE EXCEPTION 'هذا الإجراء متاح للمدير العام فقط';
  END IF;
  v_tenant := public.current_tenant_id();

  SELECT array_agg(id) INTO v_ids FROM public.vouchers
  WHERE tenant_id = v_tenant AND (p_branch_id IS NULL OR branch_id = p_branch_id);

  IF v_ids IS NOT NULL THEN
    DELETE FROM public.journal_entry_lines
    WHERE entry_id IN (
      SELECT id FROM public.journal_entries
      WHERE tenant_id = v_tenant
        AND source_type IN ('voucher','voucher_reversal')
        AND source_id = ANY(v_ids)
    );
    DELETE FROM public.journal_entries
    WHERE tenant_id = v_tenant
      AND source_type IN ('voucher','voucher_reversal')
      AND source_id = ANY(v_ids);
    GET DIAGNOSTICS v_je = ROW_COUNT;

    DELETE FROM public.vouchers WHERE id = ANY(v_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  v_je := v_je + public.purge_orphan_journal_entries(v_tenant);

  INSERT INTO public.audit_log (tenant_id, user_id, user_name, branch_id, action, entity, entity_id, details)
  VALUES (v_tenant, v_user, COALESCE((SELECT name FROM public.profiles WHERE id = v_user), 'النظام'),
          p_branch_id, 'RESET', 'Vouchers', COALESCE(p_branch_id, v_tenant),
          jsonb_build_object('deleted_count', v_n, 'journal_entries_deleted', v_je));

  RETURN jsonb_build_object('vouchers_deleted', v_n, 'journal_entries_deleted', v_je);
END;
$function$;