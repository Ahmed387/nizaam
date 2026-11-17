-- 0250 checks (rollback-only: the block always raises). Branch capital on vessels + «رجّع / انقل رأس مال».
-- Run as the A & N owner; every write is rolled back by the final RAISE.
DO $t$
DECLARE r text[] := '{}'; ten uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
  PC uuid := '4211d2d0-6334-4460-b584-f4ece8fe75e0'; A uuid := '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213';
  B uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142';
  aP uuid; aM uuid; accS uuid; x jsonb; vid uuid; q record; prof0 numeric; prof1 numeric; gl0 numeric; gl1 numeric;
  bal_p numeric; bal_m numeric; bal_s numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"85c76e60-3d27-4a99-8cd7-c8f8b39d914a","role":"authenticated"}', true);
  SELECT (profit_statement_core(ten, '2026-01-01', cairo_today(), NULL)->'total'->>'net_profit')::numeric INTO prof0;
  INSERT INTO vessel_accounts (tenant_id, payment_method, holder_name, account_number, daily_limit)
  VALUES (ten, 'vodafone', 'تجربة الشركاء', '0100000009', 150000) RETURNING id INTO aP;
  INSERT INTO vessel_accounts (tenant_id, payment_method, holder_name, account_number) VALUES (ten, 'vodafone', 'تجربة محمد', '0100000008') RETURNING id INTO aM;
  INSERT INTO vessel_accounts (tenant_id, payment_method, holder_name, account_number) VALUES (ten, 'vodafone', 'تجربة سكة', '0100000007') RETURNING id INTO accS;
  x := partner_money('4a260665-29aa-4510-af0f-388166b6c01e', 'contribution', 200000, 'capital', NULL, PC, 'vodafone', NULL, 'تجربة', '0100000009');

  -- 1) allocate on a vessel with accounts
  BEGIN vid := allocate_branch_capital(A, 100000, cairo_today(), 'vodafone', NULL, '0100000008'); r := r || 'C1 FAIL no account accepted';
  EXCEPTION WHEN OTHERS THEN r := r || ('C1 ok: ' || SQLERRM); END;
  BEGIN vid := allocate_branch_capital(A, 500000, cairo_today(), 'vodafone', '0100000009', '0100000008'); r := r || 'C2 FAIL above balance accepted';
  EXCEPTION WHEN OTHERS THEN r := r || ('C2 ok: ' || SQLERRM); END;
  vid := allocate_branch_capital(A, 100000, cairo_today(), 'vodafone', '0100000009', '0100000008', 't');
  SELECT u.balance, u.sent_today INTO q FROM vessel_account_usage(ARRAY[aP]) u;
  r := r || format('C3 allocate: P balance=%s sent=%s, M balance=%s, A capital=%s', q.balance, q.sent_today,
    (SELECT balance FROM vessel_account_usage(ARRAY[aM])), (get_branch_financial_position(A)->>'allocated_capital'));
  BEGIN vid := allocate_branch_capital(A, 60000, cairo_today(), 'vodafone', '0100000009', '0100000008'); r := r || 'C4 FAIL limit passed';
  EXCEPTION WHEN OTHERS THEN r := r || ('C4 ok (limit): ' || SQLERRM); END;

  -- 2) return to the partners' treasury, move to another branch
  vid := move_branch_capital(A, NULL, 30000, cairo_today(), 'vodafone', '0100000008', '0100000009', 'رجوع تجربة');
  r := r || format('C5 return: A capital=%s, P balance=%s, kind=%s', get_branch_financial_position(A)->>'allocated_capital',
    (SELECT balance FROM vessel_account_usage(ARRAY[aP])), (SELECT kind FROM branch_capital_allocations bca WHERE bca.id = vid));
  vid := move_branch_capital(A, B, 20000, cairo_today(), 'vodafone', '0100000008', '0100000007', 'نقل تجربة');
  r := r || format('C6 move: A=%s B=%s M=%s S=%s', get_branch_financial_position(A)->>'allocated_capital',
    get_branch_financial_position(B)->>'allocated_capital',
    (SELECT balance FROM vessel_account_usage(ARRAY[aM])), (SELECT balance FROM vessel_account_usage(ARRAY[accS])));
  BEGIN vid := move_branch_capital(A, NULL, 60000, cairo_today(), 'vodafone', '0100000008', '0100000009', 't'); r := r || 'C7 FAIL above capital accepted';
  EXCEPTION WHEN OTHERS THEN r := r || ('C7 ok: ' || SQLERRM); END;
  BEGIN vid := move_branch_capital(A, A, 1000, cairo_today(), 'vodafone', '0100000008', '0100000008', 't'); r := r || 'C8 FAIL same branch accepted';
  EXCEPTION WHEN OTHERS THEN r := r || ('C8 ok: ' || SQLERRM); END;
  BEGIN vid := move_branch_capital(A, NULL, 1000, cairo_today(), 'instapay', NULL, NULL, 't'); r := r || 'C9 FAIL no vessel money accepted';
  EXCEPTION WHEN OTHERS THEN r := r || ('C9 ok: ' || SQLERRM); END;

  -- 3) books: every leg on 1110 (vodafone), 1910 nets to 0, profit unchanged
  SELECT coalesce(sum(l.debit - l.credit), 0) INTO gl1 FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
    JOIN chart_of_accounts c ON c.id = l.account_id
   WHERE e.source_type = 'treasury_row' AND c.code = '1910' AND e.source_id IN
     (SELECT t.id FROM treasury t WHERE t.tenant_id = ten AND t.category = 'capital_allocation' AND t.created_at >= now() - interval '1 minute');
  r := r || ('C10 1910 net=' || gl1 || ', legs on 1100=' || (SELECT count(*) FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
    JOIN chart_of_accounts c ON c.id = l.account_id WHERE e.source_type = 'treasury_row' AND c.code = '1100' AND e.source_id IN
     (SELECT t.id FROM treasury t WHERE t.tenant_id = ten AND t.category = 'capital_allocation' AND t.created_at >= now() - interval '1 minute')));
  SELECT (profit_statement_core(ten, '2026-01-01', cairo_today(), NULL)->'total'->>'net_profit')::numeric INTO prof1;
  r := r || ('C11 profit unchanged=' || (prof0 = prof1));
  BEGIN vid := allocate_capital_to_branch(A, 1, cairo_today(), 'old'); r := r || ('C12 old door ok, kind=' || (SELECT kind FROM branch_capital_allocations bca WHERE bca.id = vid));
  EXCEPTION WHEN OTHERS THEN r := r || ('C12 old door goes through the new path: ' || SQLERRM); END;
  RAISE EXCEPTION E'RESULTS (rolled back):\n%', array_to_string(r, E'\n');
END $t$;
