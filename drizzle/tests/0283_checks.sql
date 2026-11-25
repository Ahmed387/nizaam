-- 0283 checks «الفرق ده راح فين؟» (rollback-only: run after the migration in ONE call, ends with RAISE).
DO $t$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; OWNER uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  PM uuid := '66e80eef-2bcb-4308-acb8-f53227cd56ac'; PN uuid := '4a260665-29aa-4510-af0f-388166b6c01e';
  seq jsonb; out text := ''; fails int := 0; info jsonb; r jsonb; ok boolean; d1 uuid; d2 uuid; d3 uuid;
  tx_m uuid; tx_n uuid; till0 int; np0 numeric; np1 numeric; gap numeric; g jsonb; s_n numeric; je0 int; tb numeric;
BEGIN
  SELECT jsonb_object_agg(sequencename, last_value) INTO seq FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT count(*) INTO till0 FROM treasury WHERE tenant_id = T;
  np0 := (public.profit_statement_core(T, '2026-01-01', '2026-11-25', NULL)->'total'->>'net_profit')::numeric;
  -- per account: Σ debit − credit of every posted entry (to see what one decision moves)
  CREATE TEMP TABLE gl0 ON COMMIT DROP AS SELECT a.code, round(sum(l.debit - l.credit), 2) bal FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
    JOIN chart_of_accounts a ON a.id = l.account_id WHERE e.tenant_id = T AND e.status = 'posted' GROUP BY 1;

  -- 1) the books' opening, nothing decided
  info := public.partner_capital_gap_info();
  IF (info->>'opening')::numeric = 4845828.43 AND (info->>'capital_new')::numeric = 0 AND info->>'start_day' = '2026-01-01'
  THEN out := out || E'\nPASS 1 صافي الملك في الدفاتر يوم 1/1 = 4,845,828.43 ومفيش رأس مال لسه';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 1 %s', info); END IF;

  -- 2) ناصر 6M + محمد 4M «موجود بالفعل» → the difference
  tx_n := public.partner_existing_capital(PN, 6000000, '2026-01-01', NULL);
  tx_m := public.partner_existing_capital(PM, 4000000, '2026-01-01', NULL);
  info := public.partner_capital_gap_info(); gap := (info->>'gap')::numeric;
  IF gap = 5154171.57 AND (info->>'capital_new')::numeric = 10000000 THEN out := out || E'\nPASS 2 ناصر 6M + محمد 4M → الفرق 5,154,171.57';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 2 %s', info); END IF;

  -- 3) preview: 4M loss + ناصر drew the rest (his % goes down) — balanced, nothing written; a wrong total is refused
  SELECT count(*) INTO je0 FROM journal_entries WHERE tenant_id = T;
  g := jsonb_build_array(jsonb_build_object('kind', 'loss', 'amount', 4000000),
                         jsonb_build_object('kind', 'drawing', 'partner_id', PN, 'amount', 1154171.57, 'keep_share', false));
  r := public.partner_capital_gap_settle(g, false);
  ok := false;
  BEGIN PERFORM public.partner_capital_gap_settle(jsonb_build_array(jsonb_build_object('kind', 'loss', 'amount', 4000000)), false);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%فاضل%'; END;
  IF (r->>'balanced')::boolean AND NOT (r->>'applied')::boolean AND ok AND (SELECT count(*) FROM journal_entries WHERE tenant_id = T) = je0
  THEN out := out || E'\nPASS 3 المعاينة متوازنة ومكتبتش حاجة — ومجموع ناقص اترفض «فاضل 1,154,171.57»';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 3 %s refused %s', r, ok); END IF;

  -- 4) apply: one entry on 1/1 — 3950 −4,845,828.43 → 0, 3100 +10M, 3800 −4M (loss), 3200 −1,154,171.57; tills / profit unchanged
  r := public.partner_capital_gap_settle(g, true, 'تجربة');
  d1 := (r->>'id')::uuid;
  SELECT round(sum(l.debit - l.credit), 2) INTO tb FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.id = (r->>'journal_entry_id')::uuid;
  np1 := (public.profit_statement_core(T, '2026-01-01', '2026-11-25', NULL)->'total'->>'net_profit')::numeric;
  SELECT round(share, 4) INTO s_n FROM public.partner_shares_for_month(T, '2026-01-01') WHERE partner_id = PN;
  IF tb = 0 AND np1 = np0 AND (SELECT count(*) FROM treasury WHERE tenant_id = T) = till0
     AND (SELECT entry_date FROM journal_entries WHERE id = (r->>'journal_entry_id')::uuid) = '2026-01-01'
     AND (SELECT jsonb_object_agg(a.code, round(sum, 2)) FROM (SELECT a.code, sum(l.debit - l.credit) FROM journal_entry_lines l JOIN chart_of_accounts a ON a.id = l.account_id
            WHERE l.entry_id = (r->>'journal_entry_id')::uuid GROUP BY 1) a) = '{"3100": -10000000.00, "3200": 1154171.57, "3800": 4000000.00, "3950": 4845828.43}'::jsonb
     AND (public.partner_cards(PN)->>'capital')::numeric = 4845828.43 AND s_n = round(4845828.43 / 8845828.43, 4)
  THEN out := out || format(E'\nPASS 4 قيد واحد يوم 1/1 متوازن: رأس مال الشركاء 10M ← رصيد افتتاحي 4.85M + خسائر 4M + مسحوبات ناصر 1.15M — الخزن والربح زي ما هم، ونسبة ناصر بقت %s%%', round(s_n * 100, 2));
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 4 tb %s profit %s→%s share %s %s', tb, np0, np1, s_n, r); END IF;

  -- 5) decided: nothing left; its «موجود بالفعل» rows and its drawing can't be cancelled alone
  info := public.partner_capital_gap_info();
  ok := false; BEGIN PERFORM public.cancel_partner_transaction(tx_n, 'تجربة'); EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%اتقرر مصير%'; END;
  IF (info->>'capital_new')::numeric = 0 AND (info->>'gap')::numeric = 0 AND (info->>'opening_left')::numeric = 0 AND ok
  THEN out := out || E'\nPASS 5 بعد القرار: مفيش فرق — ومينفعش تلغي رأس المال ده لوحده';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 5 %s refused %s', info, ok); END IF;

  -- 6) cancel the decision: entry reversed on 1/1, the drawing voided, the difference is back
  PERFORM public.partner_capital_gap_cancel(d1, 'تجربة الإلغاء');
  info := public.partner_capital_gap_info();
  IF (info->>'gap')::numeric = 5154171.57 AND (public.partner_cards(PN)->>'capital')::numeric = 6000000
     AND NOT EXISTS (SELECT 1 FROM (SELECT a.code, sum(l.debit - l.credit) s FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
           JOIN chart_of_accounts a ON a.id = l.account_id WHERE e.tenant_id = T AND e.status = 'posted' GROUP BY 1) x
           JOIN gl0 USING (code) WHERE round(x.s, 2) <> gl0.bal)
  THEN out := out || E'\nPASS 6 إلغاء القرار: القيد اتعكس يوم 1/1 والسحب اتلغى — كل الحسابات رجعت زي الأول والفرق رجع 5,154,171.57';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 6 %s', info); END IF;

  -- 7) «سيبه زي ما هو»: no entry, the card stops asking
  SELECT count(*) INTO je0 FROM journal_entries WHERE tenant_id = T;
  r := public.partner_capital_gap_settle(jsonb_build_array(jsonb_build_object('kind', 'leave')), true);
  d2 := (r->>'id')::uuid;
  info := public.partner_capital_gap_info();
  IF (SELECT count(*) FROM journal_entries WHERE tenant_id = T) = je0 AND (info->>'capital_new')::numeric = 0 AND (info->>'opening_left')::numeric = 4845828.43
  THEN out := out || E'\nPASS 7 «سيبه زي ما هو»: مفيش قيد خالص والرصيد الافتتاحي فاضل 4,845,828.43';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 7 %s', info); END IF;

  -- 8) capital LESS than the books (3M): the rest = retained profit, Cr 3800 1,845,828.43
  PERFORM public.partner_capital_gap_cancel(d2, 'تجربة');
  UPDATE partner_transactions SET is_void = true WHERE id IN (tx_n, tx_m);
  PERFORM public.partner_existing_capital(PN, 2000000, '2026-01-01', NULL);
  PERFORM public.partner_existing_capital(PM, 1000000, '2026-01-01', NULL);
  r := public.partner_capital_gap_settle('[]'::jsonb, true);
  IF (r->>'gap')::numeric = -1845828.43
     AND (SELECT sum(l.credit - l.debit) FROM journal_entry_lines l JOIN chart_of_accounts a ON a.id = l.account_id
           WHERE l.entry_id = (r->>'journal_entry_id')::uuid AND a.code = '3800') = 1845828.43
  THEN out := out || E'\nPASS 8 رأس مال 3M أقل من الدفاتر: الباقي 1,845,828.43 اتسجل أرباح محتجزة';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 8 %s', r); END IF;

  IF (SELECT count(*) FROM security_rpc_allowlist WHERE function_name LIKE 'partner_capital_gap_%') = 3 AND (SELECT count(*) FROM public.security_exposed_definer_functions()) = 0
  THEN out := out || E'\nPASS 9 البوابات الجديدة متسجلة ومفيش دالة مكشوفة';
  ELSE fails := fails + 1; out := out || E'\nFAIL 9 security'; END IF;

  PERFORM setval(format('public.%I', k), (seq->>k)::bigint) FROM jsonb_object_keys(seq) k WHERE k IN (SELECT sequencename FROM pg_sequences WHERE schemaname = 'public');
  RAISE EXCEPTION 'DRY 0283 — fails %: %', fails, out;
END $t$;
