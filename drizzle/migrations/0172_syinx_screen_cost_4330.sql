-- 0172: owner 2026-11-07 «ياسر المحمدى رجع ٤ شاشات سينكس ب ٤٠٥٠ وتكلفتها ٤٣٣٠ج / الطيب رجع … ب ٤١٠٠ج وتكلفتها ٤٣٣٠ج … نفذ»
-- (الطيب = 10 screens, as in the «سهل» file — owner «10 صح») and «أيوه 4,330» for شلبى's opening of the same item.
-- Item: شاشة سينكس 32 بوصة (code 1105), branch شلبى.
--   RY00001 (ياسر المحمدي, 3/1, 4 × 4,050) and RY00025 (يحى الطيب, 8/1, 10 × 4,100) were imported with cost 0;
--   the opening stock was 3 × 10,051.68. All three become 4,330 a piece.
-- Books: each return's entry is reversed on its own day and posted again with its cost (Dr 1300 cost / Cr 3800 the
-- part above the price / Cr 1100 the price); the opening gets ONE correcting entry on 2026-01-01 (Dr 3950 / Cr 1300
-- 17,165.04). Then every 2026 sale of the item is re-costed at the moving average (`recost_product_sales`: invoice
-- COGS re-posted, returns re-synced, avg_cost) and cost_price = the average.
-- The cost ledger skipped the zero-cost pieces, so the 14 screens sold in January carried 10,051.68 each.
-- Dry-run: COGS of the item 1,702,863.57 → 1,605,515.71; net profit 1/1–28/10 1,989,551.19 → 2,086,270.65 (شلبى
-- +96,719.46); sales, returns and tills unchanged.
DO $mig$
DECLARE v_t uuid; v_owner uuid; r record; v_new uuid; v_ids uuid[]; v_cost numeric;
BEGIN
  SELECT tenant_id INTO v_t FROM public.branches WHERE code = 'FR-005';
  IF v_t IS NULL THEN RETURN; END IF;   -- another database
  IF NOT EXISTS (SELECT 1 FROM public.product_batches WHERE id = '564353e1-69d8-48ad-b689-b5de40d467a1' AND cost_price = 0) THEN
    RETURN;                              -- already done
  END IF;
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id
   WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  UPDATE public.product_batches SET cost_price = 4330, base_purchase_price = 4330, true_unit_cost = 4330
   WHERE id IN ('47aaa6b1-ca2e-4b67-aa80-c07ae19b6965',    -- opening 3
                '564353e1-69d8-48ad-b689-b5de40d467a1',    -- RY00001
                'ad7c713f-8261-4a23-933b-b6ffb5ed509f');   -- RY00025

  PERFORM set_config('app.reverse_on_original_date', '1', true);
  FOR r IN SELECT pr.*, t.branch_id tb FROM public.prior_year_returns pr JOIN public.treasury t ON t.id = pr.treasury_id
            WHERE pr.return_number IN ('RY00001', 'RY00025') AND pr.tenant_id = v_t LOOP
    v_cost := round((r.items->0->>'quantity')::numeric * 4330, 2);
    UPDATE public.prior_year_returns
       SET items = (SELECT jsonb_agg(e || jsonb_build_object('cost', 4330)) FROM jsonb_array_elements(r.items) e),
           total_cost = v_cost,
           notes = coalesce(notes, '') || ' — التكلفة 4,330 (المالك 2026-11-07)'
     WHERE id = r.id;
    PERFORM public.reverse_journal_for_source(v_t, 'treasury_row', r.treasury_id, 'تصحيح تكلفة ' || r.return_number || ': ');
    v_new := public.post_journal(v_t, r.return_date, 'مرتجع فاتورة قبل 2026 ' || r.return_number || ' (التكلفة 4,330)', 'treasury_row', r.treasury_id,
      jsonb_build_array(
        jsonb_build_object('account_code', '1300', 'debit', v_cost, 'credit', 0, 'description', 'بضاعة رجعت (فاتورة قبل 2026)'),
        jsonb_build_object('account_code', '3800', 'debit', greatest(r.total_price - v_cost, 0), 'credit', greatest(v_cost - r.total_price, 0),
                           'description', 'تسوية أرباح سنوات سابقة'),
        jsonb_build_object('account_code', '1100', 'debit', 0, 'credit', r.total_price, 'description', 'رد قيمة المرتجع')));
    UPDATE public.journal_entries SET branch_id = r.tb WHERE id = v_new AND branch_id IS NULL;
  END LOOP;

  PERFORM public.post_journal(v_t, '2026-01-01',
    'تصحيح رصيد افتتاحي — مخزون: شاشة سينكس 32 (1105) شلبى 3 × 10,051.68 → 4,330', 'opening_stock_correction',
    '47aaa6b1-ca2e-4b67-aa80-c07ae19b6965',
    jsonb_build_array(jsonb_build_object('account_code', '3950', 'debit', 17165.04, 'credit', 0, 'description', 'تصحيح رصيد افتتاحي - مخزون'),
                      jsonb_build_object('account_code', '1300', 'debit', 0, 'credit', 17165.04, 'description', 'تصحيح رصيد افتتاحي - مخزون')));

  SELECT array_agg(id) INTO v_ids FROM public.products WHERE sku = '1105' AND tenant_id = v_t;
  PERFORM public.recost_product_sales(v_ids, '2026-01-01 00:00+02');
  UPDATE public.products SET cost_price = round(avg_cost, 2) WHERE id = ANY (v_ids) AND coalesce(avg_cost, 0) > 0;
END
$mig$;
