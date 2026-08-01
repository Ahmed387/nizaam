CREATE OR REPLACE FUNCTION public.confirm_transfer_group(p_group uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_count int := 0;
  t record;
  v_existing record;
  v_src record;
  v_sku text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  FOR t IN
    SELECT st.*, p.name AS product_name
    FROM public.stock_transfers st
    LEFT JOIN public.products p ON p.id = st.product_id
    WHERE st.group_id = p_group AND st.status = 'pending'
  LOOP
    PERFORM public.assert_same_tenant(t.tenant_id);
    IF NOT public.user_in_branch(v_user, t.to_branch_id) THEN
      RAISE EXCEPTION 'لا تملك صلاحية على فرع المستلم';
    END IF;

    SELECT * INTO v_existing FROM public.products
      WHERE branch_id = t.to_branch_id AND name = t.product_name LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      UPDATE public.products SET quantity = COALESCE(quantity,0) + t.quantity
        WHERE id = v_existing.id;
    ELSE
      SELECT * INTO v_src FROM public.products WHERE id = t.product_id;
      IF v_src.id IS NOT NULL THEN
        v_sku := 'T-' || substr(replace(gen_random_uuid()::text,'-',''),1,8);
        INSERT INTO public.products(
          branch_id, name, sku, category_id, image,
          cost_price, selling_price, market_price, quantity, low_stock_alert, tenant_id,
          brand, model, color, product_type, capacity, size
        ) VALUES (
          t.to_branch_id, v_src.name, v_sku, v_src.category_id, v_src.image,
          v_src.cost_price, v_src.selling_price, v_src.market_price,
          t.quantity, v_src.low_stock_alert, v_src.tenant_id,
          v_src.brand, v_src.model, v_src.color, v_src.product_type, v_src.capacity, v_src.size
        );
      END IF;
    END IF;

    UPDATE public.stock_transfers
      SET status = 'confirmed', confirmed_by = v_user
      WHERE id = t.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END
$function$;

CREATE OR REPLACE FUNCTION public.partial_confirm_transfer__impl(p_transfer_id uuid, p_received integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  IF p_received > 0 THEN
    SELECT id INTO dest_id
      FROM public.products
     WHERE branch_id = t.to_branch_id AND name = src.name
     LIMIT 1;

    IF dest_id IS NULL THEN
      new_sku := 'T-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      INSERT INTO public.products (
        branch_id, name, sku, category_id, image,
        cost_price, selling_price, market_price, quantity, low_stock_alert, tenant_id,
        brand, model, color, product_type, capacity, size
      ) VALUES (
        t.to_branch_id, src.name, new_sku, src.category_id, src.image,
        src.cost_price, src.selling_price, src.market_price, 0, src.low_stock_alert, t.tenant_id,
        src.brand, src.model, src.color, src.product_type, src.capacity, src.size
      ) RETURNING id INTO dest_id;
    END IF;

    UPDATE public.products
       SET quantity = COALESCE(quantity, 0) + p_received
     WHERE id = dest_id;

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