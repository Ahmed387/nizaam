-- 0275 checks «ظبّط رأس مال الشركاء» (rollback-only, sequences put back, ends with RAISE).
DO $t$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; OWNER uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a'; SUPER uuid := '6739ed29-f36f-4bec-8f72-0fba66b01232';
  B uuid := '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213'; SUP uuid := '3e3dd0ca-ff77-4592-affc-2e9a83a3d857';
  PA uuid := '66e80eef-2bcb-4308-acb8-f53227cd56ac'; PB uuid := '4a260665-29aa-4510-af0f-388166b6c01e';
  seq jsonb; seq2 jsonb; out text := ''; fails int := 0; info jsonb; r jsonb; n0 int; n1 int; open_ numeric;
  g3100 numeric; g3950 numeric; c0 numeric; c1 numeric; s0 numeric; s1 numeric;
  open_list jsonb := jsonb_build_array(jsonb_build_object('partner_id', '66e80eef-2bcb-4308-acb8-f53227cd56ac', 'amount', 3000000),
                                       jsonb_build_object('partner_id', '4a260665-29aa-4510-af0f-388166b6c01e', 'amount', 1000000));
BEGIN
  SELECT jsonb_object_agg(sequencename, last_value) INTO seq FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT coalesce(sum(l.credit - l.debit) FILTER (WHERE a.code = '3100'), 0), coalesce(sum(l.credit - l.debit) FILTER (WHERE a.code = '3950'), 0)
    INTO g3100, g3950 FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN chart_of_accounts a ON a.id = l.account_id
   WHERE e.tenant_id = T AND e.status = 'posted';

  -- 1) what the wizard opens with
  info := public.partner_capital_setup_info();
  open_ := (info->>'opening_equity')::numeric;
  IF info->>'start_day' = '2026-01-01' AND open_ = g3950 AND jsonb_array_length(info->'partners') = 2
  THEN out := out || format(E'\nPASS 1 البداية 1/1/2026 وصافي الملك %s وشريكين', open_);
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 1 %s (3950=%s)', info, g3950); END IF;

  -- 2) preview: numbers right, nothing written, no number used up
  BEGIN
    SELECT count(*) INTO n0 FROM partner_transactions WHERE tenant_id = T;
    r := public.partner_capital_setup(open_list, '[]'::jsonb, false);
    SELECT count(*) INTO n1 FROM partner_transactions WHERE tenant_id = T;
    SELECT jsonb_object_agg(sequencename, last_value) INTO seq2 FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL;
    IF n0 = n1 AND seq2 = seq AND (r->>'kept_as_retained')::numeric = round(open_ - 4000000, 2)
       AND (SELECT (x->>'share_after')::numeric FROM jsonb_array_elements(r->'partners') x WHERE x->>'id' = PA::text) = 0.75
    THEN out := out || E'\nPASS 2 المعاينة: 75% / 25% والباقي أرباح محتجزة — ومفيش ولا سطر اتكتب';
    ELSE fails := fails + 1; out := out || format(E'\nFAIL 2 %s rows %s→%s', r, n0, n1); END IF;
  EXCEPTION WHEN OTHERS THEN fails := fails + 1; out := out || E'\nFAIL 2: ' || SQLERRM; END;

  -- 3) more than the net worth is refused
  BEGIN
    PERFORM public.partner_capital_setup(jsonb_build_array(jsonb_build_object('partner_id', PA, 'amount', open_ + 1)), '[]'::jsonb, false);
    fails := fails + 1; out := out || E'\nFAIL 3 accepted';
  EXCEPTION WHEN OTHERS THEN out := out || E'\nPASS 3 رأس مال أكبر من صافي الملك اترفض: ' || SQLERRM; END;

  -- 4) not the company owner → refused
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', SUPER, 'role', 'authenticated')::text, true);
    PERFORM public.partner_capital_setup(open_list, '[]'::jsonb, false);
    fails := fails + 1; out := out || E'\nFAIL 4 accepted';
  EXCEPTION WHEN OTHERS THEN out := out || E'\nPASS 4 غير صاحب الشركة اترفض'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);

  -- 5) apply the opening: 3950 → 3100, books balanced, split 75/25, January capital counts it
  BEGIN
    SELECT cash_balance INTO c0 FROM public.get_branch_wallet_balances(B);
    r := public.partner_capital_setup(open_list, '[]'::jsonb, true);
    SELECT cash_balance INTO c1 FROM public.get_branch_wallet_balances(B);
    IF (r->>'books_balanced')::boolean AND c1 = c0
       AND (SELECT sum(l.credit - l.debit) FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN chart_of_accounts a ON a.id = l.account_id
             WHERE e.tenant_id = T AND e.status = 'posted' AND a.code = '3100') = g3100 + 4000000
       AND (SELECT sum(l.credit - l.debit) FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN chart_of_accounts a ON a.id = l.account_id
             WHERE e.tenant_id = T AND e.status = 'posted' AND a.code = '3950') = g3950 - 4000000
       AND (SELECT capital_share FROM equity_partners WHERE id = PA) = 0.75
       AND public.partner_capital_for_month(PA, '2026-01-01') = 3000000
       AND (public.partner_capital_setup_info()->>'opening_equity')::numeric = open_
    THEN out := out || E'\nPASS 5 اتسجل: رأس المال +4,000,000 والافتتاحي −4,000,000 والدفاتر متزنة والدرج ما اتحركش';
    ELSE fails := fails + 1; out := out || format(E'\nFAIL 5 %s cash %s→%s share=%s jan=%s', r, c0, c1,
           (SELECT capital_share FROM equity_partners WHERE id = PA), public.partner_capital_for_month(PA, '2026-01-01')); END IF;
  EXCEPTION WHEN OTHERS THEN fails := fails + 1; out := out || E'\nFAIL 5: ' || SQLERRM; END;

  -- 6) money during the year: cash in, a supplier paid from his pocket, a withdrawal
  BEGIN
    PERFORM set_config('ledger.done', '', true); PERFORM public.ledger_sync_safe(SUP, NULL, 't');
    SELECT supplier_balance INTO s0 FROM public.contact_side_balances(ARRAY[SUP], B);
    SELECT cash_balance INTO c0 FROM public.get_branch_wallet_balances(B);
    r := public.partner_capital_setup('[]'::jsonb, jsonb_build_array(
           jsonb_build_object('kind', 'cash', 'partner_id', PA, 'amount', 100000, 'date', '2026-03-01', 'branch_id', B, 'method', 'cash'),
           jsonb_build_object('kind', 'supplier', 'partner_id', PB, 'amount', 50000, 'date', '2026-03-02', 'branch_id', B, 'supplier_id', SUP),
           jsonb_build_object('kind', 'withdrawal', 'partner_id', PA, 'amount', 20000, 'date', '2026-04-01', 'branch_id', B, 'method', 'cash')), true);
    SELECT cash_balance INTO c1 FROM public.get_branch_wallet_balances(B);
    PERFORM set_config('ledger.done', '', true); PERFORM public.ledger_sync_safe(SUP, NULL, 't');
    SELECT supplier_balance INTO s1 FROM public.contact_side_balances(ARRAY[SUP], B);
    IF c1 = c0 + 80000 AND s1 = s0 - 50000 AND (r->>'books_balanced')::boolean
       AND (public.partner_cards(PA)->>'capital')::numeric = 3080000 AND (public.partner_cards(PB)->>'capital')::numeric = 1050000
       AND (SELECT capital_share FROM equity_partners WHERE id = PA) = round(3080000 / 4130000.0, 4)
    THEN out := out || E'\nPASS 6 كاش +100,000 / مورد اتدفعله 50,000 من جيب الشريك / سحب 20,000 → الدرج +80,000 والمورد −50,000 والنسب اتحدثت';
    ELSE fails := fails + 1; out := out || format(E'\nFAIL 6 cash %s→%s supplier %s→%s %s', c0, c1, s0, s1, r); END IF;
  EXCEPTION WHEN OTHERS THEN fails := fails + 1; out := out || E'\nFAIL 6: ' || SQLERRM; END;

  -- 7) running it again replaces the opening (old rows kept, voided), the moves stay
  BEGIN
    r := public.partner_capital_setup(jsonb_build_array(jsonb_build_object('partner_id', PA, 'amount', 2000000), jsonb_build_object('partner_id', PB, 'amount', 2000000)), '[]'::jsonb, true);
    IF (r->>'books_balanced')::boolean
       AND (SELECT count(*) FROM partner_transactions WHERE tenant_id = T AND transaction_type = 'capital_adjustment' AND is_void) = 2
       AND (SELECT sum(l.credit - l.debit) FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN chart_of_accounts a ON a.id = l.account_id
             WHERE e.tenant_id = T AND e.status = 'posted' AND a.code = '3950') = g3950 - 4000000
       AND (public.partner_cards(PA)->>'capital')::numeric = 2080000 AND (public.partner_cards(PB)->>'capital')::numeric = 2050000
    THEN out := out || E'\nPASS 7 إعادة التظبيط: القديم اتلغى (محفوظ في السجل) والجديد مكانه والحركات زي ما هي';
    ELSE fails := fails + 1; out := out || format(E'\nFAIL 7 %s', r); END IF;
  EXCEPTION WHEN OTHERS THEN fails := fails + 1; out := out || E'\nFAIL 7: ' || SQLERRM; END;

  -- 8) bad moves are refused before anything is written
  BEGIN
    PERFORM public.partner_capital_setup('[]'::jsonb, jsonb_build_array(jsonb_build_object('kind', 'withdrawal', 'partner_id', PB, 'amount', 9000000, 'date', '2026-05-01', 'branch_id', B)), false);
    fails := fails + 1; out := out || E'\nFAIL 8a accepted';
  EXCEPTION WHEN OTHERS THEN out := out || E'\nPASS 8a سحب أكبر من رأس ماله اترفض'; END;
  BEGIN
    PERFORM public.partner_capital_setup('[]'::jsonb, jsonb_build_array(jsonb_build_object('kind', 'cash', 'partner_id', PB, 'amount', 10, 'date', '2025-12-31', 'branch_id', B)), false);
    fails := fails + 1; out := out || E'\nFAIL 8b accepted';
  EXCEPTION WHEN OTHERS THEN out := out || E'\nPASS 8b حركة قبل بداية الدفاتر اترفضت'; END;

  -- 9) after a profit distribution → refused
  BEGIN
    INSERT INTO partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year) VALUES (T, PA, 'profit_share', 1, 'فحص', '2026-01');
    PERFORM public.partner_capital_setup(open_list, '[]'::jsonb, false);
    fails := fails + 1; out := out || E'\nFAIL 9 accepted';
  EXCEPTION WHEN OTHERS THEN out := out || E'\nPASS 9 بعد توزيع أرباح اترفض: ' || SQLERRM; END;

  IF (SELECT count(*) FROM public.security_exposed_definer_functions()) = 0 THEN out := out || E'\nPASS 10 مفيش دوال مكشوفة';
  ELSE fails := fails + 1; out := out || E'\nFAIL 10 exposed'; END IF;

  PERFORM setval('public.' || k, (seq->>k)::bigint, true) FROM jsonb_object_keys(seq) k;
  RAISE EXCEPTION E'CHECKS 0275 fails=% %', fails, out;
END $t$;
