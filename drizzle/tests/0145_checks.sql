-- 0145 checks — rollback-only. «مروحة سقف نوفا NCF-56D» in عبدالمنعم (SKU-109607).
--  P1) refund: 1 piece, price 1,500, cost 1,200 → stock +1, till −1,500, books 1300 +1,200 / 3800 +300 / 1100 −1,500,
--      2026 profit of the day unchanged (no sales / cost lines).
--  P2) on account for a customer: till net 0 that day, the customer gets an advance of 1,500.
--  P3) a branch manager is refused.  P4) sequences put back.
DO $t$
DECLARE
  v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a'; v_mgr uuid := '598491e8-589f-4ad1-88a6-62d6e9114bde';
  v_b uuid := '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213'; v_p uuid := '2603d439-af62-42af-b114-6f0fc653eb3a';
  v_c uuid := '6b2c8161-0362-4a87-bac4-f0491f76c858';
  v_seq jsonb; v_seq_after jsonb; r record; q0 numeric; q1 numeric; t0 numeric; t1 numeric; t2 numeric; c0 numeric; c1 numeric;
  v_res jsonb; v_res2 jsonb; v_gl jsonb; v_ps0 jsonb; v_ps1 jsonb; v_mgr_err text;
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq FROM pg_sequences WHERE schemaname = 'public';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.record_prior_year_return(v_b, NULL, public.cairo_today(), jsonb_build_array(jsonb_build_object('product_id', v_p, 'quantity', 1, 'price', 1500, 'cost', 1200)), 'refund');
        v_mgr_err := 'allowed'; EXCEPTION WHEN OTHERS THEN v_mgr_err := SQLERRM; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SELECT quantity INTO q0 FROM public.products WHERE id = v_p;
  SELECT cash_balance INTO t0 FROM public.get_branch_wallet_balances(v_b);
  v_ps0 := public.profit_statement(public.cairo_today(), public.cairo_today(), v_b)->'total';
  v_res := public.record_prior_year_return(v_b, NULL, public.cairo_today(),
             jsonb_build_array(jsonb_build_object('product_id', v_p, 'quantity', 1, 'price', 1500, 'cost', 1200)), 'refund', 'cash', 'تجربة');
  SELECT quantity INTO q1 FROM public.products WHERE id = v_p;
  SELECT cash_balance INTO t1 FROM public.get_branch_wallet_balances(v_b);
  v_ps1 := public.profit_statement(public.cairo_today(), public.cairo_today(), v_b)->'total';
  SELECT jsonb_object_agg(c.code, l.debit - l.credit) INTO v_gl FROM public.journal_entries e JOIN public.journal_entry_lines l ON l.entry_id = e.id
    JOIN public.chart_of_accounts c ON c.id = l.account_id WHERE e.source_type = 'treasury_row' AND e.source_id = (v_res->>'treasury_id')::uuid;
  -- P2
  SELECT round(ledger_balance, 2) INTO c0 FROM public.v_contact_balances WHERE contact_id = v_c;
  v_res2 := public.record_prior_year_return(v_b, v_c, public.cairo_today(),
             jsonb_build_array(jsonb_build_object('product_id', v_p, 'quantity', 1, 'price', 1500, 'cost', 1200)), 'account', 'cash', NULL);
  SELECT cash_balance INTO t2 FROM public.get_branch_wallet_balances(v_b);
  SELECT round(ledger_balance, 2) INTO c1 FROM public.v_contact_balances WHERE contact_id = v_c;
  FOR r IN SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' LOOP
    IF (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS DISTINCT FROM r.last_value::text THEN
      IF (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS NOT NULL THEN
        PERFORM setval(format('%I.%I', r.schemaname, r.sequencename), (v_seq ->> (r.schemaname || '.' || r.sequencename))::bigint);
      ELSIF v_seq ? (r.schemaname || '.' || r.sequencename) THEN   -- never used before the test
        PERFORM setval(format('%I.%I', r.schemaname, r.sequencename), 1, false);
      END IF;
    END IF;
  END LOOP;
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq_after FROM pg_sequences WHERE schemaname = 'public';
  RAISE EXCEPTION '0145 CHECKS %', jsonb_build_object(
    'P1_stock_plus_1', q1 - q0, 'P1_till_m1500', t1 - t0, 'P1_books', v_gl,
    'P1_profit_same', (v_ps0->>'net_profit') = (v_ps1->>'net_profit') AND (v_ps0->>'sales') = (v_ps1->>'sales'),
    'P2_till_net_0', t2 - t1, 'P2_customer_advance_m1500', c1 - c0, 'P3_manager_refused', v_mgr_err,
    'P4_seq_same', v_seq = v_seq_after OR (v_seq - 'public.prior_year_return_seq') = (v_seq_after - 'public.prior_year_return_seq'), 'numbers', jsonb_build_array(v_res->>'return_number', v_res2->>'return_number'));
END
$t$;
