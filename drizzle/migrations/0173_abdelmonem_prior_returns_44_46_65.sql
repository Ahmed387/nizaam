-- 0173: owner 2026-11-07 «المرتجع على فاتورة قبل 2026 بيتسجل في «أرباح السنين اللي فاتت» تمام — 44 تكلفتها ب 2900،
-- 46 تكلفتها ب 4700، 65 تكلفتها ب 1140». The three عبدالمنعم returns on 2025 invoices that the «سهل» import left
-- waiting (status pending_cost: the file had no cost) are recorded through the system's own path
-- (`record_prior_year_return`, the same call as `sahl_import.do_op`): on their own day, money «على حسابه» (no cash
-- in «سهل»), the piece back in stock at the owner's cost, the difference to «أرباح السنين اللي فاتت» (3800).
--   44 / inv 505  19/3  استاذ عبد الرحمن   سخان كهرباء اوليمبك 30 لتر (1410)  3,000  cost 2,900
--   46 / inv 482  15/4  اللواء مصطفى جلال  شفاط فريش بلت ان 60×90 (648)       5,000  cost 4,700
--   65 / inv 1452 18/8  محمد عبدالكريم     شفاط توشيبا 25 سم (15)             1,300  cost 1,140
-- Then the three items' 2026 sales are re-costed. Dry-run: tills unchanged, stock 1410 −1 → 0, 648 −1 → 0,
-- 15 → 1; net profit 1/1–28/10 2,086,270.65 → 2,086,461.47.
DO $mig$
DECLARE v_t uuid; v_owner uuid; v_b uuid; o record; v_items jsonb; v_res jsonb; v_c uuid; v_ids uuid[];
  v_cost jsonb := '{"44": 2900, "46": 4700, "65": 1140}';
BEGIN
  IF to_regclass('sahl_import.ops') IS NULL THEN RETURN; END IF;
  SELECT tenant_id, id INTO v_t, v_b FROM public.branches WHERE code = 'FR-004';
  IF v_b IS NULL THEN RETURN; END IF;
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id
   WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  FOR o IN SELECT * FROM sahl_import.ops WHERE branch = 'abdelmonem' AND kind = 'prior_sale_return' AND no IN (44, 46, 65)
              AND status = 'pending_cost' ORDER BY day LOOP
    SELECT jsonb_agg(jsonb_build_object('product_id', sahl_import.pid(o.branch, x->>'sku'), 'quantity', (x->>'qty')::int,
             'price', round((x->>'net')::numeric / (x->>'qty')::int, 4), 'cost', (v_cost->>o.no::text)::numeric))
      INTO v_items FROM jsonb_array_elements(o.payload->'lines') x;
    v_c := sahl_import.cid(o.branch, o.payload->>'contact');
    v_res := public.record_prior_year_return(v_b, v_c, o.day, v_items, 'account', 'cash',
                                             (o.payload->>'notes') || ' — التكلفة من المالك 2026-11-07');
    UPDATE sahl_import.ops SET status = 'done', new_id = (v_res->>'id')::uuid WHERE id = o.id;
  END LOOP;

  SELECT array_agg(id) INTO v_ids FROM public.products WHERE tenant_id = v_t AND sku IN ('1410', '648', '15');
  PERFORM public.recost_product_sales(v_ids, '2026-01-01 00:00+02');
  UPDATE public.products SET cost_price = round(avg_cost, 2) WHERE id = ANY (v_ids) AND coalesce(avg_cost, 0) > 0;
END
$mig$;
