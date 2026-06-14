CREATE OR REPLACE FUNCTION public.apply_return_batch_tracking(_invoice_id uuid, _items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
  it jsonb;
  v_pid uuid;
  v_qty numeric;
  ii record;
  remaining numeric;
  take numeric;
  ratio numeric;
  bc jsonb;
  v_bid uuid;
  v_bqty numeric;
  v_bcost numeric;
  v_exists boolean;
  new_bid uuid;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv IS NULL THEN
    RAISE EXCEPTION 'الفاتورة غير موجودة';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_pid := NULLIF(it->>'product_id','')::uuid;
    v_qty := COALESCE((it->>'quantity')::numeric, 0);
    IF v_pid IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    remaining := v_qty;

    FOR ii IN
      SELECT *
      FROM public.invoice_items
      WHERE invoice_id = _invoice_id
        AND product_id = v_pid
        AND COALESCE(returned_quantity, 0) < quantity
      ORDER BY id ASC
    LOOP
      EXIT WHEN remaining <= 0;
      take := LEAST(ii.quantity - COALESCE(ii.returned_quantity, 0), remaining);
      IF take <= 0 THEN CONTINUE; END IF;

      IF ii.batches_consumed IS NOT NULL AND jsonb_array_length(ii.batches_consumed) > 0 AND ii.quantity > 0 THEN
        ratio := take / ii.quantity;
        FOR bc IN
          SELECT value FROM jsonb_array_elements(ii.batches_consumed) WITH ORDINALITY arr(value, ord) ORDER BY ord DESC
        LOOP
          v_bid := NULLIF(bc->>'batch_id','')::uuid;
          v_bqty := ROUND((COALESCE((bc->>'qty_taken')::numeric, 0) * ratio)::numeric, 4);
          v_bcost := COALESCE((bc->>'cost_price')::numeric, COALESCE(ii.original_unit_cost, ii.unit_cost_at_sale, ii.cost_price, 0));
          IF v_bqty <= 0 THEN CONTINUE; END IF;

          SELECT EXISTS(SELECT 1 FROM public.product_batches WHERE id = v_bid) INTO v_exists;
          IF v_exists THEN
            UPDATE public.product_batches
            SET quantity_remaining = quantity_remaining + v_bqty,
                restore_count = restore_count + 1,
                last_restored_at = now()
            WHERE id = v_bid;
          ELSE
            INSERT INTO public.product_batches(
              tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining,
              cost_price, base_purchase_price, true_unit_cost,
              batch_type, restore_count, last_restored_at
            ) VALUES (
              inv.tenant_id, inv.branch_id, ii.product_id, v_bqty, v_bqty,
              v_bcost, v_bcost, v_bcost, 'return_restored', 1, now()
            ) RETURNING id INTO new_bid;
          END IF;
        END LOOP;
      END IF;

      UPDATE public.invoice_items
      SET returned_quantity = LEAST(quantity, COALESCE(returned_quantity, 0) + take),
          fully_returned = (LEAST(quantity, COALESCE(returned_quantity, 0) + take) >= quantity)
      WHERE id = ii.id;

      remaining := remaining - take;
    END LOOP;

    IF remaining > 0 THEN
      RAISE EXCEPTION 'كمية المرتجع أكبر من المتاح للإرجاع';
    END IF;

    UPDATE public.inventory_reservations
    SET status = 'released'
    WHERE product_id = v_pid
      AND branch_id = inv.branch_id
      AND status = 'active';
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_return_batch_tracking(uuid, jsonb) TO authenticated, service_role;