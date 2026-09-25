-- 1) Explicit stock-movement context helper (deterministic, no trigger-order dependency)
CREATE OR REPLACE FUNCTION public.stock_mv_ctx(
  _type text, _ref_type text, _ref uuid, _prod uuid, _date timestamptz
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT set_config('nizam.mv_type', _type, true),
         set_config('nizam.mv_ref_type', _ref_type, true),
         set_config('nizam.mv_ref', COALESCE(_ref::text,''), true),
         set_config('nizam.mv_prod', COALESCE(_prod::text,''), true),
         set_config('nizam.mv_date', COALESCE(_date::text,''), true);
$$;
REVOKE ALL ON FUNCTION public.stock_mv_ctx(text,text,uuid,uuid,timestamptz) FROM PUBLIC, anon;

-- 2) Transfers stamp their operational transfer_date into the ledger, not created_at
CREATE OR REPLACE FUNCTION public.stock_mv_set_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_type text; v_ref_type text; v_ref uuid; v_date timestamptz; v_prod uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  CASE TG_TABLE_NAME
    WHEN 'invoice_items' THEN v_type:='sale'; v_ref_type:='invoice'; v_ref:=r.invoice_id; v_prod:=r.product_id;
      SELECT invoice_date INTO v_date FROM invoices WHERE id=r.invoice_id;
    WHEN 'return_items' THEN v_type:='return_in'; v_ref_type:='sale_return'; v_ref:=r.return_id; v_prod:=r.product_id;
      SELECT invoice_date INTO v_date FROM returns WHERE id=r.return_id;
    WHEN 'shipment_items' THEN v_type:='purchase'; v_ref_type:='shipment'; v_ref:=r.shipment_id; v_prod:=r.product_id;
      SELECT invoice_date INTO v_date FROM shipments WHERE id=r.shipment_id;
    WHEN 'purchase_return_items' THEN v_type:='return_out'; v_ref_type:='purchase_return'; v_ref:=r.purchase_return_id; v_prod:=r.product_id;
      SELECT invoice_date INTO v_date FROM purchase_returns WHERE id=r.purchase_return_id;
    WHEN 'stock_adjustment_items' THEN v_type:='adjustment'; v_ref_type:='stock_adjustment'; v_ref:=r.adjustment_id; v_prod:=r.product_id;
    WHEN 'inventory_adjustments' THEN v_type:='adjustment'; v_ref_type:='inventory_session'; v_ref:=r.session_id; v_prod:=r.product_id;
    WHEN 'stock_transfers' THEN v_type:='transfer'; v_ref_type:='stock_transfer'; v_ref:=r.id; v_prod:=NULL;
      v_date := CASE WHEN r.transfer_date IS NOT NULL
                     THEN (r.transfer_date + time '12:00') AT TIME ZONE 'Africa/Cairo'
                     ELSE NULL END;
    WHEN 'invoices' THEN v_type:='sale'; v_ref_type:='invoice'; v_ref:=r.id; v_prod:=NULL; v_date:=r.invoice_date;
    ELSE RETURN r;
  END CASE;
  PERFORM set_config('nizam.mv_type', v_type, true);
  PERFORM set_config('nizam.mv_ref_type', v_ref_type, true);
  PERFORM set_config('nizam.mv_ref', COALESCE(v_ref::text,''), true);
  PERFORM set_config('nizam.mv_prod', COALESCE(v_prod::text,''), true);
  PERFORM set_config('nizam.mv_date', COALESCE(v_date::text,''), true);
  RETURN r;
END $$;

-- 3) Exact point-in-time branch balance for one product, using operational dates only
CREATE OR REPLACE FUNCTION public.stock_balance_as_of(
  _branch_id uuid, _product_id uuid, _as_of date
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_cur numeric; v_after numeric;
BEGIN
  SELECT tenant_id, COALESCE(quantity,0) INTO v_tenant, v_cur
    FROM products WHERE id = _product_id AND branch_id = _branch_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'منتج غير موجود في الفرع'; END IF;
  PERFORM assert_same_tenant(v_tenant);
  IF NOT (is_admin(auth.uid()) OR is_super_admin(auth.uid())
          OR has_role(auth.uid(),'owner') OR user_in_branch(auth.uid(), _branch_id)) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على هذا الفرع';
  END IF;

  -- Net effect of every movement that happened AFTER the chosen operational day
  SELECT COALESCE(SUM(d),0) INTO v_after FROM (
    -- Sales (out)
    SELECT -ii.quantity::numeric AS d
      FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
     WHERE ii.product_id = _product_id AND i.branch_id = _branch_id
       AND i.status <> 'cancelled'
       AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date > _as_of
    UNION ALL
    -- Sales returns (in)
    SELECT ri.quantity::numeric
      FROM return_items ri JOIN returns r ON r.id = ri.return_id
     WHERE ri.product_id = _product_id AND r.branch_id = _branch_id
       AND (r.invoice_date AT TIME ZONE 'Africa/Cairo')::date > _as_of
    UNION ALL
    -- Purchases (in)
    SELECT si.quantity::numeric
      FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
     WHERE si.product_id = _product_id AND s.branch_id = _branch_id
       AND (COALESCE(s.invoice_date, s.created_at) AT TIME ZONE 'Africa/Cairo')::date > _as_of
    UNION ALL
    -- Purchase returns (out)
    SELECT -pri.quantity::numeric
      FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id = pri.purchase_return_id
     WHERE pri.product_id = _product_id AND pr.branch_id = _branch_id
       AND (COALESCE(pr.invoice_date, pr.created_at) AT TIME ZONE 'Africa/Cairo')::date > _as_of
    UNION ALL
    -- Manual stock adjustments
    SELECT sai.difference::numeric
      FROM stock_adjustment_items sai JOIN stock_adjustments sa ON sa.id = sai.adjustment_id
     WHERE sai.product_id = _product_id AND sa.branch_id = _branch_id
       AND (sa.created_at AT TIME ZONE 'Africa/Cairo')::date > _as_of
    UNION ALL
    -- Inventory count adjustments
    SELECT ia.adjustment_amount::numeric
      FROM inventory_adjustments ia JOIN inventory_sessions ses ON ses.id = ia.session_id
     WHERE ia.product_id = _product_id AND ses.branch_id = _branch_id
       AND (ia.created_at AT TIME ZONE 'Africa/Cairo')::date > _as_of
    UNION ALL
    -- Transfers out: pending reserves full qty, confirmed keeps received qty, rejected nets to zero
    SELECT -(CASE WHEN st.status = 'pending' THEN st.quantity
                  WHEN st.status = 'confirmed' THEN COALESCE(st.received_quantity, st.quantity)
                  ELSE 0 END)::numeric
      FROM stock_transfers st
     WHERE st.product_id = _product_id AND st.from_branch_id = _branch_id
       AND COALESCE(st.transfer_date, (st.created_at AT TIME ZONE 'Africa/Cairo')::date) > _as_of
    UNION ALL
    -- Transfers in
    SELECT COALESCE(st.received_quantity, st.quantity)::numeric
      FROM stock_transfers st
     WHERE st.to_branch_id = _branch_id AND st.status = 'confirmed'
       AND EXISTS (
         SELECT 1 FROM products dp
          WHERE dp.id = _product_id AND dp.branch_id = _branch_id
            AND dp.name = (SELECT sp.name FROM products sp WHERE sp.id = st.product_id)
       )
       AND COALESCE(st.transfer_date, (st.created_at AT TIME ZONE 'Africa/Cairo')::date) > _as_of
  ) x;

  RETURN v_cur - v_after;
END $$;
REVOKE ALL ON FUNCTION public.stock_balance_as_of(uuid,uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_balance_as_of(uuid,uuid,date) TO authenticated;

-- 4) Atomic transfer creation with the operational date validated in the same transaction
CREATE OR REPLACE FUNCTION public.transfer_stock_multi_atomic(
  p_from_branch uuid, p_to_branch uuid, p_items jsonb, p_reason text, p_transfer_date date
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
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_date date;
  v_hist numeric;
  v_name text;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT public.user_in_branch(v_user, p_from_branch) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على فرع المرسل';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'لا توجد أصناف للنقل';
  END IF;

  v_date := COALESCE(p_transfer_date, v_today);
  IF v_date > v_today THEN
    RAISE EXCEPTION 'مينفعش تسجّل تحويل بتاريخ في المستقبل';
  END IF;
  IF v_date <> v_today AND NOT (public.is_admin(v_user) OR public.is_super_admin(v_user)) THEN
    RAISE EXCEPTION 'تسجيل تحويل بتاريخ سابق متاح للإدارة فقط';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_from_branch;

  -- Lock & validate every item before mutating anything
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'كمية غير صحيحة'; END IF;

    SELECT quantity, name INTO v_current, v_name FROM public.products
      WHERE id = v_pid AND branch_id = p_from_branch FOR UPDATE;

    IF v_current IS NULL THEN RAISE EXCEPTION 'منتج غير موجود في الفرع'; END IF;
    IF v_current < v_qty THEN
      RAISE EXCEPTION '% : الكمية المتاحة غير كافية (متاح: %)', v_name, v_current;
    END IF;

    IF v_date <> v_today THEN
      v_hist := public.stock_balance_as_of(p_from_branch, v_pid, v_date);
      IF v_qty > v_hist THEN
        RAISE EXCEPTION '% : الرصيد في تاريخ التحويل المحدد غير كافٍ (الرصيد المتاح في هذا التاريخ: %)',
          v_name, trim(to_char(v_hist, 'FM999999999990.99'));
      END IF;
    END IF;
  END LOOP;

  -- Apply: transfer row first (carries the ledger context), then the quantity change
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::int;

    INSERT INTO public.stock_transfers(
      from_branch_id, to_branch_id, product_id, quantity, reason,
      transferred_by, status, tenant_id, group_id, transfer_date
    ) VALUES (
      p_from_branch, p_to_branch, v_pid, v_qty, p_reason,
      v_user, 'pending', v_tenant, v_group, v_date
    ) RETURNING id INTO v_id;

    PERFORM public.stock_mv_ctx('transfer','stock_transfer', v_id, v_pid,
      (v_date + time '12:00') AT TIME ZONE 'Africa/Cairo');

    UPDATE public.products SET quantity = quantity - v_qty WHERE id = v_pid;
  END LOOP;

  RETURN v_group;
END $$;
REVOKE ALL ON FUNCTION public.transfer_stock_multi_atomic(uuid,uuid,jsonb,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_stock_multi_atomic(uuid,uuid,jsonb,text,date) TO authenticated;

-- Legacy 4-arg entry point delegates to the dated implementation (today's date)
CREATE OR REPLACE FUNCTION public.transfer_stock_multi_atomic(
  p_from_branch uuid, p_to_branch uuid, p_items jsonb, p_reason text
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.transfer_stock_multi_atomic(p_from_branch, p_to_branch, p_items, p_reason, NULL::date);
$$;

-- 5) Confirmation / rejection legs also land on the transfer's operational date
CREATE OR REPLACE FUNCTION public.partial_confirm_transfer__impl(p_transfer_id uuid, p_received integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  v_mv_date    timestamptz;
BEGIN
  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;
  IF t.status <> 'pending' THEN RAISE EXCEPTION 'transfer_not_pending'; END IF;
  IF p_received IS NULL OR p_received < 0 OR p_received > t.quantity THEN
    RAISE EXCEPTION 'invalid_received_quantity (max %)', t.quantity;
  END IF;

  v_mv_date := (COALESCE(t.transfer_date, (t.created_at AT TIME ZONE 'Africa/Cairo')::date) + time '12:00')
               AT TIME ZONE 'Africa/Cairo';

  SELECT * INTO src FROM public.products WHERE id = t.product_id;
  fallback_cost := COALESCE(src.cost_price, 0);

  IF p_received > 0 THEN
    SELECT id INTO dest_id
      FROM public.products
     WHERE branch_id = t.to_branch_id AND name = src.name
     LIMIT 1;

    IF dest_id IS NULL THEN
      new_sku := 'T-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      PERFORM public.stock_mv_ctx('transfer','stock_transfer', t.id, NULL, v_mv_date);
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

    PERFORM public.stock_mv_ctx('transfer','stock_transfer', t.id, dest_id, v_mv_date);
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
      ORDER BY effective_at ASC, created_at ASC, id ASC
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
    PERFORM public.stock_mv_ctx('transfer','stock_transfer', t.id, t.product_id, v_mv_date);
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
END $$;

CREATE OR REPLACE FUNCTION public.reject_transfer(p_transfer_id uuid, p_reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  t public.stock_transfers%ROWTYPE;
  v_cost numeric;
  v_mv_date timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;
  IF t.status <> 'pending' THEN RAISE EXCEPTION 'transfer_not_pending'; END IF;

  PERFORM public.assert_same_tenant(t.tenant_id);

  IF NOT (public.is_super_admin(v_user) OR public.is_admin(v_user)
          OR public.has_role(v_user, 'owner')
          OR public.user_in_branch(v_user, t.to_branch_id)) THEN
    RAISE EXCEPTION 'لا تملك صلاحية على فرع المستلم';
  END IF;

  v_mv_date := (COALESCE(t.transfer_date, (t.created_at AT TIME ZONE 'Africa/Cairo')::date) + time '12:00')
               AT TIME ZONE 'Africa/Cairo';

  SELECT COALESCE(cost_price, 0) INTO v_cost FROM public.products WHERE id = t.product_id;

  PERFORM public.stock_mv_ctx('transfer','stock_transfer', t.id, t.product_id, v_mv_date);
  UPDATE public.products
     SET quantity = COALESCE(quantity, 0) + t.quantity
   WHERE id = t.product_id;

  INSERT INTO public.product_batches (
    product_id, branch_id, quantity_purchased, quantity_remaining,
    cost_price, base_purchase_price, batch_type, tenant_id
  ) VALUES (
    t.product_id, t.from_branch_id, t.quantity, t.quantity,
    COALESCE(v_cost, 0), COALESCE(v_cost, 0), 'transfer_return', t.tenant_id
  );

  UPDATE public.stock_transfers
     SET status = 'rejected',
         confirmed_by = v_user,
         received_quantity = 0,
         rejection_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
         confirmed_at = now()
   WHERE id = t.id;

  RETURN jsonb_build_object('returned', t.quantity, 'transfer_id', t.id);
END $$;

CREATE OR REPLACE FUNCTION public.reject_transfer_group(p_group uuid, p_reason text DEFAULT NULL::text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_count int := 0; t record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  FOR t IN SELECT id FROM public.stock_transfers
           WHERE group_id = p_group AND status = 'pending'
           ORDER BY created_at
  LOOP
    PERFORM public.reject_transfer(t.id, p_reason);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- 6) A voucher date change keeps its journal entry on the same day, with no extra entry
CREATE OR REPLACE FUNCTION public.sync_journal_date_on_voucher_date_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.voucher_date IS DISTINCT FROM OLD.voucher_date THEN
    UPDATE public.journal_entries
       SET entry_date = NEW.voucher_date
     WHERE source_type = 'voucher' AND source_id = NEW.id
       AND status IN ('draft','posted')
       AND entry_date <> NEW.voucher_date;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_voucher_date_journal_sync ON public.vouchers;
CREATE TRIGGER trg_voucher_date_journal_sync
AFTER UPDATE OF voucher_date ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.sync_journal_date_on_voucher_date_change();

-- Guarantee a voucher can never carry two live journal entries
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_voucher_source
  ON public.journal_entries(source_type, source_id)
  WHERE source_type = 'voucher' AND status IN ('draft','posted');