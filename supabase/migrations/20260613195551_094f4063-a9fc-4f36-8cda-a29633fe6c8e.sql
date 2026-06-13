
-- 1) Add transferred_from_branch_id to product_batches for traceability
ALTER TABLE public.product_batches
  ADD COLUMN IF NOT EXISTS transferred_from_branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

-- 2) Rewrite partial_confirm_transfer: true FIFO, deduct source batches, create per-batch destination batches
CREATE OR REPLACE FUNCTION public.partial_confirm_transfer(p_transfer_id uuid, p_received integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t            public.stock_transfers%ROWTYPE;
  src          public.products%ROWTYPE;
  dest_id      uuid;
  diff         integer;
  new_sku      text;
  remaining    integer;
  take         integer;
  b            record;
  fallback_cost numeric;
BEGIN
  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;
  IF t.status <> 'pending' THEN RAISE EXCEPTION 'transfer_not_pending'; END IF;
  IF p_received IS NULL OR p_received < 0 OR p_received > t.quantity THEN
    RAISE EXCEPTION 'invalid_received_quantity (max %)', t.quantity;
  END IF;

  SELECT * INTO src FROM public.products WHERE id = t.product_id;
  fallback_cost := COALESCE(src.cost_price, 0);

  -- Ensure destination product exists when we will receive units
  IF p_received > 0 THEN
    SELECT id INTO dest_id
      FROM public.products
     WHERE branch_id = t.to_branch_id AND name = src.name
     LIMIT 1;

    IF dest_id IS NULL THEN
      new_sku := 'T-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      INSERT INTO public.products (
        branch_id, name, sku, category_id, image,
        cost_price, selling_price, market_price, quantity, low_stock_alert, tenant_id
      ) VALUES (
        t.to_branch_id, src.name, new_sku, src.category_id, src.image,
        src.cost_price, src.selling_price, src.market_price, 0, src.low_stock_alert, t.tenant_id
      ) RETURNING id INTO dest_id;
    END IF;

    UPDATE public.products
       SET quantity = COALESCE(quantity, 0) + p_received
     WHERE id = dest_id;

    -- FIFO consume source batches; create matching destination batches
    remaining := p_received;
    FOR b IN
      SELECT id, quantity_remaining, cost_price, base_purchase_price, created_at
      FROM public.product_batches
      WHERE product_id = t.product_id
        AND branch_id  = t.from_branch_id
        AND quantity_remaining > 0
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN remaining <= 0;
      take := LEAST(remaining, b.quantity_remaining)::int;

      UPDATE public.product_batches
         SET quantity_remaining = quantity_remaining - take
       WHERE id = b.id;

      INSERT INTO public.product_batches (
        product_id, branch_id, quantity_purchased, quantity_remaining,
        cost_price, base_purchase_price, batch_type, tenant_id,
        transferred_from_branch_id, created_at
      ) VALUES (
        dest_id, t.to_branch_id, take, take,
        COALESCE(b.cost_price, b.base_purchase_price, fallback_cost),
        COALESCE(b.base_purchase_price, b.cost_price, fallback_cost),
        'transfer', t.tenant_id,
        t.from_branch_id, b.created_at
      );

      remaining := remaining - take;
    END LOOP;

    -- If source has no batches (legacy data), create a single fallback destination batch
    IF remaining > 0 THEN
      INSERT INTO public.product_batches (
        product_id, branch_id, quantity_purchased, quantity_remaining,
        cost_price, base_purchase_price, batch_type, tenant_id,
        transferred_from_branch_id, created_at
      ) VALUES (
        dest_id, t.to_branch_id, remaining, remaining,
        fallback_cost, fallback_cost, 'transfer', t.tenant_id,
        t.from_branch_id, now()
      );
      remaining := 0;
    END IF;
  END IF;

  -- Return un-received portion back to source product quantity
  diff := t.quantity - p_received;
  IF diff > 0 THEN
    UPDATE public.products
       SET quantity = COALESCE(quantity, 0) + diff
     WHERE id = t.product_id;
    INSERT INTO public.product_batches (
      product_id, branch_id, quantity_purchased, quantity_remaining,
      cost_price, base_purchase_price, batch_type, tenant_id
    ) VALUES (
      t.product_id, t.from_branch_id, diff, diff,
      fallback_cost, fallback_cost, 'transfer_return', t.tenant_id
    );
  END IF;

  UPDATE public.stock_transfers
     SET status = 'confirmed',
         confirmed_by = auth.uid(),
         received_quantity = p_received
   WHERE id = p_transfer_id;

  RETURN jsonb_build_object(
    'received', p_received,
    'returned', diff,
    'total',    t.quantity
  );
END;
$function$;

-- 3) create_inventory_session: subtract active reservations from system_quantity
CREATE OR REPLACE FUNCTION public.create_inventory_session(p_branch_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session_id uuid;
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = auth.uid();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no tenant'; END IF;

  INSERT INTO public.inventory_sessions (tenant_id, branch_id, notes, created_by, status)
  VALUES (v_tenant, p_branch_id, p_notes, auth.uid(), 'counting')
  RETURNING id INTO v_session_id;

  INSERT INTO public.inventory_session_items
    (session_id, product_id, product_name, product_code, unit, system_quantity)
  SELECT
    v_session_id, p.id, p.name, p.sku, 'قطعة',
    GREATEST(
      COALESCE(p.quantity, 0) - COALESCE((
        SELECT SUM(r.reserved_quantity)
          FROM public.inventory_reservations r
         WHERE r.product_id = p.id
           AND r.branch_id  = p.branch_id
           AND r.status     = 'active'
           AND (r.expires_at IS NULL OR r.expires_at > now())
      ), 0),
      0
    )
  FROM public.products p
  WHERE p.branch_id = p_branch_id AND p.tenant_id = v_tenant;

  RETURN v_session_id;
END $function$;

-- 4) approve_inventory_session: notify managers when active reservations exceed new quantity
CREATE OR REPLACE FUNCTION public.approve_inventory_session(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sess record;
  v_adj_id uuid;
  v_num text;
  r record;
  v_reserved numeric;
  v_new_qty integer;
  v_excess numeric;
  v_mgr record;
BEGIN
  SELECT * INTO v_sess FROM public.inventory_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_sess IS NULL THEN RAISE EXCEPTION 'session not found'; END IF;
  IF v_sess.status NOT IN ('pending_approval','reviewing') THEN
    RAISE EXCEPTION 'session not in approvable state';
  END IF;

  v_num := 'JRD-' || to_char(now(),'YYYYMMDDHH24MISS');

  INSERT INTO public.stock_adjustments (branch_id, adjustment_number, reason, notes, created_by, tenant_id)
  VALUES (v_sess.branch_id, v_num, 'جرد مخزن', COALESCE(v_sess.notes,''), auth.uid(), v_sess.tenant_id)
  RETURNING id INTO v_adj_id;

  FOR r IN
    SELECT * FROM public.inventory_session_items
    WHERE session_id = p_session_id AND actual_quantity IS NOT NULL AND difference <> 0
  LOOP
    UPDATE public.products SET quantity = r.actual_quantity::int WHERE id = r.product_id;

    INSERT INTO public.stock_adjustment_items
      (adjustment_id, product_id, product_name, system_quantity, actual_quantity, difference, unit_cost)
    VALUES (v_adj_id, r.product_id, r.product_name, r.system_quantity::int, r.actual_quantity::int, r.difference::int,
            COALESCE((SELECT cost_price FROM public.products WHERE id = r.product_id),0));

    INSERT INTO public.inventory_adjustments (session_id, product_id, adjustment_amount, reason, created_by)
    VALUES (p_session_id, r.product_id, r.difference, r.reason, auth.uid());

    -- Reservation overflow check
    v_new_qty := r.actual_quantity::int;
    SELECT COALESCE(SUM(reserved_quantity), 0) INTO v_reserved
      FROM public.inventory_reservations
     WHERE product_id = r.product_id
       AND branch_id  = v_sess.branch_id
       AND status     = 'active'
       AND (expires_at IS NULL OR expires_at > now());

    IF v_reserved > v_new_qty THEN
      v_excess := v_reserved - v_new_qty;
      FOR v_mgr IN
        SELECT DISTINCT bu.user_id
          FROM public.branch_users bu
         WHERE bu.branch_id = v_sess.branch_id
      LOOP
        INSERT INTO public.notifications
          (tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
        VALUES (
          v_sess.tenant_id, v_mgr.user_id,
          '⚠️ تحذير: حجوزات تتجاوز المخزون بعد الجرد',
          'يوجد ' || v_excess::text || ' وحدة محجوزة تتجاوز المخزون الجديد بعد الجرد للمنتج ' || r.product_name,
          'general',
          '/branch/' || v_sess.branch_id::text || '/inventory',
          'inventory_session', p_session_id
        );
      END LOOP;
    END IF;
  END LOOP;

  UPDATE public.inventory_sessions
  SET status='closed', approved_by=auth.uid(), approved_at=now(), closed_at=now()
  WHERE id = p_session_id;
END $function$;
