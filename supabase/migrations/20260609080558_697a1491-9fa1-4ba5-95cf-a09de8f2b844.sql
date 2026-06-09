
ALTER TABLE public.product_batches ADD COLUMN IF NOT EXISTS last_restored_at timestamptz;
ALTER TABLE public.discount_approval_requests ADD COLUMN IF NOT EXISTS invoice_id uuid;

-- ===== Restore batches on cancel =====
CREATE OR REPLACE FUNCTION public.restore_invoice_batches(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv RECORD;
  it RECORD;
  remaining numeric;
  give numeric;
  b RECORD;
BEGIN
  SELECT branch_id, created_at INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN RETURN; END IF;

  FOR it IN
    SELECT product_id, SUM(quantity)::numeric AS qty
    FROM public.invoice_items WHERE invoice_id = _invoice_id AND product_id IS NOT NULL
    GROUP BY product_id
  LOOP
    remaining := it.qty;
    -- LIFO restoration: most recently consumed batch (newest created_at <= sale time) first
    FOR b IN
      SELECT id, quantity_purchased, quantity_remaining
      FROM public.product_batches
      WHERE product_id = it.product_id
        AND branch_id = inv.branch_id
        AND created_at <= inv.created_at
      ORDER BY created_at DESC, id DESC
      FOR UPDATE
    LOOP
      EXIT WHEN remaining <= 0;
      give := LEAST(remaining, b.quantity_purchased - b.quantity_remaining);
      IF give > 0 THEN
        UPDATE public.product_batches
          SET quantity_remaining = quantity_remaining + give,
              last_restored_at = now()
          WHERE id = b.id;
        remaining := remaining - give;
      END IF;
    END LOOP;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.restore_invoice_batches(uuid) TO authenticated;

-- ===== Trigger on invoice cancel =====
CREATE OR REPLACE FUNCTION public.tg_invoice_restore_on_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'cancelled' AND COALESCE(OLD.status::text, '') <> 'cancelled' THEN
    PERFORM public.restore_invoice_batches(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_restore_on_cancel ON public.invoices;
CREATE TRIGGER trg_invoice_restore_on_cancel
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_restore_on_cancel();

-- ===== Fix edit_shipment: stop overwriting products.cost_price, update batch instead =====
CREATE OR REPLACE FUNCTION public.edit_shipment(p_shipment_id uuid, p_header jsonb, p_items jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ship shipments%ROWTYPE; v_old record; v_new jsonb; v_pid uuid;
  v_qty int; v_cost numeric; v_disc_pct numeric; v_disc_amt numeric;
  v_net numeric; v_net_unit numeric; v_items_net numeric := 0; v_total numeric;
  v_branch uuid; v_tenant uuid; v_sku text; v_name text; v_image text;
  v_paid numeric; v_plan_id uuid; v_new_qty int; v_cur_qty int;
BEGIN
  SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الشحنة غير موجودة'; END IF;
  v_branch := v_ship.branch_id; v_tenant := v_ship.tenant_id;

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
        -- NO cost_price overwrite — only update quantity
        UPDATE products SET quantity = v_new_qty WHERE id = v_old.product_id;
        -- Update the matching batch cost_price + quantity if it exists
        UPDATE product_batches SET
            cost_price = v_net_unit,
            quantity_remaining = GREATEST(0, quantity_remaining + (v_qty - quantity_purchased)),
            quantity_purchased = v_qty
          WHERE shipment_id = p_shipment_id AND product_id = v_old.product_id;
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

    -- update quantity only (no cost overwrite)
    UPDATE products SET quantity = COALESCE(quantity, 0) + v_qty WHERE id = v_pid;

    INSERT INTO shipment_items(shipment_id, product_id, product_name, quantity, cost_price, discount_percent, discount_amount, total)
    VALUES (p_shipment_id, v_pid, v_name, v_qty, v_cost, v_disc_pct, v_disc_amt, v_net);

    -- Create a corresponding product batch
    INSERT INTO product_batches(tenant_id, branch_id, product_id, shipment_id, quantity_purchased, quantity_remaining, cost_price)
    VALUES (v_tenant, v_branch, v_pid, p_shipment_id, v_qty, v_qty, v_net_unit);

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
END$function$;

-- ===== Realtime publications =====
ALTER PUBLICATION supabase_realtime ADD TABLE public.discount_approval_requests;
