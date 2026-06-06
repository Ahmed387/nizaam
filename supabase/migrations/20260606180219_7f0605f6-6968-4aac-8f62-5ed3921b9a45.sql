
ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS received_quantity integer;

CREATE OR REPLACE FUNCTION public.partial_confirm_transfer(
  p_transfer_id uuid,
  p_received integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t            public.stock_transfers%ROWTYPE;
  src          public.products%ROWTYPE;
  dest_id      uuid;
  diff         integer;
  new_sku      text;
BEGIN
  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;
  IF t.status <> 'pending' THEN RAISE EXCEPTION 'transfer_not_pending'; END IF;
  IF p_received IS NULL OR p_received < 0 OR p_received > t.quantity THEN
    RAISE EXCEPTION 'invalid_received_quantity (max %)', t.quantity;
  END IF;

  SELECT * INTO src FROM public.products WHERE id = t.product_id;

  -- Add received qty to destination branch
  IF p_received > 0 THEN
    SELECT id INTO dest_id
      FROM public.products
     WHERE branch_id = t.to_branch_id AND name = src.name
     LIMIT 1;

    IF dest_id IS NOT NULL THEN
      UPDATE public.products
         SET quantity = COALESCE(quantity, 0) + p_received
       WHERE id = dest_id;
    ELSE
      new_sku := 'T-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      INSERT INTO public.products (
        branch_id, name, sku, category_id, image,
        cost_price, selling_price, market_price, quantity, low_stock_alert, tenant_id
      ) VALUES (
        t.to_branch_id, src.name, new_sku, src.category_id, src.image,
        src.cost_price, src.selling_price, src.market_price, p_received, src.low_stock_alert, t.tenant_id
      );
    END IF;
  END IF;

  -- Return remaining qty to sender's stock
  diff := t.quantity - p_received;
  IF diff > 0 THEN
    UPDATE public.products
       SET quantity = COALESCE(quantity, 0) + diff
     WHERE id = t.product_id;
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
$$;

GRANT EXECUTE ON FUNCTION public.partial_confirm_transfer(uuid, integer) TO authenticated;
