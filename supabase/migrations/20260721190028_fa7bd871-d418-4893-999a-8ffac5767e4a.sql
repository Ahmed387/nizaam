
-- Bug 1
CREATE OR REPLACE FUNCTION public.admin_set_product_quantity(p_product_id uuid, p_actual_quantity integer, p_reason text DEFAULT 'admin_manual_edit'::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_prod public.products%ROWTYPE;
  v_system_qty int; v_diff int; v_adj_id uuid; v_num text;
  v_take numeric; v_remaining numeric; b record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_actual_quantity < 0 THEN RAISE EXCEPTION 'الكمية لا يمكن أن تكون سالبة'; END IF;

  SELECT * INTO v_prod FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المنتج غير موجود'; END IF;

  IF v_prod.tenant_id IS DISTINCT FROM public.current_tenant_id()
     AND NOT public.is_super_admin(v_user) THEN
    RAISE EXCEPTION 'المنتج ليس ضمن شركتك';
  END IF;
  IF NOT (
    public.is_super_admin(v_user)
    OR public.has_role(v_user, 'admin'::app_role)
    OR (public.user_in_branch(v_user, v_prod.branch_id)
        AND (public.has_role(v_user, 'branch_manager'::app_role)
             OR public.has_role(v_user, 'warehouse'::app_role)))
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية لتعديل هذا المنتج';
  END IF;

  v_system_qty := COALESCE(v_prod.quantity, 0);
  v_diff := p_actual_quantity - v_system_qty;
  IF v_diff = 0 THEN
    RETURN jsonb_build_object('changed', false, 'system', v_system_qty, 'actual', p_actual_quantity);
  END IF;

  v_num := 'ADJ-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(md5(random()::text),1,6));
  INSERT INTO public.stock_adjustments(tenant_id, branch_id, adjustment_number, reason, notes, created_by)
  VALUES (v_prod.tenant_id, v_prod.branch_id, v_num, COALESCE(p_reason,'admin_manual_edit'), p_notes, v_user)
  RETURNING id INTO v_adj_id;

  INSERT INTO public.stock_adjustment_items(adjustment_id, product_id, product_name, system_quantity, actual_quantity, difference, unit_cost)
  VALUES (v_adj_id, v_prod.id, v_prod.name, v_system_qty, p_actual_quantity, v_diff, COALESCE(v_prod.cost_price,0));

  IF v_diff > 0 THEN
    INSERT INTO public.product_batches(tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining, cost_price, base_purchase_price, true_unit_cost, batch_type)
    VALUES (v_prod.tenant_id, v_prod.branch_id, v_prod.id, v_diff, v_diff, COALESCE(v_prod.cost_price,0), COALESCE(v_prod.cost_price,0), COALESCE(v_prod.cost_price,0), 'adjustment');
  ELSE
    v_remaining := -v_diff;
    FOR b IN SELECT id, quantity_remaining FROM public.product_batches
             WHERE product_id = v_prod.id AND quantity_remaining > 0
             ORDER BY created_at ASC FOR UPDATE LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(b.quantity_remaining, v_remaining);
      UPDATE public.product_batches SET quantity_remaining = quantity_remaining - v_take WHERE id = b.id;
      v_remaining := v_remaining - v_take;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('changed', true, 'system', v_system_qty, 'actual', p_actual_quantity, 'diff', v_diff, 'adjustment_id', v_adj_id, 'adjustment_number', v_num);
END;
$function$;

-- Bug 2: recreate 3 edit_invoice overloads (preserve default signatures)
CREATE OR REPLACE FUNCTION public.edit_invoice(_invoice_id uuid, _customer_id uuid, _items jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  inv record; uid uuid := auth.uid(); is_adm boolean; is_bm boolean;
  it jsonb; old_it record; v_new_qty int; v_pid uuid;
  v_subtotal numeric := 0; v_total numeric := 0; v_disc_amount numeric;
  v_consume jsonb; v_batches jsonb; v_single_batch uuid; v_unit_cost numeric; v_orig_cost numeric;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF inv.status <> 'active' THEN RAISE EXCEPTION 'لا يمكن تعديل فاتورة ملغاة'; END IF;
  IF inv.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(uid) THEN
    RAISE EXCEPTION 'الفاتورة ليست ضمن شركتك'; END IF;
  SELECT public.has_role(uid, 'admin'::app_role) INTO is_adm;
  SELECT public.has_role(uid, 'branch_manager'::app_role) INTO is_bm;
  IF NOT (is_adm OR is_bm OR public.is_super_admin(uid)) THEN
    RAISE EXCEPTION 'غير مصرح بتعديل الفاتورة'; END IF;
  IF NOT is_adm AND NOT public.is_super_admin(uid) AND NOT public.user_in_branch(uid, inv.branch_id) THEN
    RAISE EXCEPTION 'الفرع خارج نطاق صلاحياتك'; END IF;

  FOR old_it IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
    IF old_it.batches_consumed IS NOT NULL AND jsonb_array_length(old_it.batches_consumed) > 0 THEN
      PERFORM public.restore_batches_from_item(old_it.id); END IF;
    IF old_it.product_id IS NOT NULL THEN
      UPDATE public.products SET quantity = quantity + old_it.quantity WHERE id = old_it.product_id; END IF;
  END LOOP;
  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_pid := NULLIF((it->>'product_id'), '')::uuid;
    v_new_qty := COALESCE((it->>'quantity')::int, 0);
    IF v_new_qty <= 0 THEN CONTINUE; END IF;
    v_batches := NULL; v_single_batch := NULL; v_unit_cost := COALESCE((it->>'cost_price')::numeric, 0);
    IF v_pid IS NOT NULL THEN
      v_consume := public.consume_product_batches_json(v_pid, inv.branch_id, v_new_qty::numeric);
      v_batches := COALESCE(v_consume->'batches', '[]'::jsonb);
      v_unit_cost := COALESCE((v_consume->>'weighted_unit_cost')::numeric, v_unit_cost);
      IF jsonb_array_length(v_batches) = 1 THEN v_single_batch := NULLIF(v_batches->0->>'batch_id','')::uuid; END IF;
      UPDATE public.products SET quantity = quantity - v_new_qty WHERE id = v_pid;
    END IF;
    v_orig_cost := v_unit_cost;
    INSERT INTO public.invoice_items(invoice_id, product_id, product_name, quantity, cost_price, selling_price, market_price, line_discount, total, tenant_id, unit_cost_at_sale, batch_id, batches_consumed, original_unit_cost)
    VALUES (_invoice_id, v_pid, it->>'product_name', v_new_qty, v_unit_cost,
      COALESCE((it->>'selling_price')::numeric, 0), COALESCE((it->>'market_price')::numeric, 0),
      COALESCE((it->>'line_discount')::numeric, 0),
      (COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty) - COALESCE((it->>'line_discount')::numeric, 0),
      inv.tenant_id, v_unit_cost, v_single_batch, v_batches, v_orig_cost);
    v_subtotal := v_subtotal + (COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty);
    v_total := v_total + ((COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty) - COALESCE((it->>'line_discount')::numeric, 0));
  END LOOP;
  v_disc_amount := COALESCE(inv.discount_amount, 0);
  v_total := GREATEST(v_total - v_disc_amount, 0);
  UPDATE public.invoices SET contact_id = _customer_id, subtotal = v_subtotal, total = v_total WHERE id = _invoice_id;
  UPDATE public.treasury SET amount = v_total, description = 'تعديل فاتورة ' || inv.invoice_number
   WHERE reference_id = _invoice_id AND type = 'income';
END;
$function$;

CREATE OR REPLACE FUNCTION public.edit_invoice(_invoice_id uuid, _customer_id uuid, _items jsonb, _vat_rate numeric DEFAULT NULL::numeric)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  inv record; uid uuid := auth.uid(); is_adm boolean; is_bm boolean;
  it jsonb; old_it record; v_new_qty int; v_pid uuid;
  v_subtotal numeric := 0; v_total numeric := 0; v_disc_amount numeric;
  v_consume jsonb; v_batches jsonb; v_single_batch uuid; v_unit_cost numeric; v_orig_cost numeric;
  v_vat_rate numeric; v_vat_amount numeric := 0;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF inv.status <> 'active' THEN RAISE EXCEPTION 'لا يمكن تعديل فاتورة ملغاة'; END IF;
  IF inv.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(uid) THEN
    RAISE EXCEPTION 'الفاتورة ليست ضمن شركتك'; END IF;
  SELECT public.has_role(uid, 'admin'::app_role) INTO is_adm;
  SELECT public.has_role(uid, 'branch_manager'::app_role) INTO is_bm;
  IF NOT (is_adm OR is_bm OR public.is_super_admin(uid)) THEN
    RAISE EXCEPTION 'غير مصرح بتعديل الفاتورة'; END IF;
  IF NOT is_adm AND NOT public.is_super_admin(uid) AND NOT public.user_in_branch(uid, inv.branch_id) THEN
    RAISE EXCEPTION 'الفرع خارج نطاق صلاحياتك'; END IF;

  FOR old_it IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
    IF old_it.batches_consumed IS NOT NULL AND jsonb_array_length(old_it.batches_consumed) > 0 THEN
      PERFORM public.restore_batches_from_item(old_it.id); END IF;
    IF old_it.product_id IS NOT NULL THEN
      UPDATE public.products SET quantity = quantity + old_it.quantity WHERE id = old_it.product_id; END IF;
  END LOOP;
  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_pid := NULLIF((it->>'product_id'), '')::uuid;
    v_new_qty := COALESCE((it->>'quantity')::int, 0);
    IF v_new_qty <= 0 THEN CONTINUE; END IF;
    v_batches := NULL; v_single_batch := NULL; v_unit_cost := COALESCE((it->>'cost_price')::numeric, 0);
    IF v_pid IS NOT NULL THEN
      v_consume := public.consume_product_batches_json(v_pid, inv.branch_id, v_new_qty::numeric);
      v_batches := COALESCE(v_consume->'batches', '[]'::jsonb);
      v_unit_cost := COALESCE((v_consume->>'weighted_unit_cost')::numeric, v_unit_cost);
      IF jsonb_array_length(v_batches) = 1 THEN v_single_batch := NULLIF(v_batches->0->>'batch_id','')::uuid; END IF;
      UPDATE public.products SET quantity = quantity - v_new_qty WHERE id = v_pid;
    END IF;
    v_orig_cost := v_unit_cost;
    INSERT INTO public.invoice_items(invoice_id, product_id, product_name, quantity, cost_price, selling_price, market_price, line_discount, total, tenant_id, unit_cost_at_sale, batch_id, batches_consumed, original_unit_cost)
    VALUES (_invoice_id, v_pid, it->>'product_name', v_new_qty, v_unit_cost,
      COALESCE((it->>'selling_price')::numeric, 0), COALESCE((it->>'market_price')::numeric, 0),
      COALESCE((it->>'line_discount')::numeric, 0),
      (COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty) - COALESCE((it->>'line_discount')::numeric, 0),
      inv.tenant_id, v_unit_cost, v_single_batch, v_batches, v_orig_cost);
    v_subtotal := v_subtotal + (COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty);
    v_total := v_total + ((COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty) - COALESCE((it->>'line_discount')::numeric, 0));
  END LOOP;
  v_disc_amount := COALESCE(inv.discount_amount, 0);
  v_total := GREATEST(v_total - v_disc_amount, 0);
  v_vat_rate := COALESCE(_vat_rate, inv.vat_rate, 0);
  IF v_vat_rate < 0 THEN v_vat_rate := 0; END IF;
  v_vat_amount := ROUND(v_total * v_vat_rate / 100.0, 2);
  v_total := v_total + v_vat_amount;
  UPDATE public.invoices SET contact_id = _customer_id, subtotal = v_subtotal, total = v_total,
    vat_rate = v_vat_rate, vat_amount = v_vat_amount WHERE id = _invoice_id;
  UPDATE public.treasury SET amount = v_total, description = 'تعديل فاتورة ' || inv.invoice_number
   WHERE reference_id = _invoice_id AND type = 'income';
END;
$function$;

CREATE OR REPLACE FUNCTION public.edit_invoice(_invoice_id uuid, _customer_id uuid, _items jsonb, _vat_rate numeric DEFAULT NULL::numeric, _discount_amount numeric DEFAULT NULL::numeric)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  inv record; uid uuid := auth.uid(); is_adm boolean; is_bm boolean;
  it jsonb; old_it record; v_new_qty int; v_pid uuid;
  v_subtotal numeric := 0; v_total numeric := 0; v_disc_amount numeric;
  v_consume jsonb; v_batches jsonb; v_single_batch uuid; v_unit_cost numeric; v_orig_cost numeric;
  v_vat_rate numeric; v_vat_amount numeric := 0;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF inv.status <> 'active' THEN RAISE EXCEPTION 'لا يمكن تعديل فاتورة ملغاة'; END IF;
  IF inv.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(uid) THEN
    RAISE EXCEPTION 'الفاتورة ليست ضمن شركتك'; END IF;
  SELECT public.has_role(uid, 'admin'::app_role) INTO is_adm;
  SELECT public.has_role(uid, 'branch_manager'::app_role) INTO is_bm;
  IF NOT (is_adm OR is_bm OR public.is_super_admin(uid)) THEN
    RAISE EXCEPTION 'غير مصرح بتعديل الفاتورة'; END IF;
  IF NOT is_adm AND NOT public.is_super_admin(uid) AND NOT public.user_in_branch(uid, inv.branch_id) THEN
    RAISE EXCEPTION 'الفرع خارج نطاق صلاحياتك'; END IF;

  FOR old_it IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
    IF old_it.batches_consumed IS NOT NULL AND jsonb_array_length(old_it.batches_consumed) > 0 THEN
      PERFORM public.restore_batches_from_item(old_it.id); END IF;
    IF old_it.product_id IS NOT NULL THEN
      UPDATE public.products SET quantity = quantity + old_it.quantity WHERE id = old_it.product_id; END IF;
  END LOOP;
  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_pid := NULLIF((it->>'product_id'), '')::uuid;
    v_new_qty := COALESCE((it->>'quantity')::int, 0);
    IF v_new_qty <= 0 THEN CONTINUE; END IF;
    v_batches := NULL; v_single_batch := NULL; v_unit_cost := COALESCE((it->>'cost_price')::numeric, 0);
    IF v_pid IS NOT NULL THEN
      v_consume := public.consume_product_batches_json(v_pid, inv.branch_id, v_new_qty::numeric);
      v_batches := COALESCE(v_consume->'batches', '[]'::jsonb);
      v_unit_cost := COALESCE((v_consume->>'weighted_unit_cost')::numeric, v_unit_cost);
      IF jsonb_array_length(v_batches) = 1 THEN v_single_batch := NULLIF(v_batches->0->>'batch_id','')::uuid; END IF;
      UPDATE public.products SET quantity = quantity - v_new_qty WHERE id = v_pid;
    END IF;
    v_orig_cost := v_unit_cost;
    INSERT INTO public.invoice_items(invoice_id, product_id, product_name, quantity, cost_price, selling_price, market_price, line_discount, total, tenant_id, unit_cost_at_sale, batch_id, batches_consumed, original_unit_cost)
    VALUES (_invoice_id, v_pid, it->>'product_name', v_new_qty, v_unit_cost,
      COALESCE((it->>'selling_price')::numeric, 0), COALESCE((it->>'market_price')::numeric, 0),
      COALESCE((it->>'line_discount')::numeric, 0),
      (COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty) - COALESCE((it->>'line_discount')::numeric, 0),
      inv.tenant_id, v_unit_cost, v_single_batch, v_batches, v_orig_cost);
    v_subtotal := v_subtotal + (COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty);
    v_total := v_total + ((COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty) - COALESCE((it->>'line_discount')::numeric, 0));
  END LOOP;
  v_disc_amount := COALESCE(_discount_amount, inv.discount_amount, 0);
  IF v_disc_amount < 0 THEN v_disc_amount := 0; END IF;
  IF v_disc_amount > v_total THEN v_disc_amount := v_total; END IF;
  v_total := GREATEST(v_total - v_disc_amount, 0);
  v_vat_rate := COALESCE(_vat_rate, inv.vat_rate, 0);
  IF v_vat_rate < 0 THEN v_vat_rate := 0; END IF;
  v_vat_amount := ROUND(v_total * v_vat_rate / 100.0, 2);
  v_total := v_total + v_vat_amount;
  UPDATE public.invoices SET contact_id = _customer_id, subtotal = v_subtotal, total = v_total,
    vat_rate = v_vat_rate, vat_amount = v_vat_amount, discount_amount = v_disc_amount
   WHERE id = _invoice_id;
  UPDATE public.treasury SET amount = v_total, description = 'تعديل فاتورة ' || inv.invoice_number
   WHERE reference_id = _invoice_id AND type = 'income';
END;
$function$;

-- Bug 3
CREATE OR REPLACE FUNCTION public.record_contact_payment(p_contact_id uuid, p_branch_id uuid, p_direction text, p_amount numeric, p_payment_method text, p_reference_number text, p_transfer_to_account text, p_received_by_name text, p_fee_amount numeric, p_fee_type text, p_fee_on_customer boolean, p_notes text DEFAULT NULL::text, p_transfer_from_account text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_uid uuid := auth.uid(); v_total_with_fee numeric;
  v_tx_id uuid; v_treasury_id uuid; v_fee_treasury_id uuid;
  v_contact record; v_remaining numeric; v_plan record; v_inst record;
  v_alloc numeric; v_inst_alloc numeric; v_plan_remaining numeric; v_inst_remaining numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  PERFORM public._validate_transfer_payment(p_payment_method, p_reference_number, p_transfer_from_account, p_transfer_to_account);
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
  RETURN v_tx_id;
END;
$function$;

-- Bug 4
CREATE OR REPLACE FUNCTION public.record_payment_transaction(p_payment_plan_id uuid, p_installment_id uuid, p_amount numeric, p_payment_method text, p_reference_number text, p_transfer_to_account text, p_received_by_name text, p_fee_amount numeric, p_fee_type text, p_fee_on_customer boolean, p_direction text, p_transfer_from_account text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tx_id uuid; v_treasury_id uuid; v_fee_treasury_id uuid;
  v_branch uuid; v_tenant uuid; v_plan record; v_installment record;
  v_total_with_fee numeric; v_uid uuid := auth.uid(); v_contact_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  PERFORM public._validate_transfer_payment(p_payment_method, p_reference_number, p_transfer_from_account, p_transfer_to_account);
  IF p_payment_plan_id IS NULL THEN RAISE EXCEPTION 'payment_plan_id required'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_direction NOT IN ('in','out') THEN RAISE EXCEPTION 'direction must be in/out'; END IF;

  SELECT * INTO v_plan FROM payment_plans WHERE id = p_payment_plan_id;
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

  IF p_installment_id IS NOT NULL THEN
    SELECT * INTO v_installment FROM payment_installments WHERE id = p_installment_id;
    UPDATE payment_installments SET
      paid_amount = COALESCE(paid_amount,0) + p_amount,
      paid_at = CASE WHEN COALESCE(paid_amount,0) + p_amount >= amount THEN now() ELSE paid_at END,
      status = CASE WHEN COALESCE(paid_amount,0) + p_amount >= amount THEN 'paid' ELSE 'pending' END,
      updated_at = now()
    WHERE id = p_installment_id;
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

-- Bug 5: price_audit_log RLS lockdown
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='price_audit_log' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.price_audit_log', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "tenant select price_audit_log"
ON public.price_audit_log FOR SELECT TO authenticated
USING (tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY "tenant insert price_audit_log"
ON public.price_audit_log FOR INSERT TO authenticated
WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "admin update price_audit_log"
ON public.price_audit_log FOR UPDATE TO authenticated
USING (tenant_id = public.current_tenant_id() AND (public.has_role(auth.uid(),'admin'::app_role) OR public.is_super_admin(auth.uid())))
WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "admin delete price_audit_log"
ON public.price_audit_log FOR DELETE TO authenticated
USING (tenant_id = public.current_tenant_id() AND (public.has_role(auth.uid(),'admin'::app_role) OR public.is_super_admin(auth.uid())));

-- Bug 7: system-backups storage read scoped to tenant folder
DROP POLICY IF EXISTS "backup_files_read_admin" ON storage.objects;

CREATE POLICY "tenant backup files read admin"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'system-backups'
  AND (
    public.is_super_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'admin'::app_role)
      AND split_part(name, '/', 1) = (public.current_tenant_id())::text
    )
  )
);
