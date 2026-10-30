-- 0139 checks — rollback-only (ends with RAISE). Run after migration 0139 (or with its text pasted above for a dry-run).
-- In عبدالمنعم (owner):
--   A) 10,000 from the cash drawer to فودافون كاش with 1% → cash −10,100, wallet +10,000, expense «عمولات تحويل» 100
--      in the books (nothing else posted); cancelled → every vessel back to where it was.
--   B) a sale of 1 «غلاية ارماديللو» at 572 paid InstaPay with 15 fee «على العميل» → InstaPay +587, «إيرادات أخرى» +15
--      in the books; voiding the payment takes the 15 back too.
--   C) «خصومات / عروض الشركات» can go below zero, a real wallet cannot; «QA رسوم» is gone.
DO $t$
DECLARE
  v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  v_t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
  v_b uuid := '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213';
  v_prod uuid := 'feb56d4d-e228-4f7e-a154-7b8c514ae332';
  v_seq jsonb; v_seq_after jsonb; r record; v_x jsonb; v_id uuid; v_inv uuid; v_pay uuid; v_fee_row uuid;
  cash0 numeric; voda0 numeric; cash1 numeric; voda1 numeric; cash2 numeric; voda2 numeric; insta0 numeric; insta1 numeric; insta2 numeric;
  gl_fee numeric; gl_other numeric; gl_vt numeric; ps0 jsonb; ps1 jsonb; ps2 jsonb;
  v_virtual text; v_wallet text; v_qa int; v_off int; v_fee_calc numeric;
BEGIN
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq FROM pg_sequences WHERE schemaname = 'public';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SELECT cash_balance, vodafone_balance, instapay_balance INTO cash0, voda0, insta0 FROM public.get_branch_wallet_balances(v_b);
  ps0 := public.profit_statement(public.cairo_today(), public.cairo_today(), v_b);

  -- A) vessel transfer with a 1% fee
  v_x := public.transfer_between_vessels(v_b, 'cash', 'vodafone', 10000, 'percent', 1, NULL, '0139 check');
  v_id := (v_x->>'id')::uuid;
  SELECT cash_balance, vodafone_balance INTO cash1, voda1 FROM public.get_branch_wallet_balances(v_b);
  SELECT coalesce(sum(l.debit - l.credit), 0) INTO gl_fee FROM public.journal_entries e JOIN public.journal_entry_lines l ON l.entry_id = e.id
    JOIN public.chart_of_accounts a ON a.id = l.account_id
   WHERE e.tenant_id = v_t AND a.code = '5800' AND e.source_id IN (SELECT id FROM public.vouchers WHERE treasury_id IN
         (SELECT fee_treasury_id FROM public.vessel_transfers WHERE id = v_id));
  SELECT count(*) INTO gl_vt FROM public.journal_entries e WHERE e.source_id IN (SELECT id FROM public.vouchers WHERE treasury_id IN
         (SELECT out_treasury_id FROM public.vessel_transfers WHERE id = v_id UNION SELECT in_treasury_id FROM public.vessel_transfers WHERE id = v_id));
  ps1 := public.profit_statement(public.cairo_today(), public.cairo_today(), v_b);
  PERFORM public.cancel_vessel_transfer(v_id, 'تجربة');
  SELECT cash_balance, vodafone_balance INTO cash2, voda2 FROM public.get_branch_wallet_balances(v_b);

  -- B) sale with the fee on the customer
  v_inv := public.process_sale(v_b, NULL, 572, 0, 0, NULL, 572, 'instapay',
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'product_name', 'غلاية', 'quantity', 1, 'selling_price', 572, 'line_discount', 0)),
    jsonb_build_array(jsonb_build_object('payment_method', 'instapay', 'amount', 572, 'fee_amount', 15, 'fee_on_customer', true,
                                         'reference_number', 'T-0139', 'transfer_from_account', 'x', 'transfer_to_account', 'y')),
    0, 0, NULL);
  SELECT id, fee_treasury_id INTO v_pay, v_fee_row FROM public.invoice_payments WHERE invoice_id = v_inv AND reverses_payment_id IS NULL LIMIT 1;
  SELECT instapay_balance INTO insta1 FROM public.get_branch_wallet_balances(v_b);
  SELECT coalesce(sum(l.credit - l.debit), 0) INTO gl_other FROM public.journal_entries e JOIN public.journal_entry_lines l ON l.entry_id = e.id
    JOIN public.chart_of_accounts a ON a.id = l.account_id
   WHERE a.code = '4200' AND e.source_id IN (SELECT id FROM public.vouchers WHERE treasury_id = v_fee_row);
  ps2 := public.profit_statement(public.cairo_today(), public.cairo_today(), v_b);
  PERFORM public.void_invoice_payment(v_pay, 'تجربة');
  SELECT instapay_balance INTO insta2 FROM public.get_branch_wallet_balances(v_b);

  -- C) virtual vessel / real wallet / QA
  BEGIN
    INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, payment_method, created_by)
    VALUES (v_b, v_t, 'expense', 'test', 1000000, '0139 virtual', 'company_offers', v_owner);
    v_virtual := 'allowed';
  EXCEPTION WHEN OTHERS THEN v_virtual := SQLERRM; END;
  BEGIN
    INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, payment_method, created_by)
    VALUES (v_b, v_t, 'expense', 'test', 99999999, '0139 wallet', 'vodafone', v_owner);
    v_wallet := 'allowed';
  EXCEPTION WHEN OTHERS THEN v_wallet := 'refused'; END;
  SELECT count(*) INTO v_qa FROM public.transfer_fees WHERE payment_method = '__qa_method' AND tenant_id = v_t;
  SELECT count(*) INTO v_off FROM public.transfer_fees WHERE payment_method = 'company_offers' AND tenant_id = v_t AND kind = 'virtual';
  v_fee_calc := public.calculate_payment_fee('company_offers', 10000);

  FOR r IN SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' LOOP
    IF (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS DISTINCT FROM r.last_value::text
       AND (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS NOT NULL THEN
      PERFORM setval(format('%I.%I', r.schemaname, r.sequencename), (v_seq ->> (r.schemaname || '.' || r.sequencename))::bigint);
    END IF;
  END LOOP;
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq_after FROM pg_sequences WHERE schemaname = 'public';

  RAISE EXCEPTION '0139 CHECKS %', jsonb_build_object(
    'A1_cash_minus_10100', cash1 - cash0 = -10100, 'A2_wallet_plus_10000', voda1 - voda0 = 10000,
    'A3_fee_expense_100_in_books', gl_fee = 100, 'A4_no_journal_for_the_move', gl_vt = 0,
    'A5_profit_expenses_up_100', (ps1->'total'->>'expenses')::numeric - (ps0->'total'->>'expenses')::numeric = 100,
    'A6_cancel_back', cash2 = cash0 AND voda2 = voda0,
    'B1_instapay_plus_587', insta1 - insta0 = 587, 'B2_fee_row_linked', v_fee_row IS NOT NULL,
    'B3_other_income_15_in_books', gl_other = 15,
    'B4_profit_other_income_up_15', (ps2->'total'->>'other_income')::numeric - (ps1->'total'->>'other_income')::numeric = 15,
    'B5_void_takes_fee_back', insta2 = insta0,
    'C1_virtual_negative', v_virtual, 'C2_wallet_refused', v_wallet, 'C3_qa_gone', v_qa = 0, 'C4_offers_virtual', v_off = 1,
    'C5_virtual_no_fee', v_fee_calc = 0, 'C6_sequences_same', v_seq = v_seq_after);
END
$t$;
