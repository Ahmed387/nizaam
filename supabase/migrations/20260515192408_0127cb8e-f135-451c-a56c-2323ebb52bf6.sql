
CREATE OR REPLACE FUNCTION public.process_sale(
  p_branch_id uuid,
  p_customer_id uuid,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_discount_percent numeric,
  p_discount_reason text,
  p_total numeric,
  p_payment_method text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_item jsonb;
  v_pid uuid;
  v_qty int;
  v_current int;
  v_off boolean;
  v_pli_id uuid;
  v_pli_cost numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_total < 0 OR p_subtotal < 0 THEN RAISE EXCEPTION 'مبالغ غير صحيحة'; END IF;
  IF NOT public.user_in_branch(v_user, p_branch_id) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على هذا الفرع';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_branch_id;

  -- Lock & validate stock for in-stock items only
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_off := COALESCE((v_item->>'is_off_stock')::boolean, false);
    v_qty := (v_item->>'quantity')::int;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
    IF v_off THEN CONTINUE; END IF;

    v_pid := (v_item->>'product_id')::uuid;
    SELECT quantity INTO v_current
      FROM public.products
      WHERE id = v_pid AND branch_id = p_branch_id
      FOR UPDATE;

    IF v_current IS NULL THEN RAISE EXCEPTION 'منتج غير موجود في هذا الفرع'; END IF;
    IF v_current < v_qty THEN RAISE EXCEPTION 'الكمية المتاحة غير كافية (متاح: %)', v_current; END IF;
  END LOOP;

  v_invoice_number := public.next_invoice_number();

  INSERT INTO public.invoices(
    invoice_number, branch_id, customer_id, cashier_id,
    subtotal, discount_amount, discount_percent, discount_reason,
    total, payment_method, tenant_id
  ) VALUES (
    v_invoice_number, p_branch_id, p_customer_id, v_user,
    p_subtotal, p_discount_amount, p_discount_percent, p_discount_reason,
    p_total, COALESCE(p_payment_method, 'cash'), v_tenant
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_off := COALESCE((v_item->>'is_off_stock')::boolean, false);
    v_qty := (v_item->>'quantity')::int;
    v_pli_id := NULLIF(v_item->>'price_list_item_id','')::uuid;
    v_pli_cost := NULL;

    -- Snapshot cost from price list (admin/accountant only see this; SECURITY DEFINER bypasses RLS)
    IF v_pli_id IS NOT NULL THEN
      SELECT cost_price INTO v_pli_cost FROM public.price_list_items WHERE id = v_pli_id AND tenant_id = v_tenant;
    END IF;

    IF v_off THEN
      v_pid := NULL;
    ELSE
      v_pid := (v_item->>'product_id')::uuid;
    END IF;

    INSERT INTO public.invoice_items(
      invoice_id, product_id, product_name, quantity,
      cost_price, selling_price, market_price, total, tenant_id,
      is_off_stock, price_list_item_id, price_list_cost
    ) VALUES (
      v_invoice_id, v_pid, v_item->>'product_name', v_qty,
      COALESCE((v_item->>'cost_price')::numeric, COALESCE(v_pli_cost, 0)),
      COALESCE((v_item->>'selling_price')::numeric, 0),
      COALESCE((v_item->>'market_price')::numeric, 0),
      v_qty * COALESCE((v_item->>'selling_price')::numeric, 0),
      v_tenant,
      v_off, v_pli_id, v_pli_cost
    );

    IF NOT v_off AND v_pid IS NOT NULL THEN
      UPDATE public.products SET quantity = quantity - v_qty WHERE id = v_pid;
    END IF;
  END LOOP;

  IF p_total > 0 THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      reference_id, created_by, tenant_id
    ) VALUES (
      p_branch_id, 'income', 'sales', p_total,
      'فاتورة ' || v_invoice_number, v_invoice_id, v_user, v_tenant
    );
  END IF;

  RETURN v_invoice_id;
END;
$$;
