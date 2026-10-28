-- Integration checks for 0125–0131 (owner decisions 2026-10-28). Run as ONE batch on the live database:
-- it edits / cancels real returns inside the batch and raises at the end → ROLLBACK (nothing is kept).
-- Sequences are NOT rolled back: the return-number sequences are put back by hand before the raise (setval is not
-- transactional), otherwise every run burns SR / PR numbers (2026-10-28: SR00095–SR00103, PR00204–PR00206).
DO $$
DECLARE r text := E'\n'; n int; pass int := 0; fail int := 0; ok boolean; msg text; res jsonb; x record;
  owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  v_day_till_before numeric; v_day_till_after numeric; v_stock_before numeric; v_stock_after numeric;
  seq_sr bigint := (SELECT last_value FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'sale_return_seq');
  seq_pr bigint := (SELECT last_value FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'purchase_return_seq');
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);

  -- 1. 0125: old-system transfers are internal (1950), never revenue / expense
  SELECT count(*) INTO n FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.entry_id
    JOIN vouchers v ON v.id = je.source_id AND je.source_type IN ('voucher', 'voucher_reversal')
    JOIN voucher_categories vc ON vc.id = v.category_id AND vc.name = 'تحويل الى الخزينة (نظام قديم)'
    JOIN chart_of_accounts a ON a.id = l.account_id AND a.code IN ('4200', '5500');
  IF n = 0 AND NOT EXISTS (SELECT 1 FROM voucher_categories WHERE name = 'تحويل الى الخزينة (نظام قديم)' AND gl_account_code IS DISTINCT FROM '1950') THEN
    pass := pass+1; r := r || '✅ 1. تحويلات النظام القديم على 1950 بس (مش إيراد ولا مصروف)' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 1. ' || n || ' سطر لسه على 4200/5500' || E'\n'; END IF;

  -- 2. 0126: a refund till row is «مرتجعات للعملاء», not «نثريات»
  SELECT count(*) INTO n FROM vouchers v JOIN treasury t ON t.id = v.treasury_id JOIN voucher_categories vc ON vc.id = v.category_id
   WHERE t.category ILIKE '%refund%' AND t.type = 'expense' AND vc.name = 'نثريات';
  IF n = 0 AND EXISTS (SELECT 1 FROM vouchers v JOIN voucher_categories vc ON vc.id = v.category_id WHERE v.voucher_number = 'PV-3031' AND vc.name ILIKE '%مرتجعات%') THEN
    pass := pass+1; r := r || '✅ 2. سندات رد الفلوس على «مرتجعات للعملاء» (PV-3031)' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 2. ' || n || ' سند رد لسه «نثريات»' || E'\n'; END IF;

  -- 3. 0127: the two 8/10 surplus entries are reversed on 8/10
  SELECT count(*) INTO n FROM journal_entries je JOIN stock_adjustments sa ON sa.id = je.source_id
    JOIN journal_entries rev ON rev.id = je.reversed_by
   WHERE sa.adjustment_number IN ('ADJ-20261008-C95842', 'ADJ-20261008-1CB22B') AND rev.entry_date = DATE '2026-10-08';
  IF n = 2 THEN pass := pass+1; r := r || '✅ 3. فائض جرد 8/10 (102,635) معكوس في نفس اليوم' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 3. معكوس ' || n || ' من 2' || E'\n'; END IF;

  -- 4. 0128: every 2026 invoice reversal sits on the day of the entry it reverses
  SELECT count(*) INTO n FROM journal_entries rev JOIN journal_entries orig ON orig.reversed_by = rev.id
    JOIN invoices i ON i.id = rev.source_id
   WHERE rev.source_type = 'invoice_reversal'
     AND NOT ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id)
     AND rev.entry_date <> ledger_effective_date(rev.tenant_id, orig.entry_date);
  IF n = 0 THEN pass := pass+1; r := r || '✅ 4. عكس تعديل / إلغاء الفاتورة في يومها (IN03887 / IN04936 / IN04916)' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 4. ' || n || ' عكس في يوم غلط' || E'\n'; END IF;

  -- 5. 0129: every active return of a 2026 invoice carries its cost back (Dr 1300 / Cr 5100 = sale_return_cost)
  SELECT count(*) INTO n FROM returns rt JOIN invoices i ON i.id = rt.invoice_id
   WHERE rt.status = 'active' AND NOT ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id)
     AND abs(COALESCE((SELECT sum(l.debit) FROM journal_entries je JOIN journal_entry_lines l ON l.entry_id = je.id
                        JOIN chart_of_accounts a ON a.id = l.account_id AND a.code = '1300'
                       WHERE je.source_type = 'sale_return' AND je.source_id = rt.id AND je.status = 'posted' AND je.reversed_by IS NULL), 0)
             - sale_return_cost(rt.id)) > 0.01;
  IF n = 0 THEN pass := pass+1; r := r || '✅ 5. تكلفة كل مرتجع راجعة في شهر المرتجع (1300 / 5100)' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 5. ' || n || ' مرتجع تكلفته مش مظبوطة' || E'\n'; END IF;

  -- 6. 0130: money of a cancelled return comes back on the RETURN's day (old rows + a new cancel)
  SELECT count(*) INTO n FROM treasury t JOIN returns rt ON rt.id = t.reference_id
   WHERE t.category = 'return_cancel'
     AND t.transaction_date <> ledger_effective_date(t.tenant_id, (COALESCE(rt.invoice_date, rt.created_at) AT TIME ZONE 'Africa/Cairo')::date);
  res := cancel_sale_return((SELECT id FROM returns WHERE return_number = 'SR00072'), 'فحص');
  SELECT t.transaction_date, v.voucher_date INTO x FROM treasury t LEFT JOIN vouchers v ON v.treasury_id = t.id
   WHERE t.reference_id = (SELECT id FROM returns WHERE return_number = 'SR00072') AND t.category = 'return_cancel';
  IF n = 0 AND x.transaction_date = DATE '2026-10-09' AND x.voucher_date = DATE '2026-10-09' THEN
    pass := pass+1; r := r || '✅ 6. إلغاء المرتجع بيرجّع الفلوس في يوم المرتجع (SR00072 → 9/10، خزنة وسند)' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 6. قديم غلط ' || n || ' / SR00072 ' || COALESCE(x.transaction_date::text, '-') || ' ' || COALESCE(x.voucher_date::text, '-') || E'\n'; END IF;

  -- 7. 0131: edit SR00076 (كنكة 280 + غسالة 1,800 cash, 13/8) → كنكة only
  SELECT COALESCE(sum(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) INTO v_day_till_before
    FROM treasury WHERE branch_id = (SELECT branch_id FROM returns WHERE return_number = 'SR00076') AND transaction_date = DATE '2026-08-13';
  SELECT quantity INTO v_stock_before FROM products WHERE id = 'a8543f31-27fc-497d-9895-834c5e6bc80d';
  res := edit_sale_return((SELECT id FROM returns WHERE return_number = 'SR00076'), 'فحص', NULL, NULL, 'cash', NULL, NULL,
    '[{"product_id":"df58cde8-96ba-4f95-a228-be85b181a605","quantity":1,"refund":280}]');
  SELECT COALESCE(sum(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) INTO v_day_till_after
    FROM treasury WHERE branch_id = (SELECT branch_id FROM returns WHERE return_number = 'SR00076') AND transaction_date = DATE '2026-08-13';
  SELECT quantity INTO v_stock_after FROM products WHERE id = 'a8543f31-27fc-497d-9895-834c5e6bc80d';
  SELECT n2.* INTO x FROM returns n2 WHERE n2.id = (res->>'id')::uuid;
  IF x.total_refund = 280 AND x.refund_cash_amount = 280 AND (x.invoice_date AT TIME ZONE 'Africa/Cairo')::date = DATE '2026-08-13'
     AND x.replaces_return_id = (SELECT id FROM returns WHERE return_number = 'SR00076')
     AND (SELECT status FROM returns WHERE return_number = 'SR00076') = 'cancelled'
     AND v_day_till_after - v_day_till_before = 1800 AND v_stock_after = v_stock_before - 1
     AND EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'sale_return' AND je.source_id = x.id AND je.entry_date = DATE '2026-08-13') THEN
    pass := pass+1; r := r || '✅ 7. تعديل SR00076 ← ' || x.return_number || ': 280 كاش بتاريخ 13/8، خزنة اليوم +1,800، الغسالة خرجت من المخزن' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 7. ' || row_to_json(x)::text || ' till Δ ' || (v_day_till_after - v_day_till_before) || ' stock ' || v_stock_before || '→' || v_stock_after || E'\n'; END IF;

  -- 8. 0131: same quantities on a return whose pieces were resold (SR00059, 800 on account) → allowed, still on account
  res := edit_sale_return((SELECT id FROM returns WHERE return_number = 'SR00059'), 'فحص', NULL, 'ملاحظة', 'cash', NULL, NULL,
    '[{"product_id":"505f0585-6ba7-4d06-ae00-b9347ede7421","quantity":1,"refund":800}]');
  IF (res->>'applied_to_debt')::numeric = 800 AND (res->>'cash_refund')::numeric = 0
     AND NOT EXISTS (SELECT 1 FROM treasury WHERE reference_id = (res->>'id')::uuid) THEN
    pass := pass+1; r := r || '✅ 8. تعديل SR00059 بنفس الكمية (القطعة اتباعت): فضل على الحساب 800، مفيش كاش طلع' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 8. ' || res::text || E'\n'; END IF;

  -- 9. 0131: refused — a cancelled return, lowering below what is on hand, a non-owner
  ok := true; msg := '';
  BEGIN PERFORM edit_sale_return((SELECT id FROM returns WHERE return_number = 'SR00076'), 'x', NULL, NULL, 'cash', NULL, NULL,
          '[{"product_id":"df58cde8-96ba-4f95-a228-be85b181a605","quantity":1,"refund":280}]'); ok := false; msg := msg || 'cancelled '; EXCEPTION WHEN others THEN NULL; END;
  BEGIN PERFORM edit_sale_return((SELECT id FROM returns WHERE return_number = 'SR00059'), 'x', NULL, NULL, 'cash', NULL, NULL, '[]'); ok := false; msg := msg || 'empty '; EXCEPTION WHEN others THEN NULL; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', 'a3174891-df98-4baa-a806-8c4c94d29eca', 'role', 'authenticated')::text, true);
  BEGIN PERFORM edit_sale_return((SELECT id FROM returns WHERE return_number = 'SR00073'), 'x', NULL, NULL, 'cash', NULL, NULL,
          '[{"product_id":"df58cde8-96ba-4f95-a228-be85b181a605","quantity":1,"refund":1}]'); ok := false; msg := msg || 'cashier '; EXCEPTION WHEN others THEN NULL; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);
  IF ok THEN pass := pass+1; r := r || '✅ 9. مرفوض: مرتجع ملغي، تعديل من غير أصناف، الكاشير' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 9. اتقبل: ' || msg || E'\n'; END IF;

  -- 10. 0131: purchase return PR00024 (كبة 5, 26/8) → 3: two pieces back in stock, same day, on the supplier's account
  SELECT quantity INTO v_stock_before FROM products WHERE id = 'f56de369-bc58-4ce9-8510-34963d289ee3';
  res := edit_purchase_return((SELECT id FROM purchase_returns WHERE return_number = 'PR00024'), 'فحص',
    '{"refund_method":"balance","refund_cash_amount":0,"refund_transfer_amount":0,"refund_balance_amount":3450}',
    '[{"shipment_item_id":"02a8ce2e-c21f-4250-8931-62901f2a326f","quantity":3}]');
  SELECT quantity INTO v_stock_after FROM products WHERE id = 'f56de369-bc58-4ce9-8510-34963d289ee3';
  SELECT p2.* INTO x FROM purchase_returns p2 WHERE p2.id = (res->>'id')::uuid;
  IF x.total_amount = 3450 AND x.refund_balance_amount = 3450 AND (x.invoice_date AT TIME ZONE 'Africa/Cairo')::date = DATE '2026-08-26'
     AND v_stock_after = v_stock_before + 2 AND (SELECT status FROM purchase_returns WHERE return_number = 'PR00024') = 'cancelled' THEN
    pass := pass+1; r := r || '✅ 10. تعديل PR00024 ← ' || x.return_number || ': 3 بدل 5، قطعتين رجعوا المخزن، نفس اليوم 26/8' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 10. ' || row_to_json(x)::text || ' stock ' || v_stock_before || '→' || v_stock_after || E'\n'; END IF;

  -- 11. everything still adds up once the deferred ledger triggers run
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT count(*) INTO n FROM journal_entries je
   WHERE abs((SELECT COALESCE(sum(debit - credit), 0) FROM journal_entry_lines l WHERE l.entry_id = je.id)) > 0.005;
  SELECT n + count(*) INTO n FROM ledger_reconciliation() WHERE abs(unexplained) > 0.005;
  IF n = 0 THEN pass := pass+1; r := r || '✅ 11. كل القيود متوازنة والدفتر الموحد مفيهوش فرق غير مفسر' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 11. ' || n || E'\n'; END IF;

  SELECT count(*) INTO n FROM security_exposed_definer_functions();
  IF n = 0 THEN pass := pass+1; r := r || '✅ 12. مفيش دوال مكشوفة' || E'\n';
  ELSE fail := fail+1; r := r || '❌ 12. ' || (SELECT string_agg(z, ', ') FROM security_exposed_definer_functions() z) || E'\n'; END IF;

  PERFORM setval('public.sale_return_seq', seq_sr);
  PERFORM setval('public.purchase_return_seq', seq_pr);
  RAISE EXCEPTION 'ROLLBACK-RESULTS: نجح % / فشل % %', pass, fail, r;
END $$;
