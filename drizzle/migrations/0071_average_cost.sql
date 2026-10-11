-- 0071 — Moving average cost per branch (owner decision 2026-10-11, replaces FIFO for COST only).
-- Quantities still move exactly as before (batches stay for stock tracking); only the COST of what
-- leaves the stock changes: every unit leaving a branch costs the branch's moving average at that moment.
--   in  with a cost  : opening stock, purchase (landed unit cost), transfer in (sender's average),
--                      sale return (the cost it left with) → avg = (qty×avg + in_qty×in_cost) ÷ (qty + in_qty)
--                      (when the branch had nothing or was negative, the incoming cost becomes the average)
--   stock count up   : at the average (average unchanged); when there is no average yet, at the count's cost
--   out              : sale, purchase return, transfer out, stock count down → quantity only, average unchanged
-- The source of truth is the documents themselves (no stored cost history to drift); products.avg_cost
-- is a cache for reports, refreshed by triggers.

-- ---------------------------------------------------------------- indexes for the replay
CREATE INDEX IF NOT EXISTS idx_shipment_items_product ON public.shipment_items(product_id);
CREATE INDEX IF NOT EXISTS idx_return_items_product ON public.return_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_product ON public.purchase_return_items(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_product ON public.stock_transfers(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to_branch ON public.stock_transfers(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_product_batches_product_type ON public.product_batches(product_id, batch_type);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS avg_cost numeric(14,4);

-- ---------------------------------------------------------------- the cost ledger of one product row (= one product in one branch)
CREATE OR REPLACE FUNCTION public.product_cost_ledger(
  p_product uuid, p_until timestamptz DEFAULT 'infinity', p_skip_invoice uuid DEFAULT NULL)
RETURNS TABLE(ev_at timestamptz, kind text, ref_id uuid, qty numeric, unit_cost numeric,
              run_qty numeric, run_avg numeric, out_value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p record; e record;
  q numeric := 0; a numeric := NULL; c numeric;
BEGIN
  SELECT id, branch_id, name, cost_price INTO v_p FROM products WHERE id = p_product;
  IF NOT FOUND THEN RETURN; END IF;

  FOR e IN
    WITH ev AS (
      -- opening stock (in, with cost)
      SELECT coalesce(b.effective_at, b.created_at) AS e_at, 0 AS e_ord, 'opening'::text AS e_kind, b.id AS e_ref,
             b.quantity_purchased::numeric AS e_qty, b.cost_price::numeric AS e_cost
        FROM product_batches b WHERE b.product_id = p_product AND b.batch_type = 'opening_stock'
      UNION ALL
      -- purchases (in, landed unit cost)
      SELECT s.invoice_date, 1, 'purchase', s.id, si.quantity::numeric,
             coalesce(nullif(si.true_unit_cost, 0), nullif(si.cost_price, 0), 0)::numeric
        FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
       WHERE si.product_id = p_product AND coalesce(s.status, 'active') = 'active'
      UNION ALL
      -- transfers in (in, sender's average at that moment — filled below)
      SELECT (coalesce(t.transfer_date, (t.created_at AT TIME ZONE 'Africa/Cairo')::date) + time '12:00') AT TIME ZONE 'Africa/Cairo',
             1, 'transfer_in', t.id, t.received_quantity::numeric, NULL::numeric
        FROM stock_transfers t JOIN products src ON src.id = t.product_id
       WHERE t.to_branch_id = v_p.branch_id AND src.name = v_p.name AND t.product_id <> p_product
         AND t.status = 'confirmed' AND coalesce(t.received_quantity, 0) > 0
      UNION ALL
      -- sale returns (in, at the cost the goods left with)
      SELECT coalesce(r.invoice_date, r.created_at), 1, 'sale_return', r.id, ri.quantity::numeric,
             (SELECT nullif(ii.unit_cost_at_sale, 0) FROM invoice_items ii
               WHERE ii.invoice_id = r.invoice_id AND ii.product_id = p_product LIMIT 1)
        FROM return_items ri JOIN returns r ON r.id = ri.return_id
       WHERE ri.product_id = p_product AND coalesce(r.status, 'active') = 'active'
      UNION ALL
      -- stock count up (quantity only) — from the adjustment document
      SELECT sa.created_at, 1, 'count_in', sa.id, sai.difference::numeric, nullif(sai.unit_cost, 0)::numeric
        FROM stock_adjustment_items sai JOIN stock_adjustments sa ON sa.id = sai.adjustment_id
       WHERE sai.product_id = p_product AND sai.difference > 0
      UNION ALL
      -- sales (out)
      SELECT i.invoice_date, 2, 'sale', i.id, ii.quantity::numeric, nullif(ii.unit_cost_at_sale, 0)::numeric
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE ii.product_id = p_product AND i.status = 'active' AND i.id IS DISTINCT FROM p_skip_invoice
      UNION ALL
      -- purchase returns (out)
      SELECT coalesce(pr.invoice_date, pr.created_at), 2, 'purchase_return', pr.id, pri.quantity::numeric, NULL::numeric
        FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id = pri.purchase_return_id
       WHERE pri.product_id = p_product AND coalesce(pr.status, 'active') = 'active'
      UNION ALL
      -- transfers out (out; a rejected transfer comes back whole, a partly received one sends only what arrived)
      SELECT (coalesce(t.transfer_date, (t.created_at AT TIME ZONE 'Africa/Cairo')::date) + time '12:00') AT TIME ZONE 'Africa/Cairo',
             2, 'transfer_out', t.id,
             (CASE WHEN t.status = 'confirmed' THEN coalesce(t.received_quantity, t.quantity) ELSE t.quantity END)::numeric, NULL::numeric
        FROM stock_transfers t
       WHERE t.product_id = p_product AND t.status IN ('pending', 'confirmed')
      UNION ALL
      -- stock count down (out)
      SELECT sa.created_at, 2, 'count_out', sa.id, (-sai.difference)::numeric, NULL::numeric
        FROM stock_adjustment_items sai JOIN stock_adjustments sa ON sa.id = sai.adjustment_id
       WHERE sai.product_id = p_product AND sai.difference < 0
    )
    SELECT * FROM ev WHERE ev.e_at <= p_until AND ev.e_qty <> 0 ORDER BY ev.e_at, ev.e_ord, ev.e_ref
  LOOP
    IF e.e_ord < 2 THEN
      c := e.e_cost;
      IF e.e_kind = 'transfer_in' THEN
        c := public.product_avg_cost((SELECT product_id FROM stock_transfers WHERE id = e.e_ref), e.e_at - interval '1 microsecond');
      END IF;
      IF e.e_kind = 'count_in' AND a IS NOT NULL AND q > 0 THEN
        c := a; q := q + e.e_qty;                         -- stock found by a count: valued at the average, average unchanged
      ELSIF c IS NULL OR c <= 0 THEN
        q := q + e.e_qty;                                 -- quantity only
      ELSIF q <= 0 OR a IS NULL THEN
        a := c; q := q + e.e_qty;                            -- empty / negative stock: the new cost is the average
      ELSE
        a := round((q * a + e.e_qty * c) / (q + e.e_qty), 6); q := q + e.e_qty;
      END IF;
      ev_at := e.e_at; kind := e.e_kind; ref_id := e.e_ref; qty := e.e_qty; unit_cost := c;
      run_qty := q; run_avg := a; out_value := NULL;
    ELSE
      -- a sale leaves at the cost written on its line (= the average when it was sold); other outs at the average
      q := q - e.e_qty;
      ev_at := e.e_at; kind := e.e_kind; ref_id := e.e_ref; qty := -e.e_qty; unit_cost := coalesce(e.e_cost, a);
      run_qty := q; run_avg := a; out_value := round(e.e_qty * coalesce(e.e_cost, a, v_p.cost_price, 0), 2);
    END IF;
    RETURN NEXT;
  END LOOP;
END $$;

-- ---------------------------------------------------------------- the average at a moment
-- The average at a moment. Selling ahead of stock (nothing on hand, negative stock allowed): the goods that
-- will fill the gap are the ones sold, so the cost is the next incoming cost; until anything arrives, the
-- product's list cost.
CREATE OR REPLACE FUNCTION public.product_avg_cost(
  p_product uuid, p_as_of timestamptz DEFAULT now(), p_skip_invoice uuid DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_q numeric; v_a numeric; v_next numeric;
BEGIN
  SELECT l.run_qty, l.run_avg INTO v_q, v_a
    FROM public.product_cost_ledger(p_product, p_as_of, p_skip_invoice) WITH ORDINALITY AS l(ev_at, kind, ref_id, qty, unit_cost, run_qty, run_avg, out_value, seq)
   ORDER BY l.seq DESC LIMIT 1;
  IF v_a IS NULL OR coalesce(v_q, 0) <= 0 THEN
    SELECT l.unit_cost INTO v_next
      FROM public.product_cost_ledger(p_product, 'infinity', p_skip_invoice) l
     WHERE l.ev_at > p_as_of AND l.qty > 0 AND l.unit_cost > 0
     ORDER BY l.ev_at LIMIT 1;
    v_a := coalesce(v_next, v_a);
  END IF;
  RETURN round(coalesce(nullif(v_a, 0), nullif((SELECT cost_price FROM public.products WHERE id = p_product), 0), 0), 4);
END $$;

CREATE OR REPLACE FUNCTION public.refresh_product_avg_cost(p_product uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v numeric;
BEGIN
  IF p_product IS NULL THEN RETURN; END IF;
  v := public.product_avg_cost(p_product, 'infinity');
  UPDATE public.products SET avg_cost = v WHERE id = p_product AND avg_cost IS DISTINCT FROM v;
END $$;

-- ---------------------------------------------------------------- every sale line costs the branch average
CREATE OR REPLACE FUNCTION public.invoice_item_avg_cost_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_at timestamptz; v_avg numeric;
BEGIN
  SELECT coalesce(invoice_date, created_at, now()) INTO v_at FROM public.invoices WHERE id = NEW.invoice_id;
  v_avg := public.product_avg_cost(NEW.product_id, coalesce(v_at, now()), NEW.invoice_id);
  IF v_avg > 0 THEN
    NEW.unit_cost_at_sale := v_avg;
    NEW.cost_price := v_avg;
    NEW.original_unit_cost := v_avg;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER a1_invoice_item_avg_cost BEFORE INSERT ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.invoice_item_avg_cost_trg();

-- ---------------------------------------------------------------- keep the cached average fresh
CREATE OR REPLACE FUNCTION public.avg_cost_refresh_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF TG_TABLE_NAME = 'stock_transfers' THEN
    FOR r IN SELECT p.id FROM public.products p JOIN public.products src ON src.id = coalesce(NEW.product_id, OLD.product_id)
              WHERE p.id = src.id OR (p.branch_id = coalesce(NEW.to_branch_id, OLD.to_branch_id) AND p.name = src.name) LOOP
      PERFORM public.refresh_product_avg_cost(r.id);
    END LOOP;
  ELSIF TG_TABLE_NAME IN ('returns', 'purchase_returns', 'shipments', 'invoices') THEN
    FOR r IN
      SELECT ri.product_id id FROM public.return_items ri WHERE TG_TABLE_NAME = 'returns' AND ri.return_id = NEW.id
      UNION SELECT pri.product_id FROM public.purchase_return_items pri WHERE TG_TABLE_NAME = 'purchase_returns' AND pri.purchase_return_id = NEW.id
      UNION SELECT si.product_id FROM public.shipment_items si WHERE TG_TABLE_NAME = 'shipments' AND si.shipment_id = NEW.id
      UNION SELECT ii.product_id FROM public.invoice_items ii WHERE TG_TABLE_NAME = 'invoices' AND ii.invoice_id = NEW.id
    LOOP
      PERFORM public.refresh_product_avg_cost(r.id);
    END LOOP;
  ELSE
    PERFORM public.refresh_product_avg_cost(coalesce(NEW.product_id, OLD.product_id));
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER zz_avg_cost_refresh AFTER INSERT OR UPDATE OF quantity, cost_price, true_unit_cost OR DELETE ON public.shipment_items
  FOR EACH ROW EXECUTE FUNCTION public.avg_cost_refresh_trg();
CREATE OR REPLACE TRIGGER zz_avg_cost_refresh AFTER INSERT OR DELETE ON public.return_items
  FOR EACH ROW EXECUTE FUNCTION public.avg_cost_refresh_trg();
CREATE OR REPLACE TRIGGER zz_avg_cost_refresh AFTER INSERT OR DELETE ON public.purchase_return_items
  FOR EACH ROW EXECUTE FUNCTION public.avg_cost_refresh_trg();
CREATE OR REPLACE TRIGGER zz_avg_cost_refresh AFTER INSERT OR DELETE ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.avg_cost_refresh_trg();
CREATE OR REPLACE TRIGGER zz_avg_cost_refresh AFTER INSERT ON public.product_batches
  FOR EACH ROW WHEN (NEW.batch_type IN ('opening_stock', 'adjustment')) EXECUTE FUNCTION public.avg_cost_refresh_trg();
CREATE OR REPLACE TRIGGER zz_avg_cost_refresh AFTER INSERT OR UPDATE OF status, received_quantity ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.avg_cost_refresh_trg();
CREATE OR REPLACE TRIGGER zz_avg_cost_refresh AFTER UPDATE OF status ON public.returns
  FOR EACH ROW EXECUTE FUNCTION public.avg_cost_refresh_trg();
CREATE OR REPLACE TRIGGER zz_avg_cost_refresh AFTER UPDATE OF status ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.avg_cost_refresh_trg();
CREATE OR REPLACE TRIGGER zz_avg_cost_refresh AFTER UPDATE OF status, invoice_date ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.avg_cost_refresh_trg();
CREATE OR REPLACE TRIGGER zz_avg_cost_refresh AFTER UPDATE OF status, invoice_date ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.avg_cost_refresh_trg();

-- internal helpers: never called from the browser
REVOKE ALL ON FUNCTION public.product_cost_ledger(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.product_avg_cost(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_product_avg_cost(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoice_item_avg_cost_trg() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.avg_cost_refresh_trg() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- one-off / maintenance: re-cost sales at the branch average
-- Re-costs every active sale line dated in [p_from, p_to] (in date order, so sale returns pick up the
-- re-costed figure); the invoice_items COGS trigger re-posts each touched invoice's COGS entry. Service role only.
CREATE OR REPLACE FUNCTION public.recompute_average_costs(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_avg numeric; n int := 0; d numeric := 0; v_inv uuid[] := '{}';
BEGIN
  FOR r IN
    SELECT ii.id, ii.invoice_id, ii.product_id, i.invoice_date,
           coalesce(nullif(ii.unit_cost_at_sale, 0), ii.cost_price, 0) AS old_cost,
           coalesce(ii.net_quantity, ii.quantity - coalesce(ii.returned_quantity, 0)) AS net_q
      FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
     WHERE i.status = 'active'
       AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to
     ORDER BY i.invoice_date, i.id, ii.id
  LOOP
    v_avg := public.product_avg_cost(r.product_id, r.invoice_date, r.invoice_id);
    IF v_avg > 0 AND round(v_avg, 4) IS DISTINCT FROM round(r.old_cost, 4) THEN
      UPDATE invoice_items SET unit_cost_at_sale = v_avg, cost_price = v_avg, original_unit_cost = v_avg WHERE id = r.id;
      n := n + 1; d := d + (v_avg - r.old_cost) * r.net_q;
      v_inv := v_inv || r.invoice_id;
    END IF;
  END LOOP;
  PERFORM public.post_invoice_cogs(x) FROM (SELECT DISTINCT unnest(v_inv) x) z;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'lines_recosted', n,
                            'invoices_reposted', (SELECT count(DISTINCT x) FROM unnest(v_inv) x), 'cogs_change', round(d, 2));
END $$;
REVOKE ALL ON FUNCTION public.recompute_average_costs(date, date) FROM PUBLIC, anon, authenticated;
