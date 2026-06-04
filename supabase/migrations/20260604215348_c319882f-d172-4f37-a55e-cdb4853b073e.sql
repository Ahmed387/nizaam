
-- process_sale: rename column in INSERT
CREATE OR REPLACE FUNCTION public.process_sale(
  p_branch_id uuid, p_customer_id uuid, p_subtotal numeric, p_discount_amount numeric,
  p_discount_percent numeric, p_discount_reason text, p_total numeric, p_payment_method text,
  p_items jsonb, p_payments jsonb DEFAULT NULL::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_user_name text;
  v_tenant uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_item jsonb;
  v_pay jsonb;
  v_pid uuid;
  v_qty int;
  v_current int;
  v_sp numeric;
  v_cp numeric;
  v_ld numeric;
  v_eff_unit numeric;
  v_pay_sum numeric := 0;
  v_line_total numeric;
  v_fee numeric;
  v_fee_on_cust boolean;
  v_pm text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_total < 0 OR p_subtotal < 0 THEN RAISE EXCEPTION 'مبالغ غير صحيحة'; END IF;
  IF NOT public.user_in_branch(v_user, p_branch_id) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على هذا الفرع';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_branch_id;
  SELECT name INTO v_user_name FROM public.profiles WHERE id = v_user;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::int;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
    v_pid := (v_item->>'product_id')::uuid;
    IF v_pid IS NULL THEN RAISE EXCEPTION 'منتج غير محدد'; END IF;
    v_sp := COALESCE((v_item->>'selling_price')::numeric, 0);
    v_cp := COALESCE((v_item->>'cost_price')::numeric, 0);
    v_ld := COALESCE((v_item->>'line_discount')::numeric, 0);
    IF v_ld < 0 THEN RAISE EXCEPTION 'خصم غير صحيح'; END IF;

    SELECT quantity INTO v_current FROM public.products WHERE id = v_pid AND branch_id = p_branch_id FOR UPDATE;
    IF v_current IS NULL THEN RAISE EXCEPTION 'منتج غير موجود في هذا الفرع'; END IF;
    IF v_current < v_qty THEN RAISE EXCEPTION 'الكمية المتاحة غير كافية (متاح: %)', v_current; END IF;

    v_line_total := v_qty * v_sp - v_ld;
    IF v_line_total < 0 THEN RAISE EXCEPTION 'إجمالي السطر سالب'; END IF;
    IF v_cp > 0 THEN
      v_eff_unit := v_line_total / v_qty;
      IF v_eff_unit < v_cp THEN
        RAISE EXCEPTION 'لا يمكن البيع بأقل من سعر التكلفة للمنتج: %', v_item->>'product_name';
      END IF;
    END IF;
  END LOOP;

  IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
    FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
      v_pay_sum := v_pay_sum + COALESCE((v_pay->>'amount')::numeric, 0);
    END LOOP;
    IF v_pay_sum > p_total + 0.01 THEN
      RAISE EXCEPTION 'مجموع طرق الدفع (%) أكبر من إجمالي الفاتورة (%)', v_pay_sum, p_total;
    END IF;
  END IF;

  v_invoice_number := public.next_invoice_number();

  INSERT INTO public.invoices(
    invoice_number, branch_id, contact_id, cashier_id,
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
    v_sp := COALESCE((v_item->>'selling_price')::numeric, 0);
    v_ld := COALESCE((v_item->>'line_discount')::numeric, 0);

    INSERT INTO public.invoice_items(
      invoice_id, product_id, product_name, quantity,
      cost_price, selling_price, market_price, total, tenant_id,
      price_list_item_id, price_list_cost, line_discount
    ) VALUES (
      v_invoice_id, v_pid, v_item->>'product_name', v_qty,
      COALESCE((v_item->>'cost_price')::numeric, 0), v_sp,
      COALESCE((v_item->>'market_price')::numeric, 0),
      v_qty * v_sp - v_ld, v_tenant,
      NULLIF(v_item->>'price_list_item_id','')::uuid, NULL, v_ld
    );
    UPDATE public.products SET quantity = quantity - v_qty WHERE id = v_pid;
  END LOOP;

  IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
    FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
      v_pm := COALESCE(v_pay->>'payment_method', 'cash');
      v_fee := COALESCE((v_pay->>'fee_amount')::numeric, 0);
      v_fee_on_cust := COALESCE((v_pay->>'fee_on_customer')::boolean, false);

      INSERT INTO public.invoice_payments(
        invoice_id, tenant_id, branch_id,
        payment_method, amount, reference_number, received_by_name, transfer_to_account,
        fee_amount, fee_on_customer
      ) VALUES (
        v_invoice_id, v_tenant, p_branch_id,
        v_pm, (v_pay->>'amount')::numeric,
        NULLIF(v_pay->>'reference_number',''),
        COALESCE(NULLIF(v_pay->>'received_by_name',''), v_user_name),
        NULLIF(v_pay->>'transfer_to_account',''),
        v_fee, v_fee_on_cust
      );

      IF v_fee > 0 AND NOT v_fee_on_cust THEN
        INSERT INTO public.expenses(
          branch_id, type, amount, description, date,
          payment_method, reference_number, is_fee, created_by, tenant_id
        ) VALUES (
          p_branch_id, 'عمولة تحويل', v_fee,
          'عمولة ' || v_pm || ' — فاتورة ' || v_invoice_number,
          CURRENT_DATE, v_pm, NULLIF(v_pay->>'reference_number',''),
          true, v_user, v_tenant
        );
      END IF;
    END LOOP;
  END IF;

  IF v_pay_sum > 0 THEN
    INSERT INTO public.treasury(
      branch_id, type, category, amount, description,
      reference_id, created_by, tenant_id
    ) VALUES (
      p_branch_id, 'income', 'sales', v_pay_sum,
      'فاتورة ' || v_invoice_number, v_invoice_id, v_user, v_tenant
    );
  ELSIF p_payments IS NULL AND p_total > 0 THEN
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
$function$;

-- edit_invoice
CREATE OR REPLACE FUNCTION public.edit_invoice(_invoice_id uuid, _customer_id uuid, _items jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  inv record; uid uuid := auth.uid(); is_adm boolean; is_bm boolean;
  it jsonb; v_old_qty int; v_new_qty int; v_pid uuid;
  v_subtotal numeric := 0; v_total numeric := 0; v_disc_amount numeric;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF inv.status <> 'active' THEN RAISE EXCEPTION 'لا يمكن تعديل فاتورة ملغاة'; END IF;

  SELECT has_role(uid, 'admin'::app_role) INTO is_adm;
  SELECT has_role(uid, 'branch_manager'::app_role) INTO is_bm;
  IF NOT (is_adm OR is_bm OR is_super_admin(uid)) THEN
    RAISE EXCEPTION 'غير مصرح بتعديل الفاتورة — مدير الفرع أو الأدمن فقط';
  END IF;

  FOR v_pid, v_old_qty IN
    SELECT product_id, quantity FROM public.invoice_items WHERE invoice_id = _invoice_id
  LOOP
    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET quantity = quantity + v_old_qty WHERE id = v_pid;
    END IF;
  END LOOP;

  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_pid := NULLIF((it->>'product_id'), '')::uuid;
    v_new_qty := COALESCE((it->>'quantity')::int, 0);
    IF v_new_qty <= 0 THEN CONTINUE; END IF;

    INSERT INTO public.invoice_items(
      invoice_id, product_id, product_name, quantity,
      cost_price, selling_price, market_price, line_discount, total, tenant_id
    ) VALUES (
      _invoice_id, v_pid, it->>'product_name', v_new_qty,
      COALESCE((it->>'cost_price')::numeric, 0),
      COALESCE((it->>'selling_price')::numeric, 0),
      COALESCE((it->>'market_price')::numeric, 0),
      COALESCE((it->>'line_discount')::numeric, 0),
      (COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty) - COALESCE((it->>'line_discount')::numeric, 0),
      inv.tenant_id
    );

    IF v_pid IS NOT NULL THEN
      UPDATE public.products SET quantity = quantity - v_new_qty WHERE id = v_pid;
    END IF;

    v_subtotal := v_subtotal + (COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty);
    v_total := v_total + ((COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty) - COALESCE((it->>'line_discount')::numeric, 0));
  END LOOP;

  v_disc_amount := COALESCE(inv.discount_amount, 0);
  v_total := GREATEST(v_total - v_disc_amount, 0);

  UPDATE public.invoices
     SET contact_id = _customer_id, subtotal = v_subtotal, total = v_total
   WHERE id = _invoice_id;

  UPDATE public.treasury
     SET amount = v_total, description = 'تعديل فاتورة ' || inv.invoice_number
   WHERE reference_id = _invoice_id AND type = 'income';
END;
$function$;

-- create_pre_order
CREATE OR REPLACE FUNCTION public.create_pre_order(
  p_branch_id uuid, p_customer_id uuid, p_customer_name text, p_customer_phone text,
  p_price_list_item_id uuid, p_product_name text, p_model_code text,
  p_quantity integer, p_expected_price numeric, p_deposit_amount numeric,
  p_payment_method text, p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid; v_name text; v_id uuid; v_treasury_id uuid; v_admin uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT user_in_branch(v_user, p_branch_id) THEN RAISE EXCEPTION 'لا تملك صلاحية على هذا الفرع'; END IF;
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;
  IF COALESCE(p_deposit_amount,0) < 0 THEN RAISE EXCEPTION 'مبلغ عربون غير صحيح'; END IF;
  IF COALESCE(p_deposit_amount,0) > COALESCE(p_expected_price,0) * p_quantity THEN
    RAISE EXCEPTION 'العربون أكبر من السعر الإجمالي';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_branch_id;
  SELECT name INTO v_name FROM public.profiles WHERE id = v_user;

  INSERT INTO public.pre_orders(
    tenant_id, branch_id, contact_id, customer_name, customer_phone,
    price_list_item_id, product_name, model_code, quantity, expected_price,
    deposit_amount, notes, created_by, created_by_name
  ) VALUES (
    v_tenant, p_branch_id, p_customer_id, p_customer_name, p_customer_phone,
    p_price_list_item_id, p_product_name, p_model_code, p_quantity, p_expected_price,
    COALESCE(p_deposit_amount,0), p_notes, v_user, COALESCE(v_name,'cashier')
  ) RETURNING id INTO v_id;

  IF COALESCE(p_deposit_amount,0) > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id)
    VALUES (p_branch_id, 'income', 'pre_order_deposit', p_deposit_amount,
            'عربون حجز ' || (SELECT order_number FROM public.pre_orders WHERE id = v_id),
            v_id, v_user, v_tenant)
    RETURNING id INTO v_treasury_id;

    INSERT INTO public.pre_order_transactions(
      pre_order_id, tenant_id, branch_id, type, amount, payment_method, treasury_id, created_by
    ) VALUES (v_id, v_tenant, p_branch_id, 'deposit_received', p_deposit_amount,
              COALESCE(p_payment_method,'cash'), v_treasury_id, v_user);
  END IF;

  FOR v_admin IN
    SELECT ur.user_id FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'admin' AND p.tenant_id = v_tenant
  LOOP
    INSERT INTO public.notifications(user_id, tenant_id, title, body, type, related_entity, related_entity_id, link)
    VALUES (v_admin, v_tenant, '📝 حجز جديد',
            p_product_name || ' — ' || p_customer_name,
            'pre_order_new', 'pre_order', v_id,
            '/branch/' || p_branch_id || '/pre-orders');
  END LOOP;

  RETURN v_id;
END;
$function$;

-- complete_pre_order_sale: rename column ref
CREATE OR REPLACE FUNCTION public.complete_pre_order_sale(p_pre_order_id uuid, p_payment_method text DEFAULT 'cash'::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_user uuid := auth.uid(); v_tenant uuid; v_po public.pre_orders%ROWTYPE;
  v_pid uuid; v_current int; v_qty_sell int; v_unit_price numeric; v_cost numeric := 0;
  v_subtotal numeric; v_remaining numeric; v_invoice_id uuid; v_invoice_number text;
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
    WHERE branch_id = v_po.branch_id AND lower(name) = lower(v_po.product_name)
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE;

  IF v_pid IS NULL OR v_current IS NULL OR v_current <= 0 THEN
    RAISE EXCEPTION 'المنتج غير متاح في المخزون حالياً';
  END IF;

  v_qty_sell := LEAST(v_current, v_po.quantity);
  v_unit_price := COALESCE(NULLIF(v_po.expected_price,0), v_unit_price);
  v_subtotal := v_unit_price * v_qty_sell;
  v_remaining := GREATEST(0, v_subtotal - COALESCE(v_po.deposit_amount,0));

  v_invoice_number := public.next_invoice_number();

  INSERT INTO public.invoices(
    invoice_number, branch_id, contact_id, cashier_id,
    subtotal, discount_amount, discount_percent, discount_reason,
    total, payment_method, tenant_id
  ) VALUES (
    v_invoice_number, v_po.branch_id, v_po.contact_id, v_user,
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
$function$;
