-- 0140 checks — rollback-only (ends with RAISE). Run after migration 0140 (or with its text pasted above for a dry-run).
-- The owner sends 5,000 cash from عبدالمنعم to سكة dated 2026-10-20; سكة receives 4,800 («ناقص 200»): عبدالمنعم
-- −4,800, سكة +4,800, both on 20/10; the books move each branch's cash the same and the inter-branch account ends at 0.
-- A second transfer of 1,000 is refused → all back. Same branch and a cashier's backdate are refused.
DO $t$
DECLARE
  v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  v_t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
  v_a uuid := '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213';   -- عبدالمنعم
  v_s uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142';   -- سكة
  v_seq jsonb; v_seq_after jsonb; r record; v_id uuid; v_id2 uuid; v_cashier uuid; v_cb uuid;
  a0 numeric; s0 numeric; a1 numeric; s1 numeric; a2 numeric; s2 numeric;
  gl_a numeric; gl_s numeric; gl_1910 numeric; v_days int; c_same text; c_back text; c_twice text; v_tr record;
BEGIN
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq FROM pg_sequences WHERE schemaname = 'public';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SELECT cash_balance INTO a0 FROM public.get_branch_wallet_balances(v_a);
  SELECT cash_balance INTO s0 FROM public.get_branch_wallet_balances(v_s);

  v_id := public.transfer_treasury_atomic(v_a, v_s, 5000, '0140 check', 'cash', 0, NULL, NULL, true, '2026-10-20');
  PERFORM public.receive_treasury_transfer(v_id, 4800, 'ناقص 200');
  SELECT cash_balance INTO a1 FROM public.get_branch_wallet_balances(v_a);
  SELECT cash_balance INTO s1 FROM public.get_branch_wallet_balances(v_s);
  SELECT * INTO v_tr FROM public.treasury_transfers WHERE id = v_id;
  SELECT count(DISTINCT transaction_date) INTO v_days FROM public.treasury WHERE reference_id = v_id;

  SELECT coalesce(sum(l.debit - l.credit) FILTER (WHERE e.branch_id = v_a AND a.code = '1100'), 0),
         coalesce(sum(l.debit - l.credit) FILTER (WHERE e.branch_id = v_s AND a.code = '1100'), 0),
         coalesce(sum(l.debit - l.credit) FILTER (WHERE a.code = '1910'), 0)
    INTO gl_a, gl_s, gl_1910
    FROM public.journal_entries e JOIN public.journal_entry_lines l ON l.entry_id = e.id JOIN public.chart_of_accounts a ON a.id = l.account_id
   WHERE e.tenant_id = v_t AND e.status = 'posted'
     AND (e.source_id IN (SELECT id FROM public.treasury WHERE reference_id = v_id)
          OR e.source_id IN (SELECT vv.id FROM public.vouchers vv JOIN public.treasury tt ON tt.id = vv.treasury_id WHERE tt.reference_id = v_id));

  v_id2 := public.transfer_treasury_atomic(v_a, v_s, 1000, '0140 check 2', 'cash');
  PERFORM public.reject_treasury_transfer(v_id2, 'غلط');
  SELECT cash_balance INTO a2 FROM public.get_branch_wallet_balances(v_a);
  SELECT cash_balance INTO s2 FROM public.get_branch_wallet_balances(v_s);
  BEGIN PERFORM public.receive_treasury_transfer(v_id2, 1000, NULL); c_twice := 'allowed'; EXCEPTION WHEN OTHERS THEN c_twice := SQLERRM; END;
  BEGIN PERFORM public.transfer_treasury_atomic(v_a, v_a, 10, 'x', 'cash'); c_same := 'allowed'; EXCEPTION WHEN OTHERS THEN c_same := SQLERRM; END;

  -- a cashier in his own branch, sending with an old date
  SELECT ur.user_id, bu.branch_id INTO v_cashier, v_cb FROM public.user_roles ur JOIN public.branch_users bu ON bu.user_id = ur.user_id
   WHERE ur.role = 'cashier' AND ur.tenant_id = v_t
     AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ur.user_id AND x.role IN ('owner', 'admin')) LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cashier, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.transfer_treasury_atomic(v_cb, CASE WHEN v_cb = v_s THEN v_a ELSE v_s END, 10, 'x', 'cash', 0, NULL, NULL, true, '2026-10-01'); c_back := 'allowed';
  EXCEPTION WHEN OTHERS THEN c_back := SQLERRM; END;

  FOR r IN SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' LOOP
    IF (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS DISTINCT FROM r.last_value::text
       AND (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS NOT NULL THEN
      PERFORM setval(format('%I.%I', r.schemaname, r.sequencename), (v_seq ->> (r.schemaname || '.' || r.sequencename))::bigint);
    END IF;
  END LOOP;
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq_after FROM pg_sequences WHERE schemaname = 'public';

  RAISE EXCEPTION '0140 CHECKS %', jsonb_build_object(
    'C1_sender_minus_4800', a1 - a0 = -4800, 'C2_receiver_plus_4800', s1 - s0 = 4800,
    'C3_status', jsonb_build_object('received', v_tr.received_amount, 'returned', v_tr.returned_amount, 'date', v_tr.transfer_date),
    'C4_all_rows_on_20_10', v_days = 1,
    'C5_books_sender_cash', gl_a, 'C5_books_receiver_cash', gl_s, 'C6_inter_branch_zero', gl_1910 = 0,
    'C7_refused_all_back', a2 = a1 AND s2 = s1, 'C8_second_receive_refused', c_twice,
    'C9_same_branch_refused', c_same, 'C10_cashier_backdate', c_back, 'C11_sequences_same', v_seq = v_seq_after);
END
$t$;
