
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
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'الفرع مطلوب'; END IF;
  IF v_qty < 0 THEN RAISE EXCEPTION 'الكمية لا يمكن أن تكون سالبة'; END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = v_branch;

  INSERT INTO public.products(
    tenant_id, branch_id, name, sku, category_id,
    cost_price, selling_price, market_price,
    low_stock_alert, quantity, image
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
    NULLIF(p_product->>'image','')
  ) RETURNING id INTO v_new_id;

  -- Opening stock batch
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
  END IF;

  RETURN jsonb_build_object(
    'product_id', v_new_id,
    'opening_batch', v_qty > 0,
    'cost_warning', v_qty > 0 AND v_cost <= 0
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_product_with_opening_stock(jsonb) TO authenticated;
