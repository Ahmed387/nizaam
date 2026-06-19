
CREATE OR REPLACE FUNCTION public.admin_set_product_quantity(
  p_product_id uuid,
  p_actual_quantity int,
  p_reason text DEFAULT 'admin_manual_edit',
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_prod public.products%ROWTYPE;
  v_system_qty int;
  v_diff int;
  v_adj_id uuid;
  v_num text;
  v_take numeric;
  v_remaining numeric;
  b record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_actual_quantity < 0 THEN RAISE EXCEPTION 'الكمية لا يمكن أن تكون سالبة'; END IF;

  SELECT * INTO v_prod FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المنتج غير موجود'; END IF;

  v_system_qty := COALESCE(v_prod.quantity, 0);
  v_diff := p_actual_quantity - v_system_qty;

  IF v_diff = 0 THEN
    RETURN jsonb_build_object('changed', false, 'system', v_system_qty, 'actual', p_actual_quantity);
  END IF;

  -- 1) Create the adjustment header
  v_num := 'ADJ-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(md5(random()::text),1,6));
  INSERT INTO public.stock_adjustments(
    tenant_id, branch_id, adjustment_number, reason, notes, created_by
  ) VALUES (
    v_prod.tenant_id, v_prod.branch_id, v_num,
    COALESCE(p_reason,'admin_manual_edit'), p_notes, v_user
  ) RETURNING id INTO v_adj_id;

  -- 2) Create the item (trigger apply_stock_adjustment_item will set products.quantity)
  INSERT INTO public.stock_adjustment_items(
    adjustment_id, product_id, product_name, system_quantity, actual_quantity, difference, unit_cost
  ) VALUES (
    v_adj_id, v_prod.id, v_prod.name, v_system_qty, p_actual_quantity, v_diff, COALESCE(v_prod.cost_price,0)
  );

  -- 3) Reconcile product_batches
  IF v_diff > 0 THEN
    -- Surplus: add an adjustment batch carrying the extra units at current cost
    INSERT INTO public.product_batches(
      tenant_id, branch_id, product_id,
      quantity_purchased, quantity_remaining,
      cost_price, base_purchase_price, true_unit_cost,
      batch_type
    ) VALUES (
      v_prod.tenant_id, v_prod.branch_id, v_prod.id,
      v_diff, v_diff,
      COALESCE(v_prod.cost_price,0), COALESCE(v_prod.cost_price,0), COALESCE(v_prod.cost_price,0),
      'adjustment'
    );
  ELSE
    -- Shortage: consume batches FIFO (oldest first)
    v_remaining := -v_diff;
    FOR b IN
      SELECT id, quantity_remaining
      FROM public.product_batches
      WHERE product_id = v_prod.id AND quantity_remaining > 0
      ORDER BY created_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(b.quantity_remaining, v_remaining);
      UPDATE public.product_batches
         SET quantity_remaining = quantity_remaining - v_take
       WHERE id = b.id;
      v_remaining := v_remaining - v_take;
    END LOOP;
    -- If still remaining (no batches available), create a negative-marker is not allowed;
    -- this means batches were already short — the products.quantity was inflated.
    -- We silently accept since the user's intent is to set the truth.
  END IF;

  RETURN jsonb_build_object(
    'changed', true,
    'system', v_system_qty,
    'actual', p_actual_quantity,
    'diff', v_diff,
    'adjustment_id', v_adj_id,
    'adjustment_number', v_num
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_set_product_quantity(uuid, int, text, text) TO authenticated;
