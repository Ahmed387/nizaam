
-- ============================================================
-- 1) BACKFILL unit_cost_at_sale for migrated invoice items
-- ============================================================
WITH picked AS (
  SELECT DISTINCT ON (ii.id)
    ii.id,
    COALESCE(si.true_unit_cost, si.cost_price, 0) AS cost
  FROM public.invoice_items ii
  JOIN public.invoices inv ON inv.id = ii.invoice_id
  JOIN public.shipment_items si ON si.product_id = ii.product_id
  JOIN public.shipments s ON s.id = si.shipment_id
  WHERE ii.unit_cost_at_sale = 0
    AND ii.product_id IS NOT NULL
    AND s.branch_id = inv.branch_id
    AND s.arrival_date <= (inv.created_at)::date
  ORDER BY ii.id, s.arrival_date DESC, s.id DESC
)
UPDATE public.invoice_items ii
SET unit_cost_at_sale = picked.cost,
    original_unit_cost = COALESCE(ii.original_unit_cost, picked.cost)
FROM picked
WHERE ii.id = picked.id AND picked.cost > 0;

WITH fb AS (
  SELECT DISTINCT ON (ii.id)
    ii.id,
    COALESCE(si.true_unit_cost, si.cost_price, 0) AS cost
  FROM public.invoice_items ii
  JOIN public.shipment_items si ON si.product_id = ii.product_id
  JOIN public.shipments s ON s.id = si.shipment_id
  WHERE ii.unit_cost_at_sale = 0
    AND ii.product_id IS NOT NULL
  ORDER BY ii.id, s.arrival_date ASC
)
UPDATE public.invoice_items ii
SET unit_cost_at_sale = fb.cost,
    original_unit_cost = COALESCE(ii.original_unit_cost, fb.cost)
FROM fb
WHERE ii.id = fb.id AND fb.cost > 0;

-- ============================================================
-- 2) Stock transfer: create batch at destination on confirm
-- ============================================================
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
  avg_cost     numeric;
BEGIN
  SELECT * INTO t FROM public.stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found'; END IF;
  IF t.status <> 'pending' THEN RAISE EXCEPTION 'transfer_not_pending'; END IF;
  IF p_received IS NULL OR p_received < 0 OR p_received > t.quantity THEN
    RAISE EXCEPTION 'invalid_received_quantity (max %)', t.quantity;
  END IF;

  SELECT * INTO src FROM public.products WHERE id = t.product_id;

  SELECT CASE WHEN SUM(quantity_remaining) > 0
              THEN SUM(quantity_remaining * COALESCE(base_purchase_price, cost_price, 0)) / SUM(quantity_remaining)
              ELSE COALESCE(src.cost_price, 0)
         END
  INTO avg_cost
  FROM public.product_batches
  WHERE product_id = t.product_id AND branch_id = t.from_branch_id AND quantity_remaining > 0;

  avg_cost := COALESCE(avg_cost, COALESCE(src.cost_price, 0));

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
      ) RETURNING id INTO dest_id;
    END IF;

    INSERT INTO public.product_batches (
      product_id, branch_id, quantity_received, quantity_remaining,
      cost_price, base_purchase_price, batch_type, tenant_id
    ) VALUES (
      dest_id, t.to_branch_id, p_received, p_received,
      avg_cost, avg_cost, 'transfer', t.tenant_id
    );
  END IF;

  diff := t.quantity - p_received;
  IF diff > 0 THEN
    UPDATE public.products
       SET quantity = COALESCE(quantity, 0) + diff
     WHERE id = t.product_id;
    INSERT INTO public.product_batches (
      product_id, branch_id, quantity_received, quantity_remaining,
      cost_price, base_purchase_price, batch_type, tenant_id
    ) VALUES (
      t.product_id, t.from_branch_id, diff, diff,
      avg_cost, avg_cost, 'transfer_return', t.tenant_id
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

-- ============================================================
-- 3) Contact balance recompute
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalc_contact_balance(_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_type text;
  v_balance numeric := 0;
BEGIN
  SELECT type INTO c_type FROM public.contacts WHERE id = _contact_id;
  IF c_type IS NULL THEN RETURN; END IF;

  IF c_type = 'customer' THEN
    v_balance := v_balance + COALESCE((
      SELECT SUM(total) FROM public.invoices
       WHERE contact_id = _contact_id AND status = 'active'
    ), 0);
    v_balance := v_balance - COALESCE((
      SELECT SUM(ip.amount) FROM public.invoice_payments ip
       JOIN public.invoices i ON i.id = ip.invoice_id
       WHERE i.contact_id = _contact_id AND i.status = 'active'
    ), 0);
    v_balance := v_balance - COALESCE((
      SELECT SUM(COALESCE(r.total_refund, 0)) FROM public.returns r
       JOIN public.invoices i ON i.id = r.invoice_id
       WHERE i.contact_id = _contact_id
    ), 0);
    v_balance := v_balance - COALESCE((
      SELECT SUM(amount) FROM public.vouchers
       WHERE party_id = _contact_id AND party_type = 'customer'
         AND source = 'manual' AND status = 'active'
    ), 0);

  ELSIF c_type = 'supplier' THEN
    v_balance := v_balance - COALESCE((
      SELECT SUM(si.quantity * COALESCE(si.true_unit_cost, si.cost_price, 0))
        FROM public.shipments s
        JOIN public.shipment_items si ON si.shipment_id = s.id
       WHERE s.contact_id = _contact_id
    ), 0);
    v_balance := v_balance + COALESCE((
      SELECT SUM(amount) FROM public.supplier_payments WHERE contact_id = _contact_id
    ), 0);
    v_balance := v_balance + COALESCE((
      SELECT SUM(COALESCE(total_amount, 0)) FROM public.purchase_returns WHERE contact_id = _contact_id
    ), 0);
    v_balance := v_balance + COALESCE((
      SELECT SUM(CASE WHEN type='payment' THEN amount ELSE -amount END)
        FROM public.vouchers
       WHERE party_id = _contact_id AND party_type = 'supplier'
         AND source = 'manual' AND status = 'active'
    ), 0);
  END IF;

  UPDATE public.contacts SET balance = v_balance WHERE id = _contact_id;
END;
$$;

-- ============================================================
-- 4) Trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_refresh_contact_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_cid uuid;
  new_cid uuid;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    old_cid := (CASE WHEN TG_OP <> 'INSERT' THEN OLD.contact_id END);
    new_cid := (CASE WHEN TG_OP <> 'DELETE' THEN NEW.contact_id END);
  ELSIF TG_TABLE_NAME = 'invoice_payments' THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT contact_id INTO old_cid FROM public.invoices WHERE id = OLD.invoice_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT contact_id INTO new_cid FROM public.invoices WHERE id = NEW.invoice_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'returns' THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT contact_id INTO old_cid FROM public.invoices WHERE id = OLD.invoice_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT contact_id INTO new_cid FROM public.invoices WHERE id = NEW.invoice_id;
    END IF;
  ELSIF TG_TABLE_NAME IN ('shipments','supplier_payments','purchase_returns') THEN
    old_cid := (CASE WHEN TG_OP <> 'INSERT' THEN OLD.contact_id END);
    new_cid := (CASE WHEN TG_OP <> 'DELETE' THEN NEW.contact_id END);
  ELSIF TG_TABLE_NAME = 'vouchers' THEN
    old_cid := (CASE WHEN TG_OP <> 'INSERT' THEN OLD.party_id END);
    new_cid := (CASE WHEN TG_OP <> 'DELETE' THEN NEW.party_id END);
  ELSIF TG_TABLE_NAME = 'shipment_items' THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT contact_id INTO old_cid FROM public.shipments WHERE id = OLD.shipment_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT contact_id INTO new_cid FROM public.shipments WHERE id = NEW.shipment_id;
    END IF;
  END IF;

  IF old_cid IS NOT NULL THEN PERFORM public.recalc_contact_balance(old_cid); END IF;
  IF new_cid IS NOT NULL AND new_cid IS DISTINCT FROM old_cid THEN
    PERFORM public.recalc_contact_balance(new_cid);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================
-- 5) Attach triggers
-- ============================================================
DROP TRIGGER IF EXISTS trg_balance_invoices ON public.invoices;
CREATE TRIGGER trg_balance_invoices AFTER INSERT OR UPDATE OR DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_contact_balance();

DROP TRIGGER IF EXISTS trg_balance_invoice_payments ON public.invoice_payments;
CREATE TRIGGER trg_balance_invoice_payments AFTER INSERT OR UPDATE OR DELETE ON public.invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_contact_balance();

DROP TRIGGER IF EXISTS trg_balance_returns ON public.returns;
CREATE TRIGGER trg_balance_returns AFTER INSERT OR UPDATE OR DELETE ON public.returns
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_contact_balance();

DROP TRIGGER IF EXISTS trg_balance_shipments ON public.shipments;
CREATE TRIGGER trg_balance_shipments AFTER INSERT OR UPDATE OR DELETE ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_contact_balance();

DROP TRIGGER IF EXISTS trg_balance_shipment_items ON public.shipment_items;
CREATE TRIGGER trg_balance_shipment_items AFTER INSERT OR UPDATE OR DELETE ON public.shipment_items
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_contact_balance();

DROP TRIGGER IF EXISTS trg_balance_supplier_payments ON public.supplier_payments;
CREATE TRIGGER trg_balance_supplier_payments AFTER INSERT OR UPDATE OR DELETE ON public.supplier_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_contact_balance();

DROP TRIGGER IF EXISTS trg_balance_purchase_returns ON public.purchase_returns;
CREATE TRIGGER trg_balance_purchase_returns AFTER INSERT OR UPDATE OR DELETE ON public.purchase_returns
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_contact_balance();

DROP TRIGGER IF EXISTS trg_balance_vouchers ON public.vouchers;
CREATE TRIGGER trg_balance_vouchers AFTER INSERT OR UPDATE OR DELETE ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_contact_balance();

-- ============================================================
-- 6) Initial bulk recompute
-- ============================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.contacts LOOP
    PERFORM public.recalc_contact_balance(r.id);
  END LOOP;
END $$;
