-- 0174: owner 2026-11-07 «فعلا كانت -1 … نفذ». «سهل»'s opening stock file for شلبى (البضاعة الافتتاحية, 01/01/2026)
-- has «غسالة فريش 8 ك الشبح اليجانت» (1613) at −1 (purchase price 4,550); `post_opening_balances` skips a quantity
-- ≤ 0, so the system had one washer more than «سهل» (1 against «المتاح» 0). The −1 is now the opening: an opening
-- batch of −1 at 4,550 on 2026-01-01 (the cost ledger starts at −1; the first purchase of 30/1 sets the average),
-- one stock movement out on 1/1 (1 → 0), ONE correcting entry on 2026-01-01 (Dr 3950 / Cr 1300 4,550, source
-- `opening_stock_correction`), then the item's 2026 sales are re-costed. Dry-run: stock 1 → 0, item COGS
-- 369,662.05 → 370,335.00, net profit 1/1–28/10 2,086,461.47 → 2,085,788.57.
DO $mig$
DECLARE v_t uuid; v_owner uuid; v_b uuid; v_pid uuid; v_bid uuid := gen_random_uuid(); v_ids uuid[];
  v_at timestamptz := ('2026-01-01'::date + time '00:00') AT TIME ZONE 'Africa/Cairo';
BEGIN
  SELECT tenant_id, id INTO v_t, v_b FROM public.branches WHERE code = 'FR-005';
  IF v_b IS NULL THEN RETURN; END IF;
  SELECT id INTO v_pid FROM public.products WHERE branch_id = v_b AND sku = '1613';
  IF v_pid IS NULL OR EXISTS (SELECT 1 FROM public.product_batches WHERE product_id = v_pid AND batch_type = 'opening' AND quantity_purchased < 0) THEN
    RETURN;   -- other database / already done
  END IF;
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id
   WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  INSERT INTO public.product_batches (id, tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining, cost_price,
                                      base_purchase_price, shipping_cost_per_unit, true_unit_cost, batch_type, effective_at)
  VALUES (v_bid, v_t, v_b, v_pid, -1, 0, 4550, 4550, 0, 4550, 'opening', v_at);
  PERFORM public.stock_mv_ctx('adjustment', 'opening_balance', v_bid, v_pid, v_at);
  UPDATE public.products SET quantity = quantity - 1 WHERE id = v_pid;
  PERFORM public.post_journal(v_t, '2026-01-01',
    'تصحيح رصيد افتتاحي — مخزون: غسالة فريش 8 ك الشبح (1613) شلبى −1 × 4,550 (جرد 1/1/2026)', 'opening_stock_correction', v_bid,
    jsonb_build_array(jsonb_build_object('account_code', '3950', 'debit', 4550, 'credit', 0, 'description', 'تصحيح رصيد افتتاحي - مخزون'),
                      jsonb_build_object('account_code', '1300', 'debit', 0, 'credit', 4550, 'description', 'تصحيح رصيد افتتاحي - مخزون')));

  SELECT array_agg(id) INTO v_ids FROM public.products WHERE sku = '1613' AND tenant_id = v_t;
  PERFORM public.recost_product_sales(v_ids, '2026-01-01 00:00+02');
  UPDATE public.products SET cost_price = round(avg_cost, 2) WHERE id = ANY (v_ids) AND coalesce(avg_cost, 0) > 0;
END
$mig$;
