-- 0179: owner 2026-11-07 «خليهم كلهم بالقطعه … الكرتونة عبارة عن 3 مراوح» and «أحكم بالسعر مش بالكلمة … موافق».
-- The «سهل» import (`sahl_import.lines`, cfg_unit3) multiplied EVERY line of seven ceiling-fan codes by 3 (1048 كاسيل,
-- 1235 جنرال تك, 1253 نوفا, 1423 نيو ناتشيوني, 143 / 922 تورنيدو, 1478 حجازي), also the lines «سهل» already had in pieces
-- (and the unlabelled ones, and three 922 lines labelled «كرتونة» at a piece price). Those lines have a unit price about
-- a third of the fan's piece price; their quantity is divided by 3 and their unit price multiplied by 3 — every line
-- total, document total, payment, till and ledger stays exactly as it is. Lines: 95 sale (93 invoices), 56 purchase
-- (55), 1 sale return, 17 purchase returns, and عبدالمنعم's opening of 1048 (6 → 2) and 1235 (36 → 12), whose value
-- (qty × cost) is unchanged. A line is «third» when its unit value < 0.6 × the fan's piece price (1048 1,233,
-- 1235 1,000, 1253 1,100, 1423 1,050, 143 1,685, 1478 1,940, 922 1,570 — the median «قطعة» price in the files).
-- With the user triggers of the touched tables off for the rewrite only: the lines, their stock movements (quantity
-- ÷ 3), the purchase / opening batches (purchased ÷ 3, remaining lowered by the same pieces, never below 0), the
-- returned quantities of the sale lines, and products.quantity moved by exactly the pieces taken off. Then every 2026
-- sale of the seven codes is re-costed (`recost_product_sales`: COGS re-posted, returns re-synced) and cost_price =
-- average. Check: per row, quantity = Σ cost-ledger quantities when it was equal before (raises otherwise).
-- Running it again finds nothing (the fixed lines are no longer at a third of the price).
-- Dry-run (owner «نفذ وارفع» after seeing it): no fan below zero (عبدالمنعم 1423 −16 → 2, شلبى 1478 2,070 → 0);
-- sale / purchase totals unchanged to the piaster; net profit 1/1–28/10 2,087,594.77 → 641,666.39 — شلبى's 1478:
-- 1,272 fans bought for 2,148,491 (≈ 1,689 each) and 1,294 sold for 2,210,800, while the ×3 showed 3,348 bought at
-- ≈ 570, 1.47M profit on that fan and 2,070 fans in stock that never existed.
CREATE TEMP TABLE fan_ref (sku text PRIMARY KEY, piece numeric) ON COMMIT DROP;
INSERT INTO fan_ref VALUES ('1048', 1233), ('1235', 1000), ('1253', 1100), ('1423', 1050), ('143', 1685), ('1478', 1940), ('922', 1570);

DO $mig$
DECLARE v_t uuid; v_owner uuid; v_ids uuid[]; r record; v_before jsonb; v_led numeric;
BEGIN
  SELECT tenant_id INTO v_t FROM public.branches WHERE code = 'FR-005';
  IF v_t IS NULL THEN RETURN; END IF;
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id
   WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  SELECT array_agg(p.id) INTO v_ids FROM public.products p JOIN fan_ref f ON f.sku = p.sku WHERE p.tenant_id = v_t;

  -- which rows had their stock log equal to their balance before (those must stay equal)
  SELECT jsonb_object_agg(p.id::text, (SELECT coalesce(sum(qty), 0) FROM public.product_cost_ledger(p.id)) = p.quantity)
    INTO v_before FROM public.products p WHERE p.id = ANY (v_ids);

  CREATE TEMP TABLE fan_fix (kind text, line uuid, doc uuid, product uuid, old_q int, new_q int, sign int) ON COMMIT DROP;
  INSERT INTO fan_fix
  SELECT 'sale', ii.id, ii.invoice_id, ii.product_id, ii.quantity, ii.quantity / 3, 1
    FROM public.invoice_items ii JOIN public.invoices i ON i.id = ii.invoice_id JOIN public.products p ON p.id = ii.product_id
    JOIN fan_ref f ON f.sku = p.sku
   WHERE i.status = 'active' AND p.tenant_id = v_t AND ii.quantity % 3 = 0 AND ii.total / nullif(ii.quantity, 0) < 0.6 * f.piece
  UNION ALL
  SELECT 'purchase', si.id, si.shipment_id, si.product_id, si.quantity, si.quantity / 3, -1
    FROM public.shipment_items si JOIN public.shipments s ON s.id = si.shipment_id JOIN public.products p ON p.id = si.product_id
    JOIN fan_ref f ON f.sku = p.sku
   WHERE s.status = 'active' AND p.tenant_id = v_t AND si.quantity % 3 = 0 AND si.cost_price < 0.6 * f.piece
  UNION ALL
  SELECT 'sale_return', ri.id, ri.return_id, ri.product_id, ri.quantity, ri.quantity / 3, -1
    FROM public.return_items ri JOIN public.returns rt ON rt.id = ri.return_id JOIN public.products p ON p.id = ri.product_id
    JOIN fan_ref f ON f.sku = p.sku
   WHERE rt.status = 'active' AND p.tenant_id = v_t AND ri.quantity % 3 = 0 AND ri.refund / nullif(ri.quantity, 0) < 0.6 * f.piece
  UNION ALL
  SELECT 'purchase_return', pri.id, pri.purchase_return_id, pri.product_id, pri.quantity, pri.quantity / 3, 1
    FROM public.purchase_return_items pri JOIN public.purchase_returns pr ON pr.id = pri.purchase_return_id
    JOIN public.products p ON p.id = pri.product_id JOIN fan_ref f ON f.sku = p.sku
   WHERE pr.status = 'active' AND p.tenant_id = v_t AND pri.quantity % 3 = 0 AND pri.unit_cost < 0.6 * f.piece
  UNION ALL
  SELECT 'opening', pb.id, NULL, pb.product_id, pb.quantity_purchased::int, (pb.quantity_purchased / 3)::int, -1
    FROM public.product_batches pb JOIN public.products p ON p.id = pb.product_id JOIN fan_ref f ON f.sku = p.sku
   WHERE pb.batch_type = 'opening' AND p.tenant_id = v_t AND pb.quantity_purchased::int % 3 = 0 AND pb.cost_price < 0.6 * f.piece;

  ALTER TABLE public.invoice_items DISABLE TRIGGER USER;          ALTER TABLE public.shipment_items DISABLE TRIGGER USER;
  ALTER TABLE public.purchase_return_items DISABLE TRIGGER USER;  ALTER TABLE public.return_items DISABLE TRIGGER USER;
  ALTER TABLE public.product_batches DISABLE TRIGGER USER;        ALTER TABLE public.stock_movements DISABLE TRIGGER USER;
  ALTER TABLE public.products DISABLE TRIGGER USER;

  UPDATE public.invoice_items ii SET quantity = x.new_q,
         selling_price = round(ii.total + coalesce(ii.line_discount, 0), 2) / x.new_q,
         final_price = CASE WHEN ii.final_price IS NULL THEN NULL ELSE ii.final_price * 3 END,
         original_price = CASE WHEN ii.original_price IS NULL THEN NULL ELSE ii.original_price * 3 END,
         market_price = coalesce(ii.market_price, 0) * 3
    FROM fan_fix x WHERE x.kind = 'sale' AND ii.id = x.line;
  UPDATE public.shipment_items si SET quantity = x.new_q, cost_price = si.cost_price * 3,
         base_unit_price = CASE WHEN si.base_unit_price IS NULL THEN NULL ELSE si.base_unit_price * 3 END,
         true_unit_cost = CASE WHEN si.true_unit_cost IS NULL THEN NULL ELSE si.true_unit_cost * 3 END,
         shipping_cost_per_unit = coalesce(si.shipping_cost_per_unit, 0) * 3
    FROM fan_fix x WHERE x.kind = 'purchase' AND si.id = x.line;
  UPDATE public.product_batches pb SET quantity_purchased = pb.quantity_purchased - (x.old_q - x.new_q),
         quantity_remaining = greatest(pb.quantity_remaining - (x.old_q - x.new_q), 0),
         cost_price = pb.cost_price * 3, base_purchase_price = coalesce(pb.base_purchase_price, 0) * 3,
         true_unit_cost = coalesce(pb.true_unit_cost, 0) * 3, shipping_cost_per_unit = coalesce(pb.shipping_cost_per_unit, 0) * 3
    FROM fan_fix x WHERE x.kind = 'purchase' AND pb.shipment_id = x.doc AND pb.product_id = x.product;
  UPDATE public.product_batches pb SET quantity_purchased = x.new_q,
         quantity_remaining = greatest(pb.quantity_remaining - (x.old_q - x.new_q), 0),
         cost_price = pb.cost_price * 3, base_purchase_price = coalesce(pb.base_purchase_price, 0) * 3,
         true_unit_cost = coalesce(pb.true_unit_cost, 0) * 3
    FROM fan_fix x WHERE x.kind = 'opening' AND pb.id = x.line;
  UPDATE public.return_items ri SET quantity = x.new_q FROM fan_fix x WHERE x.kind = 'sale_return' AND ri.id = x.line;
  UPDATE public.purchase_return_items pri SET quantity = x.new_q, unit_cost = pri.unit_cost * 3
    FROM fan_fix x WHERE x.kind = 'purchase_return' AND pri.id = x.line;

  -- stock movements of those lines: same document, same product, the old quantity → the new one
  UPDATE public.stock_movements sm SET quantity = sign(sm.quantity) * x.new_q
    FROM fan_fix x WHERE x.kind <> 'opening' AND sm.reference_id = x.doc AND sm.product_id = x.product AND abs(sm.quantity) = x.old_q;
  UPDATE public.stock_movements sm SET quantity = sign(sm.quantity) * x.new_q
    FROM fan_fix x JOIN public.product_batches pb ON pb.id = x.line
   WHERE x.kind = 'opening' AND sm.product_id = x.product AND abs(sm.quantity) = x.old_q
     AND sm.movement_date = pb.effective_at;

  -- what came back on each sale line of the seven codes
  UPDATE public.invoice_items ii SET returned_quantity = least(ii.quantity, coalesce(rq.q, 0)),   -- net_quantity is generated
         fully_returned = coalesce(rq.q, 0) >= ii.quantity
    FROM (SELECT ii2.id, (SELECT sum(ri.quantity) FROM public.return_items ri JOIN public.returns rt ON rt.id = ri.return_id
                           WHERE rt.invoice_id = ii2.invoice_id AND ri.product_id = ii2.product_id AND rt.status = 'active') q
            FROM public.invoice_items ii2 WHERE ii2.product_id = ANY (v_ids)) rq
   WHERE ii.id = rq.id AND ii.product_id = ANY (v_ids)
     AND (SELECT count(*) FROM public.invoice_items z WHERE z.invoice_id = ii.invoice_id AND z.product_id = ii.product_id) = 1;

  -- the stock: exactly the pieces taken off (purchase / opening / sale return lines had added them, sale / purchase
  -- return lines had taken them out)
  UPDATE public.products p SET quantity = p.quantity + d.delta
    FROM (SELECT product, sum(x.sign * (x.old_q - x.new_q)) delta FROM fan_fix x GROUP BY product) d WHERE p.id = d.product;

  ALTER TABLE public.invoice_items ENABLE TRIGGER USER;          ALTER TABLE public.shipment_items ENABLE TRIGGER USER;
  ALTER TABLE public.purchase_return_items ENABLE TRIGGER USER;  ALTER TABLE public.return_items ENABLE TRIGGER USER;
  ALTER TABLE public.product_batches ENABLE TRIGGER USER;        ALTER TABLE public.stock_movements ENABLE TRIGGER USER;
  ALTER TABLE public.products ENABLE TRIGGER USER;

  PERFORM public.recost_product_sales(v_ids, '2026-01-01 00:00+02');
  UPDATE public.products SET cost_price = round(avg_cost, 2) WHERE id = ANY (v_ids) AND coalesce(avg_cost, 0) > 0;

  FOR r IN SELECT p.id, p.quantity FROM public.products p WHERE p.id = ANY (v_ids) LOOP
    SELECT coalesce(sum(qty), 0) INTO v_led FROM public.product_cost_ledger(r.id);
    IF (v_before->>r.id::text)::boolean AND v_led <> r.quantity THEN
      RAISE EXCEPTION '0179: % stock % but its cost ledger sums to %', r.id, r.quantity, v_led;
    END IF;
  END LOOP;
END
$mig$;
