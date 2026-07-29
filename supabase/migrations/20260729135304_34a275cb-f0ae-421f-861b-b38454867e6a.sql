
-- Helper: reverse old invoice journals then recreate sales + COGS journals
CREATE OR REPLACE FUNCTION public.repost_invoice_journal(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
  v_net NUMERIC(18,2);
  v_lines JSONB;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND OR inv.status <> 'active' THEN
    RETURN;
  END IF;

  -- 1) Reverse existing sales journal for this invoice (if any)
  PERFORM public.reverse_journal_for_source(
    inv.tenant_id, 'invoice', inv.id,
    'Invoice '||inv.invoice_number||' edited — reversing old GL'
  );

  -- 2) Recreate sales journal with the new totals (mirrors trg_invoice_journal INSERT path)
  v_net := COALESCE(inv.subtotal,0) - COALESCE(inv.discount_amount,0);
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','1200','debit', inv.total, 'credit', 0, 'description','Invoice '||inv.invoice_number||' (edited)'),
    jsonb_build_object('account_code','4100','debit', 0, 'credit', v_net, 'description','Sales revenue (edited)'),
    jsonb_build_object('account_code','2200','debit', 0, 'credit', COALESCE(inv.vat_amount,0), 'description','VAT payable (edited)')
  );
  PERFORM public.post_journal(
    inv.tenant_id, inv.invoice_date,
    'Sale Invoice '||inv.invoice_number||' (edited)',
    'invoice', inv.id, v_lines
  );

  -- 3) Rebuild COGS journal (post_invoice_cogs already deletes+recreates)
  PERFORM public.post_invoice_cogs(inv.id);
END;
$$;

-- Overload 1: edit_invoice(_invoice_id, _customer_id, _items)
CREATE OR REPLACE FUNCTION public.edit_invoice(_invoice_id uuid, _customer_id uuid, _items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  PERFORM public.repost_invoice_journal(_invoice_id);
END;
$function$;

-- Overload 2: edit_invoice(_invoice_id, _customer_id, _items, _vat_rate)
CREATE OR REPLACE FUNCTION public.edit_invoice(_invoice_id uuid, _customer_id uuid, _items jsonb, _vat_rate numeric DEFAULT NULL::numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  PERFORM public.repost_invoice_journal(_invoice_id);
END;
$function$;

-- Overload 3: edit_invoice(_invoice_id, _customer_id, _items, _vat_rate, _discount_amount)
CREATE OR REPLACE FUNCTION public.edit_invoice(_invoice_id uuid, _customer_id uuid, _items jsonb, _vat_rate numeric DEFAULT NULL::numeric, _discount_amount numeric DEFAULT NULL::numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_total := GREATEST(v_total - v_disc_amount, 0);
  v_vat_rate := COALESCE(_vat_rate, inv.vat_rate, 0);
  IF v_vat_rate < 0 THEN v_vat_rate := 0; END IF;
  v_vat_amount := ROUND(v_total * v_vat_rate / 100.0, 2);
  v_total := v_total + v_vat_amount;
  UPDATE public.invoices SET contact_id = _customer_id, subtotal = v_subtotal, total = v_total,
    discount_amount = v_disc_amount, vat_rate = v_vat_rate, vat_amount = v_vat_amount WHERE id = _invoice_id;
  UPDATE public.treasury SET amount = v_total, description = 'تعديل فاتورة ' || inv.invoice_number
   WHERE reference_id = _invoice_id AND type = 'income';

  PERFORM public.repost_invoice_journal(_invoice_id);
END;
$function$;
