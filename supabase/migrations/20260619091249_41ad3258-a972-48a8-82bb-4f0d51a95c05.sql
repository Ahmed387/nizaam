
CREATE OR REPLACE FUNCTION public.record_shipment(p_header jsonb, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_branch uuid := (p_header->>'branch_id')::uuid;
  v_tenant uuid;
  v_contact uuid := NULLIF(p_header->>'contact_id','')::uuid;
  v_shipping numeric := COALESCE((p_header->>'shipping_cost')::numeric, 0);
  v_customs  numeric := COALESCE((p_header->>'customs_cost')::numeric, 0);
  v_other    numeric := COALESCE((p_header->>'other_cost')::numeric, 0);
  v_admin    numeric := COALESCE((p_header->>'admin_cost')::numeric, 0);
  v_extras   numeric;
  v_items_net numeric := 0;
  v_ship_id uuid;
  ln jsonb; v_pid uuid; v_qty int; v_cost numeric;
  v_disc_pct numeric; v_disc_amt numeric; v_net numeric; v_net_unit numeric;
  v_name text; v_sku text; v_image text;
  v_total numeric;
  v_it record; v_share numeric; v_unit_extra numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'فرع غير محدد'; END IF;
  IF jsonb_array_length(p_lines) = 0 THEN RAISE EXCEPTION 'لا توجد أصناف'; END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = v_branch;
  v_extras := v_shipping + v_customs + v_other;

  INSERT INTO public.shipments(
    tenant_id, branch_id, contact_id, arrival_date, received_by,
    shipping_cost, customs_cost, other_cost, other_cost_description,
    total_extra_costs, admin_cost, total_cost, notes
  ) VALUES (
    v_tenant, v_branch, v_contact,
    COALESCE((p_header->>'arrival_date')::date, CURRENT_DATE),
    NULLIF(p_header->>'received_by',''),
    v_shipping, v_customs, v_other, NULLIF(p_header->>'other_cost_description',''),
    v_extras, v_admin, 0,
    NULLIF(p_header->>'notes','')
  ) RETURNING id INTO v_ship_id;

  -- Pass 1: insert items + create products if needed + create batches + bump quantity
  FOR ln IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_pid := NULLIF(ln->>'product_id','')::uuid;
    v_qty := (ln->>'quantity')::int;
    v_cost := (ln->>'cost_price')::numeric;
    v_disc_pct := COALESCE((ln->>'discount_percent')::numeric, 0);
    v_disc_amt := COALESCE((ln->>'discount_amount')::numeric, 0);
    v_name := ln->>'product_name';
    v_image := NULLIF(ln->>'image','');
    v_net := GREATEST(0, v_qty*v_cost - (v_qty*v_cost*v_disc_pct/100) - v_disc_amt);
    v_net_unit := CASE WHEN v_qty > 0 THEN v_net / v_qty ELSE v_cost END;

    IF v_pid IS NULL THEN
      v_sku := COALESCE(NULLIF(ln->>'sku',''), 'SKU-' || upper(substr(md5(random()::text),1,10)));
      INSERT INTO public.products(branch_id, tenant_id, name, sku, cost_price, selling_price, market_price, quantity, image)
      VALUES (v_branch, v_tenant, v_name, v_sku, v_cost, v_cost*1.3, v_cost*1.3, 0, v_image)
      RETURNING id INTO v_pid;
    END IF;

    UPDATE public.products SET quantity = COALESCE(quantity,0) + v_qty WHERE id = v_pid;

    INSERT INTO public.shipment_items(
      tenant_id, shipment_id, product_id, product_name, quantity, cost_price,
      discount_percent, discount_amount, total, base_unit_price
    ) VALUES (
      v_tenant, v_ship_id, v_pid, v_name, v_qty, v_cost,
      v_disc_pct, v_disc_amt, v_net, v_net_unit
    );

    INSERT INTO public.product_batches(
      tenant_id, branch_id, product_id, shipment_id,
      quantity_purchased, quantity_remaining,
      cost_price, base_purchase_price, true_unit_cost,
      batch_type
    ) VALUES (
      v_tenant, v_branch, v_pid, v_ship_id,
      v_qty, v_qty,
      v_net_unit, v_net_unit, v_net_unit,
      'purchase'
    );

    v_items_net := v_items_net + v_net;
  END LOOP;

  -- Pass 2: distribute extras proportionally across all items
  FOR v_it IN SELECT * FROM public.shipment_items WHERE shipment_id = v_ship_id LOOP
    v_share := CASE WHEN v_items_net > 0 THEN (v_it.total / v_items_net) * v_extras ELSE 0 END;
    v_unit_extra := CASE WHEN v_it.quantity > 0 THEN v_share / v_it.quantity ELSE 0 END;
    UPDATE public.shipment_items
       SET shipping_cost_per_unit = v_unit_extra,
           true_unit_cost = COALESCE(base_unit_price,0) + v_unit_extra
     WHERE id = v_it.id;
    UPDATE public.product_batches
       SET shipping_cost_per_unit = v_unit_extra,
           true_unit_cost = COALESCE(base_purchase_price,0) + v_unit_extra,
           cost_price     = COALESCE(base_purchase_price,0) + v_unit_extra
     WHERE shipment_id = v_ship_id AND product_id = v_it.product_id;
  END LOOP;

  v_total := v_items_net + v_extras + v_admin;
  UPDATE public.shipments SET total_cost = v_total WHERE id = v_ship_id;

  RETURN jsonb_build_object(
    'shipment_id', v_ship_id,
    'total', v_total,
    'items_net', v_items_net,
    'extras', v_extras
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_shipment(jsonb, jsonb) TO authenticated;
