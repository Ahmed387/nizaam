CREATE OR REPLACE FUNCTION public.edit_shipment(
  p_shipment_id uuid,
  p_header jsonb,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ship shipments%ROWTYPE;
  v_old record;
  v_new jsonb;
  v_pid uuid;
  v_qty int;
  v_cost numeric;
  v_disc_pct numeric;
  v_disc_amt numeric;
  v_net numeric;
  v_net_unit numeric;
  v_items_net numeric := 0;
  v_total numeric;
  v_branch uuid;
  v_tenant uuid;
  v_sku text;
  v_name text;
  v_image text;
  v_paid numeric;
  v_plan_id uuid;
  v_new_qty int;
  v_cur_qty int;
BEGIN
  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الشحنة غير موجودة'; END IF;
  v_branch := v_ship.branch_id;
  v_tenant := v_ship.tenant_id;

  -- Process existing items
  FOR v_old IN SELECT * FROM shipment_items WHERE shipment_id = p_shipment_id LOOP
    SELECT value INTO v_new FROM jsonb_array_elements(p_items) value
      WHERE (value->>'id')::uuid = v_old.id LIMIT 1;

    IF v_new IS NULL THEN
      -- removed line
      IF v_old.product_id IS NOT NULL THEN
        v_cur_qty := COALESCE((SELECT quantity FROM products WHERE id = v_old.product_id), 0);
        v_new_qty := v_cur_qty - v_old.quantity;
        IF v_new_qty < 0 THEN
          RAISE EXCEPTION 'لا يمكن حذف %: المخزون الحالي (%) أقل من كمية الشحنة (%)', v_old.product_name, v_cur_qty, v_old.quantity;
        END IF;
        UPDATE products SET quantity = v_new_qty WHERE id = v_old.product_id;
      END IF;
      DELETE FROM shipment_items WHERE id = v_old.id;
    ELSE
      v_qty := (v_new->>'quantity')::int;
      v_cost := (v_new->>'cost_price')::numeric;
      v_disc_pct := COALESCE((v_new->>'discount_percent')::numeric, 0);
      v_disc_amt := COALESCE((v_new->>'discount_amount')::numeric, 0);
      v_net := GREATEST(0, v_qty*v_cost - (v_qty*v_cost*v_disc_pct/100) - v_disc_amt);
      v_net_unit := CASE WHEN v_qty > 0 THEN v_net/v_qty ELSE v_cost END;

      IF v_old.product_id IS NOT NULL THEN
        v_cur_qty := COALESCE((SELECT quantity FROM products WHERE id = v_old.product_id), 0);
        v_new_qty := v_cur_qty + (v_qty - v_old.quantity);
        IF v_new_qty < 0 THEN
          RAISE EXCEPTION 'لا يمكن تقليل كمية %: المخزون (%) لا يكفي', v_old.product_name, v_cur_qty;
        END IF;
        UPDATE products SET quantity = v_new_qty, cost_price = v_net_unit WHERE id = v_old.product_id;
      END IF;

      UPDATE shipment_items SET
        quantity = v_qty, cost_price = v_cost,
        discount_percent = v_disc_pct, discount_amount = v_disc_amt,
        total = v_net,
        product_name = COALESCE(v_new->>'product_name', product_name)
      WHERE id = v_old.id;
      v_items_net := v_items_net + v_net;
    END IF;
  END LOOP;

  -- Process new items
  FOR v_new IN SELECT value FROM jsonb_array_elements(p_items) value WHERE value->>'id' IS NULL LOOP
    v_pid := NULLIF(v_new->>'product_id', '')::uuid;
    v_qty := (v_new->>'quantity')::int;
    v_cost := (v_new->>'cost_price')::numeric;
    v_disc_pct := COALESCE((v_new->>'discount_percent')::numeric, 0);
    v_disc_amt := COALESCE((v_new->>'discount_amount')::numeric, 0);
    v_name := v_new->>'product_name';
    v_sku := COALESCE(NULLIF(v_new->>'sku', ''), 'SKU-' || upper(substr(md5(random()::text), 1, 10)));
    v_image := NULLIF(v_new->>'image', '');
    v_net := GREATEST(0, v_qty*v_cost - (v_qty*v_cost*v_disc_pct/100) - v_disc_amt);
    v_net_unit := CASE WHEN v_qty > 0 THEN v_net/v_qty ELSE v_cost END;

    IF v_pid IS NULL THEN
      INSERT INTO products(branch_id, tenant_id, name, sku, cost_price, selling_price, market_price, quantity, image)
      VALUES (v_branch, v_tenant, v_name, v_sku, v_cost, v_cost*1.3, v_cost*1.3, 0, v_image)
      RETURNING id INTO v_pid;
    END IF;

    UPDATE products SET quantity = COALESCE(quantity, 0) + v_qty, cost_price = v_net_unit WHERE id = v_pid;

    INSERT INTO shipment_items(shipment_id, product_id, product_name, quantity, cost_price, discount_percent, discount_amount, total)
    VALUES (p_shipment_id, v_pid, v_name, v_qty, v_cost, v_disc_pct, v_disc_amt, v_net);
    v_items_net := v_items_net + v_net;
  END LOOP;

  v_total := v_items_net
           + COALESCE((p_header->>'shipping_cost')::numeric, 0)
           + COALESCE((p_header->>'admin_cost')::numeric, 0);

  UPDATE shipments SET
    arrival_date  = COALESCE((p_header->>'arrival_date')::date, arrival_date),
    received_by   = COALESCE(NULLIF(p_header->>'received_by', ''), received_by),
    shipping_cost = COALESCE((p_header->>'shipping_cost')::numeric, shipping_cost),
    admin_cost    = COALESCE((p_header->>'admin_cost')::numeric, admin_cost),
    notes         = NULLIF(p_header->>'notes', ''),
    total_cost    = v_total
  WHERE id = p_shipment_id;

  -- Adjust linked payment plan if exists
  SELECT id, paid_amount INTO v_plan_id, v_paid
    FROM payment_plans
    WHERE reference_type = 'shipment' AND reference_id = p_shipment_id
    LIMIT 1;
  IF v_plan_id IS NOT NULL THEN
    UPDATE payment_plans SET
      total_amount     = v_total,
      remaining_amount = GREATEST(0, v_total - v_paid)
    WHERE id = v_plan_id;
  END IF;

  RETURN jsonb_build_object('total', v_total, 'items_net', v_items_net, 'plan_overpaid', COALESCE(v_paid, 0) > v_total);
END$$;

GRANT EXECUTE ON FUNCTION public.edit_shipment(uuid, jsonb, jsonb) TO authenticated;
