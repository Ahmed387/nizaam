-- Remove off-stock sales feature: drop column + simplify RPCs

-- 1) Recreate process_sale without off-stock branch
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
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_total < 0 OR p_subtotal < 0 THEN RAISE EXCEPTION 'مبالغ غير صحيحة'; END IF;
  IF NOT public.user_in_branch(v_user, p_branch_id) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على هذا الفرع';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_branch_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::int;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
    v_pid := (v_item->>'product_id')::uuid;
    IF v_pid IS NULL THEN RAISE EXCEPTION 'منتج غير محدد'; END IF;

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
    v_qty := (v_item->>'quantity')::int;
    v_pid := (v_item->>'product_id')::uuid;

    INSERT INTO public.invoice_items(
      invoice_id, product_id, product_name, quantity,
      cost_price, selling_price, market_price, total, tenant_id,
      price_list_item_id, price_list_cost
    ) VALUES (
      v_invoice_id, v_pid, v_item->>'product_name', v_qty,
      COALESCE((v_item->>'cost_price')::numeric, 0),
      COALESCE((v_item->>'selling_price')::numeric, 0),
      COALESCE((v_item->>'market_price')::numeric, 0),
      v_qty * COALESCE((v_item->>'selling_price')::numeric, 0),
      v_tenant,
      NULLIF(v_item->>'price_list_item_id','')::uuid,
      NULL
    );

    UPDATE public.products SET quantity = quantity - v_qty WHERE id = v_pid;
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

-- 2) Recreate complete_pre_order_sale without is_off_stock column
CREATE OR REPLACE FUNCTION public.complete_pre_order_sale(
  p_pre_order_id uuid,
  p_payment_method text DEFAULT 'cash'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_po public.pre_orders%ROWTYPE;
  v_pid uuid;
  v_current int;
  v_qty_sell int;
  v_unit_price numeric;
  v_cost numeric := 0;
  v_subtotal numeric;
  v_remaining numeric;
  v_invoice_id uuid;
  v_invoice_number text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  SELECT * INTO v_po FROM public.pre_orders WHERE id = p_pre_order_id FOR UPDATE;
  IF v_po.id IS NULL THEN RAISE EXCEPTION 'الحجز غير موجود'; END IF;
  IF v_po.status NOT IN ('pending','received') THEN RAISE EXCEPTION 'هذا الحجز غير قابل للإتمام'; END IF;
  IF NOT public.user_in_branch(v_user, v_po.branch_id) THEN RAISE EXCEPTION 'لا تملك صلاحية'; END IF;

  v_tenant := v_po.tenant_id;
  v_unit_price := COALESCE(v_po.expected_price, 0);

  SELECT id, quantity, cost_price INTO v_pid, v_current, v_cost
    FROM public.products
    WHERE branch_id = v_po.branch_id
      AND lower(name) = lower(v_po.product_name)
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE;

  IF v_pid IS NULL OR v_current IS NULL OR v_current <= 0 THEN
    RAISE EXCEPTION 'المنتج غير متاح في المخزون حالياً';
  END IF;

  v_qty_sell := LEAST(v_current, v_po.quantity);
  v_unit_price := COALESCE(NULLIF(v_po.expected_price,0), v_unit_price);
  v_subtotal := v_unit_price * v_qty_sell;
  v_remaining := GREATEST(0, v_subtotal - COALESCE(v_po.deposit_amount,0));

  v_invoice_number := public.next_invoice_number();

  INSERT INTO public.invoices(
    invoice_number, branch_id, customer_id, cashier_id,
    subtotal, discount_amount, discount_percent, discount_reason,
    total, payment_method, tenant_id
  ) VALUES (
    v_invoice_number, v_po.branch_id, v_po.customer_id, v_user,
    v_subtotal, COALESCE(v_po.deposit_amount,0), 0,
    'خصم عربون حجز ' || v_po.order_number,
    v_remaining, COALESCE(p_payment_method,'cash'), v_tenant
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items(
    invoice_id, product_id, product_name, quantity,
    cost_price, selling_price, market_price, total, tenant_id,
    price_list_item_id, price_list_cost
  ) VALUES (
    v_invoice_id, v_pid, v_po.product_name, v_qty_sell,
    v_cost, v_unit_price, 0,
    v_subtotal, v_tenant,
    v_po.price_list_item_id, NULL
  );

  UPDATE public.products SET quantity = quantity - v_qty_sell WHERE id = v_pid;

  IF v_remaining > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id)
    VALUES (v_po.branch_id, 'income', 'sales', v_remaining,
            'فاتورة ' || v_invoice_number || ' — متبقي حجز ' || v_po.order_number,
            v_invoice_id, v_user, v_tenant);
  END IF;

  INSERT INTO public.pre_order_transactions(
    pre_order_id, tenant_id, branch_id, type, amount, payment_method, treasury_id, created_by
  ) VALUES (
    p_pre_order_id, v_tenant, v_po.branch_id, 'final_payment', v_remaining,
    COALESCE(p_payment_method,'cash'), NULL, v_user
  );

  IF v_qty_sell >= v_po.quantity THEN
    UPDATE public.pre_orders SET status='completed', invoice_id=v_invoice_id, updated_at=now() WHERE id=p_pre_order_id;
  ELSE
    UPDATE public.pre_orders SET quantity = v_po.quantity - v_qty_sell, updated_at=now() WHERE id=p_pre_order_id;
  END IF;

  RETURN v_invoice_id;
END;
$$;

-- 3) Drop the column now that no function references it
ALTER TABLE public.invoice_items DROP COLUMN IF EXISTS is_off_stock;