-- 0134: editing a purchase invoice re-costs the sales after it (owner «نفذ», 2026-10-30)
--
-- Cost of goods is the branch moving average (0071) and every sale line keeps the cost it had when it was saved.
-- Editing a purchase (price, quantity, discount, extras) or moving its date changed the average for what is still in
-- stock, but the pieces already sold kept the old cost, so the difference was lost.
-- Example: buy 10 fridges × 10,000, sell 5 at 12,000 (cost 50,000, profit 10,000), then correct the purchase to
-- 9,000. Before: the 5 sold kept 10,000 each (profit 10,000) while the 5 in stock went to 9,000 — 5,000 vanished.
-- Now: the 5 sold are re-costed to 9,000 (profit 15,000), their cost-of-goods entry is re-posted on the invoice day,
-- and a return of one of them brings back 9,000.
--
-- recost_product_sales(products, from): every active 2026 sale line of those products dated on/after `from` gets
-- product_avg_cost at its own moment again (chronological, so a return of an earlier sale feeds the later ones),
-- then the COGS entry of each changed invoice is re-posted (post_invoice_cogs, invoice day) and the journal of every
-- active return of those invoices is synced (sync_sale_return_journal, return day). Products of other branches that
-- received the item by a stock transfer on/after `from` are included (a transfer comes in at the sender's average).
-- Archive invoices (before 2026) and invoices in a closed fiscal period are left alone. A line with no known cost
-- (average 0) keeps what it has. Internal helper: called by edit_shipment and update_shipment_date only.

CREATE OR REPLACE FUNCTION public.recost_product_sales(p_products uuid[], p_from timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_set uuid[]; v_next uuid[]; v_day date; r record; v_avg numeric; v_round int := 0;
  n int := 0; d numeric := 0; v_inv uuid[] := '{}'; v_ret int := 0;
BEGIN
  IF p_products IS NULL OR p_from IS NULL THEN
    RETURN jsonb_build_object('lines_recosted', 0, 'invoices_reposted', 0, 'returns_reposted', 0, 'cogs_change', 0);
  END IF;
  v_day := (p_from AT TIME ZONE 'Africa/Cairo')::date;
  SELECT array_agg(DISTINCT x) INTO v_set FROM unnest(p_products) x WHERE x IS NOT NULL;
  IF v_set IS NULL THEN
    RETURN jsonb_build_object('lines_recosted', 0, 'invoices_reposted', 0, 'returns_reposted', 0, 'cogs_change', 0);
  END IF;

  -- the branches that received these products by transfer from that day on (same matching as product_cost_ledger)
  LOOP
    v_round := v_round + 1;
    SELECT array_agg(DISTINCT dst.id) INTO v_next
      FROM public.stock_transfers t
      JOIN public.products src ON src.id = t.product_id
      JOIN public.products dst ON dst.branch_id = t.to_branch_id AND dst.name = src.name AND dst.id <> src.id
     WHERE t.product_id = ANY (v_set) AND t.status = 'confirmed' AND coalesce(t.received_quantity, 0) > 0
       AND coalesce(t.transfer_date, (t.created_at AT TIME ZONE 'Africa/Cairo')::date) >= v_day
       AND NOT (dst.id = ANY (v_set));
    EXIT WHEN v_next IS NULL OR v_round > 5;
    v_set := v_set || v_next;
  END LOOP;

  FOR r IN
    SELECT ii.id, ii.invoice_id, ii.product_id, i.invoice_date, ii.quantity,
           coalesce(nullif(ii.unit_cost_at_sale, 0), ii.cost_price, 0) AS old_cost
      FROM public.invoice_items ii
      JOIN public.invoices i ON i.id = ii.invoice_id
     WHERE ii.product_id = ANY (v_set)
       AND i.status = 'active'
       AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date >= v_day
       AND NOT public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id)
       AND NOT EXISTS (SELECT 1 FROM public.fiscal_periods fp
                        WHERE fp.tenant_id = i.tenant_id AND fp.status = 'closed'
                          AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date BETWEEN fp.period_start AND fp.period_end)
     ORDER BY i.invoice_date, i.id, ii.id
  LOOP
    v_avg := public.product_avg_cost(r.product_id, r.invoice_date, r.invoice_id);
    IF v_avg > 0 AND round(v_avg, 4) IS DISTINCT FROM round(r.old_cost, 4) THEN
      UPDATE public.invoice_items
         SET unit_cost_at_sale = v_avg, cost_price = v_avg, original_unit_cost = v_avg
       WHERE id = r.id;
      n := n + 1;
      d := d + (v_avg - r.old_cost) * r.quantity;
      v_inv := v_inv || r.invoice_id;
    END IF;
  END LOOP;

  PERFORM public.post_invoice_cogs(x) FROM (SELECT DISTINCT unnest(v_inv) x) z;

  FOR r IN SELECT rt.id FROM public.returns rt
            WHERE rt.invoice_id = ANY (v_inv) AND coalesce(rt.status, 'active') = 'active' LOOP
    PERFORM public.sync_sale_return_journal(r.id);
    v_ret := v_ret + 1;
  END LOOP;

  PERFORM public.refresh_product_avg_cost(x) FROM unnest(v_set) x;

  RETURN jsonb_build_object('lines_recosted', n,
                            'invoices_reposted', (SELECT count(DISTINCT x) FROM unnest(v_inv) x),
                            'returns_reposted', v_ret,
                            'cogs_change', round(d, 2));
END $function$;

REVOKE ALL ON FUNCTION public.recost_product_sales(uuid[], timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recost_product_sales(uuid[], timestamptz) TO service_role;

-- edit_shipment: remember the lines' products before the edit, re-cost old + new products from the invoice day
DO $mig$
DECLARE v_def text;
  m1 text := 'v_vat_type text; v_vat_value numeric; v_vat numeric := 0;';
  m2 text := E'SELECT * INTO v_ship FROM shipments WHERE id = p_shipment_id;\n  IF NOT FOUND THEN RAISE EXCEPTION ''الشحنة غير موجودة''; END IF;';
  m3 text := E'  RETURN jsonb_build_object(''total'', v_total, ''items_net'', v_items_net';
BEGIN
  v_def := pg_get_functiondef('public.edit_shipment(uuid, jsonb, jsonb)'::regprocedure);
  IF position(m1 IN v_def) = 0 OR position(m2 IN v_def) = 0 OR position(m3 IN v_def) = 0
     OR position('recost_product_sales' IN v_def) > 0 THEN
    RAISE EXCEPTION '0134: edit_shipment is not the expected version';
  END IF;
  v_def := replace(v_def, m1, m1 || E'\n  v_recost_pids uuid[];');
  v_def := replace(v_def, m2, m2 || E'\n  -- 0134: products of the lines before the edit (a removed line re-costs too)\n'
    || E'  v_recost_pids := ARRAY(SELECT si.product_id FROM shipment_items si WHERE si.shipment_id = p_shipment_id AND si.product_id IS NOT NULL);');
  v_def := replace(v_def, m3,
    E'  -- 0134: the sales after this purchase take the new average (old and new products, from the invoice day)\n'
    || E'  PERFORM public.recost_product_sales(\n'
    || E'    v_recost_pids || ARRAY(SELECT si.product_id FROM shipment_items si WHERE si.shipment_id = p_shipment_id AND si.product_id IS NOT NULL),\n'
    || E'    v_ship.invoice_date);\n\n' || m3);
  EXECUTE v_def;
END
$mig$;

-- update_shipment_date: moving a purchase moves the average timeline — re-cost from the earlier of the two days
DO $mig$
DECLARE v_def text;
  m text := 'UPDATE public.shipments SET invoice_date = p_new_date WHERE id = s.id;   -- journal re-posted by trigger';
BEGIN
  v_def := pg_get_functiondef('public.update_shipment_date(uuid, timestamptz, text)'::regprocedure);
  IF position(m IN v_def) = 0 OR position('recost_product_sales' IN v_def) > 0 THEN
    RAISE EXCEPTION '0134: update_shipment_date is not the expected version';
  END IF;
  v_def := replace(v_def, m, m || E'\n  -- 0134: the sales from the earlier of the two days take the new average\n'
    || E'  PERFORM public.recost_product_sales(ARRAY(SELECT si.product_id FROM public.shipment_items si\n'
    || E'                                             WHERE si.shipment_id = s.id AND si.product_id IS NOT NULL),\n'
    || E'                                       LEAST(s.invoice_date, p_new_date));');
  EXECUTE v_def;
END
$mig$;
