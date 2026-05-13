
ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS group_id uuid;
CREATE INDEX IF NOT EXISTS stock_transfers_group_id_idx ON public.stock_transfers(group_id);

-- Multi-item transfer
CREATE OR REPLACE FUNCTION public.transfer_stock_multi_atomic(
  p_from_branch uuid,
  p_to_branch uuid,
  p_items jsonb,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_group uuid := gen_random_uuid();
  v_item jsonb;
  v_pid uuid;
  v_qty int;
  v_current int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT public.user_in_branch(v_user, p_from_branch) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على فرع المرسل';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'لا توجد أصناف للنقل';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_from_branch;

  -- Lock & validate all items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;

    SELECT quantity INTO v_current FROM public.products
      WHERE id = v_pid AND branch_id = p_from_branch FOR UPDATE;

    IF v_current IS NULL THEN RAISE EXCEPTION 'منتج غير موجود في الفرع'; END IF;
    IF v_current < v_qty THEN
      RAISE EXCEPTION 'الكمية المتاحة غير كافية لمنتج (متاح: %)', v_current;
    END IF;
  END LOOP;

  -- Apply
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::int;

    UPDATE public.products SET quantity = quantity - v_qty WHERE id = v_pid;

    INSERT INTO public.stock_transfers(
      from_branch_id, to_branch_id, product_id, quantity, reason,
      transferred_by, status, tenant_id, group_id
    ) VALUES (
      p_from_branch, p_to_branch, v_pid, v_qty, p_reason,
      v_user, 'pending', v_tenant, v_group
    );
  END LOOP;

  RETURN v_group;
END $$;

-- Bulk confirm
CREATE OR REPLACE FUNCTION public.confirm_transfer_group(p_group uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
          cost_price, selling_price, market_price, quantity, low_stock_alert, tenant_id
        ) VALUES (
          t.to_branch_id, v_src.name, v_sku, v_src.category_id, v_src.image,
          v_src.cost_price, v_src.selling_price, v_src.market_price,
          t.quantity, v_src.low_stock_alert, v_src.tenant_id
        );
      END IF;
    END IF;

    UPDATE public.stock_transfers
      SET status = 'confirmed', confirmed_by = v_user
      WHERE id = t.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

-- Bulk reject
CREATE OR REPLACE FUNCTION public.reject_transfer_group(p_group uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_count int := 0;
  t record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  FOR t IN SELECT * FROM public.stock_transfers
           WHERE group_id = p_group AND status = 'pending'
  LOOP
    IF NOT public.user_in_branch(v_user, t.to_branch_id) THEN
      RAISE EXCEPTION 'لا تملك صلاحية على فرع المستلم';
    END IF;

    UPDATE public.products SET quantity = quantity + t.quantity
      WHERE id = t.product_id;

    UPDATE public.stock_transfers
      SET status = 'rejected', confirmed_by = v_user
      WHERE id = t.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;
