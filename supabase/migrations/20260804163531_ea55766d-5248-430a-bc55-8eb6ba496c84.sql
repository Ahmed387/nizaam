CREATE OR REPLACE FUNCTION public.record_shipment(p_header jsonb, p_lines jsonb, p_plan jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_branch uuid := (p_header->>'branch_id')::uuid;
  v_ship_id uuid;
  v_num text;
  ln jsonb;
  v_pid uuid;
  v_qty int;
  v_cost numeric;
  v_disc_pct numeric;
  v_disc_amt numeric;
  v_name text;
  v_image text;
  v_sku text;
  v_net numeric;
  v_net_unit numeric;
  v_brand text; v_model text; v_color text; v_ptype text; v_capacity text; v_size text;
  v_shipping numeric := COALESCE((p_header->>'shipping_cost')::numeric, 0);
  v_customs  numeric := COALESCE((p_header->>'customs_cost')::numeric, 0);
  v_other    numeric := COALESCE((p_header->>'other_cost')::numeric, 0);
  v_admin    numeric := COALESCE((p_header->>'admin_cost')::numeric, 0);
  v_extras   numeric;
  v_it record;
  v_subtotal numeric := 0;
  v_total_qty int := 0;
  v_share numeric;
  v_inv_disc_type text := COALESCE(NULLIF(p_header->>'discount_type',''), 'amount');
  v_inv_disc_value numeric := COALESCE((p_header->>'discount_value')::numeric, 0);
  v_inv_disc numeric := 0;
  v_factor numeric := 1;
  v_base numeric;
BEGIN
  IF v_branch IS NULL THEN RAISE EXCEPTION 'branch_id required'; END IF;

  v_extras := v_shipping + v_customs + v_other;
  v_num := public.next_shipment_number();

  INSERT INTO public.shipments(
    tenant_id, branch_id, shipment_number, contact_id, arrival_date, received_by,
    shipping_cost, customs_cost, other_cost, other_cost_description,
    total_extra_costs, admin_cost, total_cost, notes,
    discount_type, discount_value, discount_amount
  ) VALUES (
    v_tenant, v_branch, v_num,
    NULLIF(p_header->>'contact_id','')::uuid,
    COALESCE(NULLIF(p_header->>'arrival_date','')::date, CURRENT_DATE),
    NULLIF(p_header->>'received_by',''),
    v_shipping, v_customs, v_other, NULLIF(p_header->>'other_cost_description',''),
    v_extras, v_admin, 0,
    NULLIF(p_header->>'notes',''),
    v_inv_disc_type, v_inv_disc_value, 0
  ) RETURNING id INTO v_ship_id;

  FOR ln IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_pid := NULLIF(ln->>'product_id','')::uuid;
    v_qty := (ln->>'quantity')::int;
    v_cost := (ln->>'cost_price')::numeric;
    v_disc_pct := COALESCE((ln->>'discount_percent')::numeric, 0);
    v_disc_amt := COALESCE((ln->>'discount_amount')::numeric, 0);
    v_name := ln->>'product_name';
    v_image := NULLIF(ln->>'image','');
    v_brand := NULLIF(ln->>'brand','');
    v_model := NULLIF(ln->>'model','');
    v_color := NULLIF(ln->>'color','');
    v_ptype := NULLIF(ln->>'product_type','');
    v_capacity := NULLIF(ln->>'capacity','');
    v_size := NULLIF(ln->>'size','');
    v_net := GREATEST(0, v_qty*v_cost - (v_qty*v_cost*v_disc_pct/100) - v_disc_amt);
    v_net_unit := CASE WHEN v_qty > 0 THEN v_net / v_qty ELSE v_cost END;

    IF v_pid IS NULL THEN
      v_sku := COALESCE(NULLIF(ln->>'sku',''), 'SKU-' || upper(substr(md5(random()::text),1,10)));
      INSERT INTO public.products(branch_id, tenant_id, name, sku, cost_price, selling_price, market_price, quantity, image,
                                  brand, model, color, product_type, capacity, size)
      VALUES (v_branch, v_tenant, v_name, v_sku, v_cost, v_cost*1.3, v_cost*1.3, 0, v_image,
              v_brand, v_model, v_color, v_ptype, v_capacity, v_size)
      RETURNING id INTO v_pid;
    ELSE
      UPDATE public.products
         SET brand = COALESCE(brand, v_brand),
             model = COALESCE(model, v_model),
             color = COALESCE(color, v_color),
             product_type = COALESCE(product_type, v_ptype),
             capacity = COALESCE(capacity, v_capacity),
             size = COALESCE(size, v_size)
       WHERE id = v_pid
         AND (v_brand IS NOT NULL OR v_model IS NOT NULL OR v_color IS NOT NULL
              OR v_ptype IS NOT NULL OR v_capacity IS NOT NULL OR v_size IS NOT NULL);
    END IF;

    UPDATE public.products SET quantity = COALESCE(quantity,0) + v_qty WHERE id = v_pid;

    INSERT INTO public.shipment_items(
      tenant_id, shipment_id, product_id, product_name, quantity, cost_price,
      discount_percent, discount_amount, total, base_unit_price,
      brand, model, color, product_type, capacity, size
    ) VALUES (
      v_tenant, v_ship_id, v_pid, v_name, v_qty, v_cost,
      v_disc_pct, v_disc_amt, v_net, v_net_unit,
      v_brand, v_model, v_color, v_ptype, v_capacity, v_size
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

    v_subtotal := v_subtotal + v_net;
    v_total_qty := v_total_qty + v_qty;
  END LOOP;

  IF v_inv_disc_type = 'percent' THEN
    v_inv_disc := v_subtotal * GREATEST(0, LEAST(100, v_inv_disc_value)) / 100;
  ELSE
    v_inv_disc := GREATEST(0, v_inv_disc_value);
  END IF;
  v_inv_disc := LEAST(v_inv_disc, v_subtotal);
  v_factor := CASE WHEN v_subtotal > 0 THEN (v_subtotal - v_inv_disc) / v_subtotal ELSE 1 END;

  UPDATE public.shipments
     SET total_cost = (v_subtotal - v_inv_disc) + v_extras + v_admin,
         discount_amount = v_inv_disc
   WHERE id = v_ship_id;

  v_share := CASE WHEN v_total_qty > 0 THEN v_extras / v_total_qty ELSE 0 END;
  FOR v_it IN SELECT product_id, quantity, base_unit_price FROM public.shipment_items WHERE shipment_id = v_ship_id LOOP
    v_base := COALESCE(v_it.base_unit_price, 0) * v_factor;
    UPDATE public.shipment_items
       SET shipping_cost_per_unit = v_share,
           true_unit_cost = v_base + v_share
     WHERE shipment_id = v_ship_id AND product_id = v_it.product_id;

    UPDATE public.product_batches
       SET base_purchase_price = v_base,
           cost_price = v_base + v_share,
           shipping_cost_per_unit = v_share,
           true_unit_cost = v_base + v_share
     WHERE shipment_id = v_ship_id AND product_id = v_it.product_id;
  END LOOP;

  RETURN jsonb_build_object(
    'shipment_id', v_ship_id,
    'shipment_number', v_num,
    'subtotal', v_subtotal,
    'invoice_discount', v_inv_disc,
    'total_cost', (v_subtotal - v_inv_disc) + v_extras + v_admin
  );
END;
$function$;