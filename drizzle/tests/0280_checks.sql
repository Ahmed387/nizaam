-- 0280 checks: «موجود بالفعل» + «مرتب الشريك» per month (rollback-only: run after the migration in ONE call, ends with RAISE).
DO $t$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; OWNER uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  PM uuid := '66e80eef-2bcb-4308-acb8-f53227cd56ac'; PN uuid := '4a260665-29aa-4510-af0f-388166b6c01e';
  seq jsonb; out text := ''; fails int := 0; v jsonb; x jsonb; tx1 uuid; tx2 uuid; tx3 uuid;
  till0 int; till1 int; je0 int; je1 int; s_m numeric; s_n numeric; net numeric; e5200 numeric; ok boolean;
BEGIN
  SELECT jsonb_object_agg(sequencename, last_value) INTO seq FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT count(*) INTO till0 FROM treasury WHERE tenant_id = T;
  SELECT count(*) INTO je0 FROM journal_entries WHERE tenant_id = T;

  -- 1) 5M + 5M «موجود بالفعل» from 1/1 → 50 / 50 in January, no till row, no entry
  tx1 := public.partner_existing_capital(PM, 5000000, '2026-01-01', 'مساهمة قديمة');
  tx2 := public.partner_existing_capital(PN, 5000000, '2026-01-01', NULL);
  SELECT share INTO s_m FROM public.partner_shares_for_month(T, '2026-01-01') WHERE partner_id = PM;
  SELECT share INTO s_n FROM public.partner_shares_for_month(T, '2026-01-01') WHERE partner_id = PN;
  SELECT count(*) INTO till1 FROM treasury WHERE tenant_id = T;
  SELECT count(*) INTO je1 FROM journal_entries WHERE tenant_id = T;
  IF s_m = 0.5 AND s_n = 0.5 AND till0 = till1 AND je0 = je1
     AND (public.partner_cards(PM)->>'capital')::numeric = 5000000
  THEN out := out || E'\nPASS 1 5M + 5M موجود بالفعل → 50% / 50% من يناير، ولا خزنة ولا قيد';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 1 shares %s / %s till %s→%s je %s→%s', s_m, s_n, till0, till1, je0, je1); END IF;

  -- 2) more than the books' net worth is accepted; a later one counts from ITS month
  tx3 := public.partner_existing_capital(PM, 1000000, '2026-11-10', NULL);
  SELECT share INTO s_m FROM public.partner_shares_for_month(T, '2026-10-01') WHERE partner_id = PM;
  SELECT round(share, 4) INTO s_n FROM public.partner_shares_for_month(T, '2026-11-01') WHERE partner_id = PM;
  IF s_m = 0.5 AND s_n = 0.5455 THEN out := out || E'\nPASS 2 مليون كمان يوم 10/11: أكتوبر 50% — نوفمبر 54.55% (11 مليون > صافي الملك ومقبول)';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 2 oct %s nov %s', s_m, s_n); END IF;

  -- 3) cancel it: shares back, the card says cancellable
  ok := (SELECT (m->>'cancellable')::boolean AND (m->>'existing')::boolean FROM jsonb_array_elements(public.partner_cards(PM)->'movements') m WHERE m->>'id' = tx3::text);
  PERFORM public.cancel_partner_transaction(tx3, 'تجربة');
  SELECT round(share, 4) INTO s_n FROM public.partner_shares_for_month(T, '2026-11-01') WHERE partner_id = PM;
  IF ok AND s_n = 0.5 AND (SELECT count(*) FROM treasury WHERE tenant_id = T) = till0
  THEN out := out || E'\nPASS 3 إلغاء «موجود بالفعل» من صفحة الشريك → النسبة رجعت 50% ومفيش حركة خزنة';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 3 cancellable %s share %s', ok, s_n); END IF;

  -- 4) محمد from October: 10,000 fixed + 10% after the fixed salaries — the owner's example on October's real profit
  PERFORM public.set_partner_pay_rule(PM, '2026-10-15', 10000, 0.10, 'after_fixed', NULL);
  net := round((public.profit_statement_core(T, '2026-10-01', '2026-10-31', NULL)->'total'->>'net_profit')::numeric, 2);
  v := public.partner_period_shares_preview('2026-10-01', '2026-10-31', '{}'::jsonb);
  IF (SELECT (r->>'amount')::numeric FROM jsonb_array_elements(v->'rows') r WHERE r->>'key' = PM::text || ':salary') = 10000
     AND (SELECT (r->>'amount')::numeric FROM jsonb_array_elements(v->'rows') r WHERE r->>'key' = PM::text || ':operating') = round(greatest(net - 10000, 0) * 0.10, 2)
     AND jsonb_array_length(v->'rows') = 2 AND (v->'months'->0->>'net_before')::numeric = net
  THEN out := out || format(E'\nPASS 4 أكتوبر: صافي %s → مرتب 10,000 + 10%% من %s = %s', net, net - 10000, round(greatest(net - 10000, 0) * 0.10, 2));
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 4 net %s preview %s', net, v); END IF;

  -- 5) September: no rule yet → nothing; the % from the WHOLE profit when chosen
  v := public.partner_period_shares_preview('2026-09-01', '2026-09-30', '{}'::jsonb);
  IF jsonb_array_length(v->'rows') = 0 THEN out := out || E'\nPASS 5 سبتمبر (قبل القاعدة) → مفيش مرتب';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 5 %s', v); END IF;

  -- 6) a loss month: the fixed is paid, the % is 0 (simulated with a month that lost, else skipped)
  PERFORM public.set_partner_pay_rule(PM, '2026-01-01', 5000, 0.10, 'all', NULL);
  SELECT jsonb_agg(z) INTO x FROM (SELECT to_char(m, 'YYYY-MM') mo, round((public.profit_statement_core(T, m, (m + interval '1 month - 1 day')::date, NULL)->'total'->>'net_profit')::numeric, 2) np
       FROM generate_series('2026-01-01'::date, '2026-09-01'::date, interval '1 month') m) z;
  v := public.partner_period_shares_preview('2026-01-01', '2026-09-30', '{}'::jsonb);
  IF (SELECT bool_and(((mo->'lines'->0->>'amount')::numeric = 5000)
          AND coalesce((SELECT (l->>'amount')::numeric FROM jsonb_array_elements(mo->'lines') l WHERE l->>'kind' = 'percent'), -1)
              = round(greatest((mo->>'net_before')::numeric, 0) * 0.10, 2))
        FROM jsonb_array_elements(v->'months') mo)
  THEN out := out || format(E'\nPASS 6 يناير→سبتمبر شهر بشهر: 5,000 ثابت كل شهر + 10%% من الربح كله (صفر في الشهر الخسران) — شهور: %s', x);
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 6 %s', v->'months'); END IF;

  -- 7) book October: one entry each Dr 5200 / Cr 3850; changing October's rule afterwards is refused
  v := public.post_partner_period_shares('2026-10-01', '2026-10-31', '{}'::jsonb);
  SELECT coalesce(sum(l.debit), 0) INTO e5200 FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN chart_of_accounts a ON a.id = l.account_id
   WHERE e.tenant_id = T AND e.source_type = 'partner_transaction' AND a.code = '5200'
     AND e.source_id IN (SELECT id FROM partner_transactions WHERE tenant_id = T AND period_from = '2026-10-01' AND period_to = '2026-10-31' AND NOT coalesce(is_void, false));
  ok := false;
  BEGIN PERFORM public.set_partner_pay_rule(PM, '2026-10-01', 1, 0, 'all', NULL);
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%اتسجل خلاص%'; END;
  IF (v->>'posted')::int = 2 AND e5200 = (v->'preview'->>'total')::numeric AND ok
  THEN out := out || format(E'\nPASS 7 تسجيل أكتوبر: %s في 5200 / 3850 — وتعديل قاعدة أكتوبر بعدها مرفوض', e5200);
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 7 %s 5200=%s refused=%s', v, e5200, ok); END IF;

  -- 8) the distribution refuses a period with pay not booked (November), and the new doors are listed
  ok := false;
  BEGIN PERFORM public.distribute_profits(T, NULL, 1, '2026-11-20', NULL, '2026-11-01', '2026-11-20');
  EXCEPTION WHEN OTHERS THEN ok := SQLERRM LIKE '%الأول%'; END;
  IF ok AND (SELECT count(*) FROM security_rpc_allowlist WHERE function_name IN ('partner_existing_capital', 'set_partner_pay_rule')) = 2
     AND (SELECT count(*) FROM public.security_exposed_definer_functions()) = 0
  THEN out := out || E'\nPASS 8 التوزيع بيرفض فترة فيها مرتب شريك مش متسجل — والبوابات الجديدة متسجلة';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 8 refused %s exposed %s', ok, (SELECT count(*) FROM public.security_exposed_definer_functions())); END IF;

  PERFORM setval(format('public.%I', k), (seq->>k)::bigint) FROM jsonb_object_keys(seq) k WHERE k IN (SELECT sequencename FROM pg_sequences WHERE schemaname = 'public');
  RAISE EXCEPTION 'DRY 0280 — fails %: %', fails, out;
END $t$;
