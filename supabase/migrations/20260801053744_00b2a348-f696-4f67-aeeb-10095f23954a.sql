DROP FUNCTION IF EXISTS public.record_shipment(jsonb, jsonb);

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
  END IF;

  RETURN jsonb_build_object(
    'product_id', v_new_id,
    'opening_batch', v_qty > 0,
    'cost_warning', v_qty > 0 AND v_cost <= 0
  );
END;
$function$;

-- patch edit_shipment's new-product insert to carry variant attributes
DO $do$
DECLARE
  v_src text;
  v_old text := 'INSERT INTO products(branch_id, tenant_id, name, sku, cost_price, selling_price, market_price, quantity, image)
      VALUES (v_branch, v_tenant, v_name, v_sku, v_cost, v_cost*1.3, v_cost*1.3, 0, v_image)';
  v_new text := 'INSERT INTO products(branch_id, tenant_id, name, sku, cost_price, selling_price, market_price, quantity, image,
                           brand, model, color, product_type, capacity, size)
      VALUES (v_branch, v_tenant, v_name, v_sku, v_cost, v_cost*1.3, v_cost*1.3, 0, v_image,
              NULLIF(btrim(v_new->>''brand''),''''), NULLIF(btrim(v_new->>''model''),''''),
              NULLIF(btrim(v_new->>''color''),''''), NULLIF(btrim(v_new->>''product_type''),''''),
              NULLIF(btrim(v_new->>''capacity''),''''), NULLIF(btrim(v_new->>''size''),'''')) ';
BEGIN
  v_src := pg_get_functiondef('public.edit_shipment(uuid,jsonb,jsonb)'::regprocedure);
  IF position(v_old in v_src) = 0 THEN
    RAISE EXCEPTION 'edit_shipment source pattern not found';
  END IF;
  v_src := replace(v_src, v_old, v_new);
  EXECUTE v_src;
END
$do$;