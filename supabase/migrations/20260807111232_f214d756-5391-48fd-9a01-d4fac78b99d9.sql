CREATE OR REPLACE FUNCTION public.create_product_with_opening_stock(p_product jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_branch uuid := (p_product->>'branch_id')::uuid;
  v_tenant uuid;
  v_qty int := COALESCE((p_product->>'quantity')::int, 0);
  v_cost numeric := COALESCE((p_product->>'cost_price')::numeric, 0);
  v_new_id uuid;
  v_value numeric;
  v_inv uuid; v_eq uuid; v_entry uuid; v_num text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'الفرع مطلوب'; END IF;
  IF v_qty < 0 THEN RAISE EXCEPTION 'الكمية لا يمكن أن تكون سالبة'; END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = v_branch;

  INSERT INTO public.products(
    tenant_id, branch_id, name, sku, category_id,
    cost_price, selling_price, market_price,
    low_stock_alert, quantity, image,
    brand, model, color, product_type, capacity, size
  ) VALUES (
    v_tenant, v_branch,
    p_product->>'name',
    p_product->>'sku',
    NULLIF(p_product->>'category_id','')::uuid,
    v_cost,
    COALESCE((p_product->>'selling_price')::numeric, 0),
    COALESCE((p_product->>'market_price')::numeric, 0),
    COALESCE((p_product->>'low_stock_alert')::int, 5),
    v_qty,
    NULLIF(p_product->>'image',''),
    NULLIF(btrim(p_product->>'brand'),''),
    NULLIF(btrim(p_product->>'model'),''),
    NULLIF(btrim(p_product->>'color'),''),
    NULLIF(btrim(p_product->>'product_type'),''),
    NULLIF(btrim(p_product->>'capacity'),''),
    NULLIF(btrim(p_product->>'size'),'')
  ) RETURNING id INTO v_new_id;

  IF v_qty > 0 THEN
    INSERT INTO public.product_batches(
      tenant_id, branch_id, product_id,
      quantity_purchased, quantity_remaining,
      cost_price, base_purchase_price, true_unit_cost,
      batch_type
    ) VALUES (
      v_tenant, v_branch, v_new_id,
      v_qty, v_qty,
      v_cost, v_cost, v_cost,
      'opening_stock'
    );

    -- Opening stock must hit the GL, otherwise Inventory (1300) goes negative
    -- once COGS starts crediting it.
    v_value := ROUND(v_qty * v_cost, 2);
    IF v_value > 0 THEN
      SELECT id INTO v_inv FROM public.chart_of_accounts WHERE tenant_id=v_tenant AND code='1300' LIMIT 1;
      SELECT id INTO v_eq  FROM public.chart_of_accounts WHERE tenant_id=v_tenant AND code='3800' LIMIT 1;
      IF v_inv IS NOT NULL AND v_eq IS NOT NULL THEN
        v_num := 'OPS-'||to_char(CURRENT_DATE,'YYYYMMDD')||'-'||substring(v_new_id::text,1,6);
        INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description,
          source_type, source_id, status, total_debit, total_credit, created_by)
        VALUES (v_tenant, v_num, CURRENT_DATE,
          'رصيد مخزون افتتاحي — '||COALESCE(p_product->>'name',''),
          'opening_stock', v_new_id, 'posted', v_value, v_value, v_user)
        RETURNING id INTO v_entry;
        INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
        VALUES (v_tenant, v_entry, v_inv, v_value, 0, 'مخزون افتتاحي', 1),
               (v_tenant, v_entry, v_eq, 0, v_value, 'رأس مال / أرباح مرحلة', 2);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'product_id', v_new_id,
    'opening_batch', v_qty > 0,
    'cost_warning', v_qty > 0 AND v_cost <= 0
  );
END;
$function$;