
-- Extra cost columns on shipments
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS customs_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_cost_description text,
  ADD COLUMN IF NOT EXISTS total_extra_costs numeric NOT NULL DEFAULT 0;

-- Cost breakdown on shipment_items
ALTER TABLE public.shipment_items
  ADD COLUMN IF NOT EXISTS base_unit_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_cost_per_unit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS true_unit_cost numeric NOT NULL DEFAULT 0;

-- True cost tracking on product_batches
ALTER TABLE public.product_batches
  ADD COLUMN IF NOT EXISTS base_purchase_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_cost_per_unit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS true_unit_cost numeric NOT NULL DEFAULT 0;

-- Backfill existing rows: treat current cost_price as both base and true cost
UPDATE public.shipment_items
   SET base_unit_price = COALESCE(NULLIF(base_unit_price,0),
                                  CASE WHEN quantity > 0 THEN total / quantity ELSE cost_price END),
       true_unit_cost  = COALESCE(NULLIF(true_unit_cost,0),
                                  CASE WHEN quantity > 0 THEN total / quantity ELSE cost_price END)
 WHERE base_unit_price = 0 OR true_unit_cost = 0;

UPDATE public.product_batches
   SET base_purchase_price = COALESCE(NULLIF(base_purchase_price,0), cost_price),
       true_unit_cost      = COALESCE(NULLIF(true_unit_cost,0), cost_price)
 WHERE base_purchase_price = 0 OR true_unit_cost = 0;

UPDATE public.shipments
   SET total_extra_costs = COALESCE(shipping_cost,0) + COALESCE(customs_cost,0) + COALESCE(other_cost,0)
 WHERE total_extra_costs = 0;

-- Replace edit_shipment to distribute extras into product_batches.true_unit_cost
CREATE OR REPLACE FUNCTION public.edit_shipment(p_shipment_id uuid, p_header jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ship shipments%ROWTYPE; v_old record; v_new jsonb; v_pid uuid;
  v_qty int; v_cost numeric; v_disc_pct numeric; v_disc_amt numeric;
  v_net numeric; v_net_unit numeric; v_items_net numeric := 0; v_total numeric;
  v_branch uuid; v_tenant uuid; v_sku text; v_name text; v_image text;
  v_paid numeric; v_plan_id uuid; v_new_qty int; v_cur_qty int;
  v_shipping numeric; v_customs numeric; v_other numeric; v_admin numeric;
  v_extras numeric; v_share numeric; v_unit_extra numeric;
  v_it record;
BEGIN
  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الشحنة غير موجودة'; END IF;
  v_branch := v_ship.branch_id; v_tenant := v_ship.tenant_id;

  v_shipping := COALESCE((p_header->>'shipping_cost')::numeric, v_ship.shipping_cost, 0);
  v_customs  := COALESCE((p_header->>'customs_cost')::numeric, v_ship.customs_cost, 0);
  v_other    := COALESCE((p_header->>'other_cost')::numeric, v_ship.other_cost, 0);
  v_admin    := COALESCE((p_header->>'admin_cost')::numeric, v_ship.admin_cost, 0);
  v_extras   := v_shipping + v_customs + v_other;

  -- delete / update existing items
  FOR v_old IN SELECT * FROM shipment_items WHERE shipment_id = p_shipment_id LOOP
    SELECT value INTO v_new FROM jsonb_array_elements(p_items) value
      WHERE (value->>'id')::uuid = v_old.id LIMIT 1;

    IF v_new IS NULL THEN
      IF v_old.product_id IS NOT NULL THEN
        v_cur_qty := COALESCE((SELECT quantity FROM products WHERE id = v_old.product_id), 0);
        v_new_qty := v_cur_qty - v_old.quantity;
        IF v_new_qty < 0 THEN
          RAISE EXCEPTION 'لا يمكن حذف %: المخزون الحالي (%) أقل من كمية الشحنة (%)', v_old.product_name, v_cur_qty, v_old.quantity;
        END IF;
        UPDATE products SET quantity = v_new_qty WHERE id = v_old.product_id;
        DELETE FROM product_batches WHERE shipment_id = p_shipment_id AND product_id = v_old.product_id;
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
        UPDATE products SET quantity = v_new_qty WHERE id = v_old.product_id;
      END IF;

      UPDATE shipment_items SET
        quantity = v_qty, cost_price = v_cost,
        discount_percent = v_disc_pct, discount_amount = v_disc_amt,
        total = v_net,
        base_unit_price = v_net_unit,
        product_name = COALESCE(v_new->>'product_name', product_name)
      WHERE id = v_old.id;

      v_items_net := v_items_net + v_net;
    END IF;
  END LOOP;

  -- insert new items
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

    UPDATE products SET quantity = COALESCE(quantity, 0) + v_qty WHERE id = v_pid;

    INSERT INTO shipment_items(shipment_id, product_id, product_name, quantity, cost_price,
                               discount_percent, discount_amount, total, base_unit_price, tenant_id)
    VALUES (p_shipment_id, v_pid, v_name, v_qty, v_cost, v_disc_pct, v_disc_amt, v_net, v_net_unit, v_tenant);

    INSERT INTO product_batches(tenant_id, branch_id, product_id, shipment_id,
                                quantity_purchased, quantity_remaining, cost_price,
                                base_purchase_price, true_unit_cost)
    VALUES (v_tenant, v_branch, v_pid, p_shipment_id, v_qty, v_qty, v_net_unit, v_net_unit, v_net_unit);

    v_items_net := v_items_net + v_net;
  END LOOP;

  -- distribute extras proportionally across ALL items in shipment
  FOR v_it IN SELECT * FROM shipment_items WHERE shipment_id = p_shipment_id LOOP
    v_share := CASE WHEN v_items_net > 0 THEN (v_it.total / v_items_net) * v_extras ELSE 0 END;
    v_unit_extra := CASE WHEN v_it.quantity > 0 THEN v_share / v_it.quantity ELSE 0 END;
    UPDATE shipment_items
       SET shipping_cost_per_unit = v_unit_extra,
           true_unit_cost = COALESCE(base_unit_price,0) + v_unit_extra
     WHERE id = v_it.id;
    -- update batch: keep base_purchase_price stable, refresh shipping share & true_unit_cost
    UPDATE product_batches
       SET base_purchase_price = COALESCE(NULLIF(base_purchase_price,0), v_it.base_unit_price),
           shipping_cost_per_unit = v_unit_extra,
           true_unit_cost = COALESCE(NULLIF(base_purchase_price,0), v_it.base_unit_price) + v_unit_extra,
           cost_price = COALESCE(NULLIF(base_purchase_price,0), v_it.base_unit_price) + v_unit_extra,
           quantity_remaining = GREATEST(0, quantity_remaining + (v_it.quantity - quantity_purchased)),
           quantity_purchased = v_it.quantity
     WHERE shipment_id = p_shipment_id AND product_id = v_it.product_id;
  END LOOP;

  v_total := v_items_net + v_extras + v_admin;

  UPDATE shipments SET
    arrival_date  = COALESCE((p_header->>'arrival_date')::date, arrival_date),
    received_by   = COALESCE(NULLIF(p_header->>'received_by', ''), received_by),
    shipping_cost = v_shipping,
    customs_cost  = v_customs,
    other_cost    = v_other,
    other_cost_description = COALESCE(p_header->>'other_cost_description', other_cost_description),
    total_extra_costs = v_extras,
    admin_cost    = v_admin,
    notes         = NULLIF(p_header->>'notes', ''),
    total_cost    = v_total
  WHERE id = p_shipment_id;

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

  RETURN jsonb_build_object('total', v_total, 'items_net', v_items_net, 'extras', v_extras,
                            'plan_overpaid', COALESCE(v_paid, 0) > v_total);
END$function$;

-- Make sure realtime publishes these tables (idempotent: ignore if already present)
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.shipments; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.shipment_items; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.product_batches; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
