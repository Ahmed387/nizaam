
-- 1) Add legacy_code to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS legacy_code TEXT;
CREATE INDEX IF NOT EXISTS idx_products_legacy_code ON public.products(legacy_code) WHERE legacy_code IS NOT NULL;

-- 2) Build product_batches from shipment_items (only for the target branch, idempotent)
DO $$
DECLARE
  v_branch UUID := '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213';
  v_tenant UUID := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
BEGIN
  -- Wipe any prior partial batches for this branch to keep it idempotent
  DELETE FROM public.product_batches WHERE branch_id = v_branch;

  INSERT INTO public.product_batches
    (tenant_id, branch_id, product_id, shipment_id,
     quantity_purchased, quantity_remaining, cost_price,
     base_purchase_price, shipping_cost_per_unit, true_unit_cost,
     created_at, batch_type)
  SELECT
    v_tenant, v_branch, si.product_id, si.shipment_id,
    si.quantity, si.quantity, si.cost_price,
    si.cost_price, 0, si.cost_price,
    s.arrival_date::timestamp,
    'purchase'
  FROM public.shipment_items si
  JOIN public.shipments s ON s.id = si.shipment_id
  WHERE s.branch_id = v_branch AND si.product_id IS NOT NULL;
END $$;

-- 3) FIFO consumption: walk every consume/restore event for each product in date order
CREATE OR REPLACE FUNCTION public.tmp_apply_fifo_for_branch(_branch_id UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev RECORD;
  bat RECORD;
  remaining NUMERIC;
  take NUMERIC;
BEGIN
  FOR ev IN
    -- sales = consume (negative remaining), purchase returns = consume, sale returns = restore
    SELECT product_id, evt_date, qty, kind FROM (
      SELECT ii.product_id, COALESCE(i.created_at::date, CURRENT_DATE) AS evt_date,
             ii.quantity::numeric AS qty, 'sale'::text AS kind, i.created_at AS ts, ii.id AS seq
      FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.branch_id = _branch_id AND i.status='active' AND ii.product_id IS NOT NULL
      UNION ALL
      SELECT pri.product_id, COALESCE(pr.created_at::date, CURRENT_DATE),
             pri.quantity::numeric, 'p_return', pr.created_at, pri.id
      FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id = pri.purchase_return_id
      WHERE pr.branch_id = _branch_id AND pr.status='active'
      UNION ALL
      SELECT ri.product_id, COALESCE(r.created_at::date, CURRENT_DATE),
             ri.quantity::numeric, 's_return', r.created_at, ri.id
      FROM return_items ri JOIN returns r ON r.id = ri.return_id
      WHERE r.branch_id = _branch_id AND r.status='active' AND ri.product_id IS NOT NULL
    ) x
    ORDER BY product_id, evt_date, ts, seq
  LOOP
    IF ev.kind IN ('sale','p_return') THEN
      remaining := ev.qty;
      FOR bat IN
        SELECT id, quantity_remaining FROM product_batches
        WHERE product_id = ev.product_id AND branch_id = _branch_id AND quantity_remaining > 0
        ORDER BY created_at ASC, id ASC
      LOOP
        EXIT WHEN remaining <= 0;
        take := LEAST(bat.quantity_remaining, remaining);
        UPDATE product_batches SET quantity_remaining = quantity_remaining - take WHERE id = bat.id;
        remaining := remaining - take;
      END LOOP;
      -- if remaining > 0: oversold — silently absorb (data inconsistency in legacy)
    ELSE
      -- s_return: restore LIFO into most recent consumed batch
      remaining := ev.qty;
      FOR bat IN
        SELECT id, quantity_purchased, quantity_remaining FROM product_batches
        WHERE product_id = ev.product_id AND branch_id = _branch_id
          AND quantity_remaining < quantity_purchased
        ORDER BY created_at DESC, id DESC
      LOOP
        EXIT WHEN remaining <= 0;
        take := LEAST(bat.quantity_purchased - bat.quantity_remaining, remaining);
        UPDATE product_batches SET quantity_remaining = quantity_remaining + take,
               last_restored_at = now(), restore_count = restore_count + 1
        WHERE id = bat.id;
        remaining := remaining - take;
      END LOOP;
    END IF;
  END LOOP;
END $$;

SELECT public.tmp_apply_fifo_for_branch('7a9f9e1b-d6ae-47c0-9965-bf23d0d31213');
DROP FUNCTION public.tmp_apply_fifo_for_branch(UUID);

-- 4) Update products.quantity and cost_price from remaining batches
WITH agg AS (
  SELECT product_id,
         GREATEST(SUM(quantity_remaining)::int, 0) AS qty,
         CASE WHEN SUM(quantity_remaining) > 0
              THEN SUM(quantity_remaining * cost_price) / NULLIF(SUM(quantity_remaining),0)
              ELSE NULL END AS wac
  FROM public.product_batches
  WHERE branch_id = '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213'
  GROUP BY product_id
)
UPDATE public.products p
SET quantity   = COALESCE(agg.qty, 0),
    cost_price = COALESCE(agg.wac, p.cost_price)
FROM agg
WHERE p.id = agg.product_id
  AND p.branch_id = '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213';
