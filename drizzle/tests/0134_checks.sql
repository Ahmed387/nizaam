-- 0134 checks — rollback-only (ends with RAISE). Run after migration 0134 (or with its text pasted above for a dry-run).
-- Edits PO00202 (عبدالمنعم, مروحة حائط WFJ211, 5 × 1,825 on 4/3) to 1,500, then moves it to 20/3, and checks that
-- every sale line of the product after it carries the average at its own moment, the COGS / return entries follow,
-- products.avg_cost is refreshed, no other product moved, and no sequence was burned.
DO $t$
DECLARE
  v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  v_ship uuid := 'f8793fb4-74f0-4730-8287-2c27dcc98717';
  v_item uuid := '5d0cc9a8-06be-49d5-866c-72a918d9e099';
  v_prod uuid := '8e4d2ff4-1b05-4a40-ab33-7c0179fc2f91';
  v_seq jsonb; v_seq_after jsonb; r record; v_res jsonb; v_res2 jsonb;
  c1 int; c1_changed int; c2 int; c3 int; c4 int; c5 int; c6 int; v_cogs_before numeric; v_cogs_after numeric;
BEGIN
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq FROM pg_sequences WHERE schemaname = 'public';
  CREATE TEMP TABLE t0134_before ON COMMIT DROP AS
    SELECT ii.id, ii.product_id, ii.invoice_id, coalesce(nullif(ii.unit_cost_at_sale, 0), ii.cost_price, 0) AS cost, ii.quantity
      FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.status = 'active';
  SELECT coalesce(sum(cost * quantity), 0) INTO v_cogs_before FROM t0134_before WHERE product_id = v_prod;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- 1) price 1,825 → 1,500
  v_res := public.edit_shipment(v_ship,
    jsonb_build_object('received_by', 'د/ نور ناصر', 'shipping_cost', 0, 'customs_cost', 0, 'other_cost', 0, 'admin_cost', 0,
                       'discount_type', 'amount', 'discount_value', 0, 'vat_type', 'percent', 'vat_value', 0, 'notes', ''),
    jsonb_build_array(jsonb_build_object('id', v_item, 'product_id', v_prod, 'product_name',
      'مروحة حائط جامبو بريفكس، 21 بوصة، 3 سرعات، بالريموت ,WFJ211 - اسود', 'quantity', 5, 'cost_price', 1500,
      'discount_percent', 0, 'discount_amount', 0)));

  -- C1: every 2026 sale line of the product on/after 4/3 = its average at its own moment
  SELECT count(*) FILTER (WHERE abs(coalesce(nullif(ii.unit_cost_at_sale, 0), ii.cost_price, 0)
                                    - public.product_avg_cost(ii.product_id, i.invoice_date, i.id)) > 0.01)
    INTO c1
    FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
   WHERE ii.product_id = v_prod AND i.status = 'active' AND i.invoice_date >= '2026-03-04';
  SELECT count(*) INTO c1_changed FROM invoice_items ii JOIN t0134_before b ON b.id = ii.id
   WHERE ii.product_id = v_prod AND abs(coalesce(nullif(ii.unit_cost_at_sale, 0), ii.cost_price, 0) - b.cost) > 0.01;
  SELECT coalesce(sum(coalesce(nullif(ii.unit_cost_at_sale, 0), ii.cost_price, 0) * ii.quantity), 0) INTO v_cogs_after
    FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE ii.product_id = v_prod AND i.status = 'active';

  -- C2: each changed invoice's COGS entry = Σ qty × cost of its lines
  SELECT count(*) INTO c2 FROM (
    SELECT i.id, (SELECT sum(coalesce(nullif(x.unit_cost_at_sale, 0), x.cost_price, 0) * x.quantity) FROM invoice_items x WHERE x.invoice_id = i.id) AS want,
           (SELECT sum(jel.debit) FROM journal_entries je JOIN journal_entry_lines jel ON jel.entry_id = je.id
             JOIN chart_of_accounts c ON c.id = jel.account_id
             WHERE je.source_type = 'invoice_cogs' AND je.source_id = i.id AND c.code = '5100') AS got
      FROM invoices i WHERE i.id IN (SELECT DISTINCT ii.invoice_id FROM invoice_items ii JOIN t0134_before b ON b.id = ii.id
                                      WHERE abs(coalesce(nullif(ii.unit_cost_at_sale, 0), ii.cost_price, 0) - b.cost) > 0.01)) q
   WHERE abs(coalesce(want, 0) - coalesce(got, 0)) > 0.01;

  -- C3: active returns of the product: journal 1300 debit = sale_return_cost
  SELECT count(*) INTO c3 FROM returns rt
   WHERE coalesce(rt.status, 'active') = 'active'
     AND EXISTS (SELECT 1 FROM return_items ri WHERE ri.return_id = rt.id AND ri.product_id = v_prod)
     AND abs(public.sale_return_cost(rt.id) - coalesce((SELECT sum(jel.debit) FROM journal_entries je
           JOIN journal_entry_lines jel ON jel.entry_id = je.id JOIN chart_of_accounts c ON c.id = jel.account_id
           WHERE je.source_type = 'sale_return' AND je.source_id = rt.id AND c.code = '1300'), 0)) > 0.01;

  -- C4: products.avg_cost cache refreshed
  SELECT count(*) INTO c4 FROM products p WHERE p.id = v_prod AND abs(coalesce(p.avg_cost, 0) - public.product_avg_cost(p.id, 'infinity')) > 0.01;

  -- C5: no line of another product changed
  SELECT count(*) INTO c5 FROM invoice_items ii JOIN t0134_before b ON b.id = ii.id
   WHERE ii.product_id IS DISTINCT FROM v_prod
     AND abs(coalesce(nullif(ii.unit_cost_at_sale, 0), ii.cost_price, 0) - b.cost) > 0.01
     AND ii.product_id NOT IN (SELECT dst.id FROM stock_transfers t JOIN products src ON src.id = t.product_id
                                JOIN products dst ON dst.branch_id = t.to_branch_id AND dst.name = src.name
                               WHERE t.product_id = v_prod);

  -- 2) move the purchase from 4/3 to 20/3: lines from 4/3 follow again
  v_res2 := public.update_shipment_date(v_ship, '2026-03-20 12:00+02', '0134 check');
  SELECT count(*) INTO c6
    FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
   WHERE ii.product_id = v_prod AND i.status = 'active' AND i.invoice_date >= '2026-03-04'
     AND public.product_avg_cost(ii.product_id, i.invoice_date, i.id) > 0
     AND abs(coalesce(nullif(ii.unit_cost_at_sale, 0), ii.cost_price, 0)
             - public.product_avg_cost(ii.product_id, i.invoice_date, i.id)) > 0.01;

  -- sequences: put back anything the run burned (setval is not transactional)
  FOR r IN SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' LOOP
    IF (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS DISTINCT FROM r.last_value::text THEN
      IF v_seq ? (r.schemaname || '.' || r.sequencename) AND (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS NOT NULL THEN
        PERFORM setval(format('%I.%I', r.schemaname, r.sequencename), (v_seq ->> (r.schemaname || '.' || r.sequencename))::bigint);
      END IF;
    END IF;
  END LOOP;
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq_after FROM pg_sequences WHERE schemaname = 'public';

  RAISE EXCEPTION '0134 CHECKS %', jsonb_build_object(
    'C1_lines_not_at_their_average', c1, 'lines_recosted', c1_changed,
    'product_cogs_before', round(v_cogs_before, 2), 'product_cogs_after', round(v_cogs_after, 2),
    'C2_cogs_entries_wrong', c2, 'C3_return_entries_wrong', c3, 'C4_avg_cache_wrong', c4,
    'C5_other_products_changed', c5, 'C6_after_date_move_wrong', c6,
    'C7_sequences_same', v_seq = v_seq_after, 'edit_result', v_res, 'date_result', v_res2);
END
$t$;
