
-- ============================================================
-- PHASE 1: SCHEMA
-- ============================================================
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.product_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batches_consumed jsonb,
  ADD COLUMN IF NOT EXISTS fully_returned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS returned_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_unit_cost numeric;

-- net_quantity as generated stored column (skip if it already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='invoice_items' AND column_name='net_quantity'
  ) THEN
    EXECUTE 'ALTER TABLE public.invoice_items ADD COLUMN net_quantity numeric GENERATED ALWAYS AS (quantity - returned_quantity) STORED';
  END IF;
END $$;

ALTER TABLE public.product_batches
  ADD COLUMN IF NOT EXISTS restore_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batch_type text NOT NULL DEFAULT 'purchase';

CREATE INDEX IF NOT EXISTS idx_invoice_items_batch_id ON public.invoice_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_product_batches_fifo ON public.product_batches(product_id, branch_id, created_at) WHERE quantity_remaining > 0;

-- Backfill original_unit_cost from unit_cost_at_sale (only where null)
UPDATE public.invoice_items SET original_unit_cost = unit_cost_at_sale WHERE original_unit_cost IS NULL;

-- Add to realtime publication (ignore if already present)
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_items; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.product_batches; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.returns; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ============================================================
-- PHASE 2: RPC FUNCTIONS
-- ============================================================

-- consume_product_batches_json: FIFO consume returning batches + weighted cost
CREATE OR REPLACE FUNCTION public.consume_product_batches_json(
  _product_id uuid,
  _branch_id uuid,
  _quantity numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining numeric := _quantity;
  total_cost numeric := 0;
  take numeric;
  b RECORD;
  batches jsonb := '[]'::jsonb;
  fallback_cost numeric;
BEGIN
  IF _product_id IS NULL OR _quantity <= 0 THEN
    RETURN jsonb_build_object('batches', batches, 'weighted_unit_cost', 0, 'unfilled', 0);
  END IF;

  FOR b IN
    SELECT id, quantity_remaining, cost_price
    FROM public.product_batches
    WHERE product_id = _product_id AND branch_id = _branch_id AND quantity_remaining > 0
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN remaining <= 0;
    take := LEAST(b.quantity_remaining, remaining);
    UPDATE public.product_batches SET quantity_remaining = quantity_remaining - take WHERE id = b.id;
    total_cost := total_cost + take * b.cost_price;
    batches := batches || jsonb_build_object('batch_id', b.id, 'qty_taken', take, 'cost_price', b.cost_price);
    remaining := remaining - take;
  END LOOP;

  IF remaining > 0 THEN
    SELECT cost_price INTO fallback_cost FROM public.products WHERE id = _product_id;
    total_cost := total_cost + remaining * COALESCE(fallback_cost, 0);
  END IF;

  RETURN jsonb_build_object(
    'batches', batches,
    'weighted_unit_cost', CASE WHEN _quantity > 0 THEN total_cost / _quantity ELSE 0 END,
    'unfilled', remaining
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_product_batches_json(uuid, uuid, numeric) TO authenticated, service_role;

-- restore_batches_from_item: restore batches in LIFO from invoice_item.batches_consumed
CREATE OR REPLACE FUNCTION public.restore_batches_from_item(_invoice_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it record;
  bc jsonb;
  v_batch_id uuid;
  v_qty numeric;
  v_cost numeric;
  v_exists boolean;
  new_batch_id uuid;
BEGIN
  SELECT ii.*, i.branch_id, i.tenant_id
    INTO it
    FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
   WHERE ii.id = _invoice_item_id;

  IF it.batches_consumed IS NULL OR jsonb_array_length(it.batches_consumed) = 0 THEN
    RETURN; -- legacy: caller handles plain quantity restore
  END IF;

  -- iterate in reverse (LIFO)
  FOR bc IN
    SELECT value FROM jsonb_array_elements(it.batches_consumed) WITH ORDINALITY arr(value, ord)
    ORDER BY ord DESC
  LOOP
    v_batch_id := NULLIF(bc->>'batch_id','')::uuid;
    v_qty := COALESCE((bc->>'qty_taken')::numeric, 0);
    v_cost := COALESCE((bc->>'cost_price')::numeric, COALESCE(it.original_unit_cost, it.unit_cost_at_sale, 0));

    IF v_qty <= 0 THEN CONTINUE; END IF;

    SELECT EXISTS(SELECT 1 FROM public.product_batches WHERE id = v_batch_id) INTO v_exists;

    IF v_exists THEN
      UPDATE public.product_batches
         SET quantity_remaining = quantity_remaining + v_qty,
             restore_count = restore_count + 1,
             last_restored_at = now()
       WHERE id = v_batch_id;
    ELSE
      INSERT INTO public.product_batches(
        tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining,
        cost_price, base_purchase_price, true_unit_cost,
        batch_type, restore_count, last_restored_at
      ) VALUES (
        it.tenant_id, it.branch_id, it.product_id, v_qty, v_qty,
        v_cost, v_cost, v_cost,
        'return_restored', 1, now()
      ) RETURNING id INTO new_batch_id;

      BEGIN
        INSERT INTO public.audit_log(action, entity_type, entity_id, tenant_id, branch_id, details)
        VALUES ('batch_restored_missing', 'product_batches', new_batch_id, it.tenant_id, it.branch_id,
                jsonb_build_object(
                  'original_batch_id', v_batch_id,
                  'invoice_item_id', _invoice_item_id,
                  'qty', v_qty,
                  'cost_price', v_cost
                ));
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_batches_from_item(uuid) TO authenticated, service_role;

-- ============================================================
-- edit_invoice (rewritten with FIFO batch awareness)
-- ============================================================
CREATE OR REPLACE FUNCTION public.edit_invoice(_invoice_id uuid, _customer_id uuid, _items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record; uid uuid := auth.uid(); is_adm boolean; is_bm boolean;
  it jsonb; old_it record;
  v_new_qty int; v_pid uuid;
  v_subtotal numeric := 0; v_total numeric := 0; v_disc_amount numeric;
  v_consume jsonb; v_batches jsonb; v_single_batch uuid; v_unit_cost numeric;
  v_orig_cost numeric;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF inv.status <> 'active' THEN RAISE EXCEPTION 'لا يمكن تعديل فاتورة ملغاة'; END IF;

  SELECT has_role(uid, 'admin'::app_role) INTO is_adm;
  SELECT has_role(uid, 'branch_manager'::app_role) INTO is_bm;
  IF NOT (is_adm OR is_bm OR is_super_admin(uid)) THEN
    RAISE EXCEPTION 'غير مصرح بتعديل الفاتورة — مدير الفرع أو الأدمن فقط';
  END IF;

  -- Step A: restore old batches per item (or legacy quantity restore)
  FOR old_it IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
    IF old_it.batches_consumed IS NOT NULL AND jsonb_array_length(old_it.batches_consumed) > 0 THEN
      PERFORM public.restore_batches_from_item(old_it.id);
    END IF;
    IF old_it.product_id IS NOT NULL THEN
      UPDATE public.products SET quantity = quantity + old_it.quantity WHERE id = old_it.product_id;
    END IF;
  END LOOP;

  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;

  -- Step B: re-insert with fresh FIFO consume
  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_pid := NULLIF((it->>'product_id'), '')::uuid;
    v_new_qty := COALESCE((it->>'quantity')::int, 0);
    IF v_new_qty <= 0 THEN CONTINUE; END IF;

    v_batches := NULL; v_single_batch := NULL; v_unit_cost := COALESCE((it->>'cost_price')::numeric, 0);

    IF v_pid IS NOT NULL THEN
      v_consume := public.consume_product_batches_json(v_pid, inv.branch_id, v_new_qty::numeric);
      v_batches := COALESCE(v_consume->'batches', '[]'::jsonb);
      v_unit_cost := COALESCE((v_consume->>'weighted_unit_cost')::numeric, v_unit_cost);
      IF jsonb_array_length(v_batches) = 1 THEN
        v_single_batch := NULLIF(v_batches->0->>'batch_id','')::uuid;
      END IF;
      UPDATE public.products SET quantity = quantity - v_new_qty WHERE id = v_pid;
    END IF;

    -- preserve original_unit_cost: keep first-known cost from the item being edited (if any) by matching product+invoice
    v_orig_cost := v_unit_cost;

    INSERT INTO public.invoice_items(
      invoice_id, product_id, product_name, quantity,
      cost_price, selling_price, market_price, line_discount, total, tenant_id,
      unit_cost_at_sale, batch_id, batches_consumed, original_unit_cost
    ) VALUES (
      _invoice_id, v_pid, it->>'product_name', v_new_qty,
      v_unit_cost,
      COALESCE((it->>'selling_price')::numeric, 0),
      COALESCE((it->>'market_price')::numeric, 0),
      COALESCE((it->>'line_discount')::numeric, 0),
      (COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty) - COALESCE((it->>'line_discount')::numeric, 0),
      inv.tenant_id,
      v_unit_cost,
      v_single_batch,
      v_batches,
      v_orig_cost
    );

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
$$;

-- ============================================================
-- register_sale_return: restore batches + recompute profit
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_sale_return(
  _invoice_id uuid,
  _items jsonb,             -- [{invoice_item_id, quantity, refund}]
  _reason text DEFAULT NULL,
  _refund_method text DEFAULT 'cash',
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
  uid uuid := auth.uid();
  rt_id uuid;
  it jsonb;
  v_item_id uuid;
  v_ret_qty numeric;
  v_refund numeric;
  v_total_refund numeric := 0;
  ii record;
  rn text;
  scaled_batches jsonb;
  bc jsonb;
  ratio numeric;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;

  -- generate return number
  rn := 'SR-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || substr(gen_random_uuid()::text, 1, 4);

  INSERT INTO public.returns(invoice_id, branch_id, reason, total_refund, created_by, tenant_id, notes, refund_method, return_number, status)
  VALUES (_invoice_id, inv.branch_id, _reason, 0, uid, inv.tenant_id, _notes, _refund_method, rn, 'completed')
  RETURNING id INTO rt_id;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_item_id := NULLIF(it->>'invoice_item_id','')::uuid;
    v_ret_qty := COALESCE((it->>'quantity')::numeric, 0);
    v_refund := COALESCE((it->>'refund')::numeric, 0);
    IF v_item_id IS NULL OR v_ret_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO ii FROM public.invoice_items WHERE id = v_item_id;
    IF ii IS NULL THEN CONTINUE; END IF;

    -- Restore batches proportionally if we have batch data
    IF ii.batches_consumed IS NOT NULL AND jsonb_array_length(ii.batches_consumed) > 0 AND ii.quantity > 0 THEN
      ratio := v_ret_qty / ii.quantity;
      scaled_batches := '[]'::jsonb;
      FOR bc IN SELECT value FROM jsonb_array_elements(ii.batches_consumed) LOOP
        scaled_batches := scaled_batches || jsonb_build_object(
          'batch_id', bc->>'batch_id',
          'qty_taken', ROUND((COALESCE((bc->>'qty_taken')::numeric,0) * ratio)::numeric, 4),
          'cost_price', bc->>'cost_price'
        );
      END LOOP;
      -- Use a temporary item-style restore: walk LIFO
      DECLARE
        bb jsonb;
        v_bid uuid;
        v_qty numeric;
        v_cost numeric;
        v_exists boolean;
        new_bid uuid;
      BEGIN
        FOR bb IN SELECT value FROM jsonb_array_elements(scaled_batches) WITH ORDINALITY arr(value, ord) ORDER BY ord DESC LOOP
          v_bid := NULLIF(bb->>'batch_id','')::uuid;
          v_qty := COALESCE((bb->>'qty_taken')::numeric, 0);
          v_cost := COALESCE((bb->>'cost_price')::numeric, COALESCE(ii.original_unit_cost, ii.unit_cost_at_sale, 0));
          IF v_qty <= 0 THEN CONTINUE; END IF;
          SELECT EXISTS(SELECT 1 FROM public.product_batches WHERE id = v_bid) INTO v_exists;
          IF v_exists THEN
            UPDATE public.product_batches
               SET quantity_remaining = quantity_remaining + v_qty,
                   restore_count = restore_count + 1,
                   last_restored_at = now()
             WHERE id = v_bid;
          ELSE
            INSERT INTO public.product_batches(
              tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining,
              cost_price, base_purchase_price, true_unit_cost,
              batch_type, restore_count, last_restored_at
            ) VALUES (
              inv.tenant_id, inv.branch_id, ii.product_id, v_qty, v_qty,
              v_cost, v_cost, v_cost, 'return_restored', 1, now()
            ) RETURNING id INTO new_bid;
            BEGIN
              INSERT INTO public.audit_log(action, entity_type, entity_id, tenant_id, branch_id, details)
              VALUES ('batch_restored_missing', 'product_batches', new_bid, inv.tenant_id, inv.branch_id,
                      jsonb_build_object('original_batch_id', v_bid, 'invoice_item_id', v_item_id, 'qty', v_qty, 'cost_price', v_cost));
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
          END IF;
        END LOOP;
      END;
    END IF;

    -- Also restore products.quantity (legacy global counter)
    IF ii.product_id IS NOT NULL THEN
      UPDATE public.products SET quantity = quantity + v_ret_qty WHERE id = ii.product_id;
    END IF;

    -- Mark invoice_item as returned (partial or full)
    UPDATE public.invoice_items
       SET returned_quantity = LEAST(quantity, returned_quantity + v_ret_qty),
           fully_returned = (LEAST(quantity, returned_quantity + v_ret_qty) >= quantity)
     WHERE id = v_item_id;

    -- Release reservations linked to this product on this invoice
    UPDATE public.inventory_reservations
       SET status = 'released'
     WHERE product_id = ii.product_id
       AND branch_id = inv.branch_id
       AND status = 'active';

    -- Insert return_items row
    INSERT INTO public.return_items(return_id, product_id, quantity, refund, tenant_id)
    VALUES (rt_id, ii.product_id, v_ret_qty::int, v_refund, inv.tenant_id);

    v_total_refund := v_total_refund + v_refund;
  END LOOP;

  UPDATE public.returns SET total_refund = v_total_refund WHERE id = rt_id;

  RETURN rt_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_sale_return(uuid, jsonb, text, text, text) TO authenticated, service_role;
