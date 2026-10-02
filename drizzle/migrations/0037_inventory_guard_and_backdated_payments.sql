-- Inventory integrity: products with stock history can only be archived, never deleted.
ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_product_id_fkey,
  ADD CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;
ALTER TABLE public.product_batches DROP CONSTRAINT product_batches_product_id_fkey,
  ADD CONSTRAINT product_batches_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;
ALTER TABLE public.stock_transfers DROP CONSTRAINT stock_transfers_product_id_fkey,
  ADD CONSTRAINT stock_transfers_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_reservations DROP CONSTRAINT inventory_reservations_product_id_fkey,
  ADD CONSTRAINT inventory_reservations_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.block_product_delete_with_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- full branch reset (guarded admin RPC) is the only path allowed to purge a product's history
  IF COALESCE(current_setting('nizam.branch_reset', true), '') = 'on' THEN
    DELETE FROM stock_movements WHERE product_id = OLD.id;
    DELETE FROM product_batches WHERE product_id = OLD.id;
    DELETE FROM stock_transfers WHERE product_id = OLD.id;
    DELETE FROM inventory_reservations WHERE product_id = OLD.id;
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM stock_movements WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM product_batches WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM stock_transfers WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM invoice_items WHERE product_id = OLD.id)
     OR EXISTS (SELECT 1 FROM shipment_items WHERE product_id = OLD.id) THEN
    RAISE EXCEPTION 'لا يمكن حذف الصنف "%" لأن له حركات مخزون سابقة — استخدم الأرشفة أو إيقاف التفعيل', OLD.name;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_block_product_delete_with_history ON public.products;
CREATE TRIGGER trg_block_product_delete_with_history BEFORE DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.block_product_delete_with_history();

DROP FUNCTION public.record_payment_transaction(uuid, uuid, numeric, text, text, text, text, numeric, text, boolean, text, text);
CREATE OR REPLACE FUNCTION public.record_payment_transaction(p_payment_plan_id uuid, p_installment_id uuid, p_amount numeric, p_payment_method text, p_reference_number text, p_transfer_to_account text, p_received_by_name text, p_fee_amount numeric, p_fee_type text, p_fee_on_customer boolean, p_direction text, p_transfer_from_account text DEFAULT NULL::text, p_payment_date date DEFAULT NULL::date)
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
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date; v_doc_date date; v_date date; v_ts timestamptz;
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

  -- accounting date: payments of a backdated document inherit its date
  v_date := COALESCE(p_payment_date, v_today);
  IF v_date > v_today THEN RAISE EXCEPTION 'لا يمكن تسجيل دفعة بتاريخ مستقبلي'; END IF;
  IF v_date <> v_today THEN
    IF v_plan.reference_type = 'shipment' THEN
      SELECT COALESCE((s.invoice_date AT TIME ZONE 'Africa/Cairo')::date, s.arrival_date) INTO v_doc_date FROM shipments s WHERE s.id = v_plan.reference_id;
    ELSIF v_plan.reference_type = 'invoice' THEN
      SELECT (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date INTO v_doc_date FROM invoices i WHERE i.id = v_plan.reference_id;
    END IF;
    IF v_doc_date IS DISTINCT FROM v_date AND NOT (public.is_super_admin(v_uid) OR public.has_role(v_uid, 'admin'::app_role)) THEN
      RAISE EXCEPTION 'تاريخ الدفعة لازم يطابق تاريخ المستند (التاريخ المختلف للمدير فقط)';
    END IF;
  END IF;
  v_ts := CASE WHEN v_date = v_today THEN now() ELSE (v_date + time '12:00') AT TIME ZONE 'Africa/Cairo' END;

  v_contact_id := CASE WHEN v_plan.entity_type IN ('supplier','customer','contact') THEN v_plan.entity_id ELSE NULL END;
  v_total_with_fee := p_amount + CASE WHEN p_fee_on_customer THEN COALESCE(p_fee_amount,0) ELSE 0 END;

  INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, reference_number, transfer_to_account, transfer_from_account, created_by, tenant_id, transaction_date, created_at)
  VALUES (v_branch,
    (CASE WHEN p_direction='in' THEN 'income' ELSE 'expense' END)::treasury_type,
    CASE WHEN p_direction='in' THEN 'payment_in' ELSE 'payment_out' END,
    p_amount,
    'دفعة خطة #' || substr(p_payment_plan_id::text,1,8) || ' — ' || v_plan.entity_name,
    p_payment_method, p_reference_number, p_transfer_to_account, p_transfer_from_account, v_uid, v_tenant, v_date, v_ts)
  RETURNING id INTO v_treasury_id;

  IF COALESCE(p_fee_amount,0) > 0 AND NOT p_fee_on_customer THEN
    INSERT INTO expenses(branch_id, type, amount, description, date, payment_method, reference_number, is_fee, created_by, tenant_id)
    VALUES (v_branch, 'عمولة تحويل', p_fee_amount,
      'عمولة ' || p_payment_method || ' — دفعة خطة #' || substr(p_payment_plan_id::text,1,8),
      v_date, p_payment_method, p_reference_number, true, v_uid, v_tenant);
    INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, is_fee, created_by, tenant_id, transaction_date, created_at)
    VALUES (v_branch, 'expense'::treasury_type, 'fee', p_fee_amount, 'عمولة ' || p_payment_method, p_payment_method, true, v_uid, v_tenant, v_date, v_ts)
    RETURNING id INTO v_fee_treasury_id;
  END IF;

  INSERT INTO payment_transactions(payment_plan_id, installment_id, branch_id, tenant_id, contact_id,
    direction, amount, payment_method, fee_amount, fee_type, total_with_fee,
    reference_number, transfer_to_account, transfer_from_account, received_by_name,
    treasury_id, fee_treasury_id, created_by, created_at)
  VALUES (p_payment_plan_id, p_installment_id, v_branch, v_tenant, v_contact_id,
    p_direction, p_amount, p_payment_method, COALESCE(p_fee_amount,0), p_fee_type, v_total_with_fee,
    p_reference_number, p_transfer_to_account, p_transfer_from_account, p_received_by_name,
    v_treasury_id, v_fee_treasury_id, v_uid, v_ts)
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
          fee_amount, fee_on_customer, created_at
        ) VALUES (
          v_inv.id, v_tenant, COALESCE(v_inv.branch_id, v_branch), p_payment_method, v_link_amount,
          NULLIF(p_reference_number,''), COALESCE(NULLIF(p_received_by_name,''), v_uname),
          NULLIF(p_transfer_to_account,''), NULLIF(p_transfer_from_account,''),
          0, false, v_ts
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
GRANT EXECUTE ON FUNCTION public.record_payment_transaction(uuid, uuid, numeric, text, text, text, text, numeric, text, boolean, text, text, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_reset_branch_data(p_branch_id uuid, p_options jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_summary jsonb;
  v_extras jsonb;
  v_tenant uuid := public.current_tenant_id();
  v_purged integer := 0;
BEGIN
  PERFORM set_config('nizam.branch_reset', 'on', true);
  v_summary := public.admin_reset_branch_data_impl(p_branch_id, p_options);
  v_extras := public.admin_reset_go_live_extras(p_branch_id, p_options);
  v_purged := public.purge_orphan_journal_entries(v_tenant);
  PERFORM set_config('nizam.branch_reset', 'off', true);
  RETURN COALESCE(v_summary, '{}'::jsonb) || COALESCE(v_extras, '{}'::jsonb) || jsonb_build_object('journal_entries_purged', v_purged);
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_sale_full(p_branch_id uuid, p_customer_id uuid, p_subtotal numeric, p_discount_amount numeric, p_discount_percent numeric, p_discount_reason text, p_total numeric, p_payment_method text, p_items jsonb, p_payments jsonb, p_vat_rate numeric, p_vat_amount numeric, p_invoice_date date, p_recipient text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_credit_to_apply numeric DEFAULT 0, p_received_by_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inv uuid; v_uid uuid := auth.uid(); v_gate record; v_credit numeric; v_tenant uuid;
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

  v_inv := process_sale(p_branch_id, p_customer_id, p_subtotal, p_discount_amount, p_discount_percent,
                        p_discount_reason, p_total, p_payment_method, p_items, p_payments,
                        p_vat_rate, p_vat_amount, p_invoice_date);

  IF NULLIF(trim(COALESCE(p_recipient,'')),'') IS NOT NULL OR NULLIF(trim(COALESCE(p_notes,'')),'') IS NOT NULL THEN
    PERFORM set_document_annotations('invoice', v_inv, p_recipient, p_notes);
  END IF;
  IF NULLIF(trim(COALESCE(p_notes,'')),'') IS NOT NULL THEN
    PERFORM set_invoice_meta(v_inv, NULL, trim(p_notes));
  END IF;

  IF COALESCE(p_credit_to_apply,0) > 0 THEN
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'الخصم من الرصيد المسبق يحتاج عميل'; END IF;
    SELECT COALESCE(credit_balance,0), tenant_id INTO v_credit, v_tenant FROM contacts WHERE id = p_customer_id FOR UPDATE;
    -- credit_balance < 0 means prepaid credit available to the customer
    IF p_credit_to_apply > GREATEST(-v_credit,0) + 0.005 THEN
      RAISE EXCEPTION 'الرصيد المسبق المتاح للعميل (%) أقل من المطلوب خصمه (%)', GREATEST(-v_credit,0), p_credit_to_apply;
    END IF;
    IF p_credit_to_apply > public.invoice_outstanding_debt(v_inv, NULL) + 0.005 THEN
      RAISE EXCEPTION 'الخصم من الرصيد أكبر من المتبقي على الفاتورة';
    END IF;
    INSERT INTO invoice_payments (invoice_id, tenant_id, branch_id, payment_method, amount, received_by_name, created_at)
    SELECT v_inv, v_tenant, p_branch_id, 'credit_balance', p_credit_to_apply, COALESCE(p_received_by_name,'رصيد مسبق'),
           CASE WHEN (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date = cairo_today() THEN now() ELSE i.invoice_date END
      FROM invoices i WHERE i.id = v_inv;
    UPDATE contacts SET refund_status = CASE WHEN LEAST(0, v_credit + p_credit_to_apply) = 0 THEN 'credit_used' ELSE 'credit_added' END
     WHERE id = p_customer_id;
    INSERT INTO customer_credit_log (contact_id, invoice_id, amount, type, notes, created_by)
    VALUES (p_customer_id, v_inv, p_credit_to_apply, 'credit_used', 'خصم من الرصيد المسبق في فاتورة بيع', v_uid);
  END IF;

  RETURN v_inv;
END;
$function$;