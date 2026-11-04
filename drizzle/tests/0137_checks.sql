-- 0137 checks — rollback-only (ends with RAISE). Run after migration 0137 (or with its text pasted above for a dry-run).
-- A test partner «تجربة 0137» in عبدالمنعم (cash):
--  1) put in 1,000,000 on 15/9 → cards 1,000,000 / 0 / 1,000,000; till +1,000,000; books 1100 +1,000,000, 3100 −1,000,000
--  2) take 200,000 «من رأس المال» → capital 800,000; books 3100 +200,000
--  3) he gets 150,000 profit (a share written by hand for the test) and takes 200,000 «من الربح» → profit 0, advance 50,000
--     (books 3850 +150,000, 1400 +50,000, 1100 −200,000)
--  4) October distribution 30,000 (he is the only partner with capital in October) → 30,000 pays the advance back:
--     advance 20,000 «partially_paid», profit card 0, entry Dr 3800 30,000 / Cr 1400 30,000 net
--  5) reverse the distribution → advance 50,000 again, the «سداد سلفة» line void
--  6) cancel the profit withdrawal → advance cancelled, profit 150,000 again, till and books back
--  7) refused: capital withdrawal above his capital; a branch manager; the old record_partner_transaction
--  8) the same-day edit of the contribution 1,000,000 → 900,000 → capital 700,000, till of 15/9 −100,000 net
--  9) operating share 10%: October distribution refused until the shares are booked; booking = Dr 5200 / Cr 3850 = 10% of
--     October's net profit and «available» drops by the same; a period with no profit asks the owner (typed 5,000 → booked)
-- 10) «موظف وشريك» (محمد ياسر, fixed salary 4,500) → his login gets a partner_users row, his base_salary 4,500
DO $t$
DECLARE
  v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  v_mgr uuid := '598491e8-589f-4ad1-88a6-62d6e9114bde';
  v_t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
  v_br uuid := '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213';
  v_emp uuid := '42f0b831-a5e0-4f56-a857-7b2a56fb871b';
  v_seq jsonb; v_seq_after jsonb; r record; x jsonb; c jsonb; v_p uuid; v_p2 uuid; v_contrib uuid; v_wd jsonb; v_dist jsonb;
  v_till0 numeric; v_err text; v_av0 numeric; v_av1 numeric; v_net numeric; v_tx uuid;
BEGIN
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq FROM pg_sequences WHERE schemaname = 'public';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET CONSTRAINTS ALL IMMEDIATE;
  CREATE TEMP TABLE t0137 (k text, v jsonb) ON COMMIT DROP;
  CREATE OR REPLACE FUNCTION pg_temp.gl() RETURNS jsonb LANGUAGE sql AS $f$
    SELECT coalesce(jsonb_object_agg(code, s), '{}') FROM (
      SELECT c.code, round(sum(l.debit - l.credit), 2) s
        FROM public.journal_entries e JOIN public.journal_entry_lines l ON l.entry_id = e.id JOIN public.chart_of_accounts c ON c.id = l.account_id
       WHERE e.tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71' AND e.status = 'posted' AND e.created_at = now()
         AND c.code IN ('1100', '1400', '3100', '3800', '3850', '5200')
       GROUP BY 1) g WHERE s <> 0;
  $f$;
  CREATE OR REPLACE FUNCTION pg_temp.till() RETURNS numeric LANGUAGE sql AS $f$
    SELECT round(coalesce(sum(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0), 2) FROM public.treasury
     WHERE branch_id = '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213' AND coalesce(payment_method, 'cash') = 'cash';
  $f$;
  CREATE OR REPLACE FUNCTION pg_temp.cards(p uuid) RETURNS jsonb LANGUAGE sql AS $f$
    SELECT jsonb_build_object('contrib', c->'contributions', 'capw', c->'capital_withdrawals', 'capital', c->'capital', 'profit', c->'profit', 'adv', c->'advances')
      FROM (SELECT public.partner_cards(p) c) x;
  $f$;
  v_till0 := pg_temp.till();

  v_p := public.save_partner(jsonb_build_object('name', 'تجربة 0137', 'role_kind', 'partner', 'start_date', '2026-01-01'));

  -- 1) contribution on 15/9
  x := public.partner_money(v_p, 'contribution', 1000000, 'capital', NULL, v_br, 'cash', '2026-09-15', NULL);
  SELECT id INTO v_contrib FROM public.partner_transactions WHERE related_treasury_id = (x->>'treasury_id')::uuid;
  INSERT INTO t0137 VALUES ('1_cards', pg_temp.cards(v_p)), ('1_till', to_jsonb(pg_temp.till() - v_till0)), ('1_gl', pg_temp.gl()),
    ('1_till_day', to_jsonb((SELECT transaction_date FROM public.treasury WHERE id = (x->>'treasury_id')::uuid))),
    ('1_voucher_none', to_jsonb(NOT EXISTS (SELECT 1 FROM public.vouchers WHERE treasury_id = (x->>'treasury_id')::uuid))),
    ('1_je_branch', to_jsonb((SELECT branch_id = v_br FROM public.journal_entries WHERE source_type = 'treasury_row' AND source_id = (x->>'treasury_id')::uuid)));

  -- 2) from capital
  x := public.partner_money(v_p, 'withdrawal', 200000, 'capital', NULL, v_br, 'cash', NULL, NULL);
  INSERT INTO t0137 VALUES ('2_cards', pg_temp.cards(v_p)), ('2_gl', pg_temp.gl());

  -- 3) 150,000 profit, then 200,000 «من الربح»
  PERFORM set_config('app.partner_money', '1', true);
  INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, movement_date)
  VALUES (v_t, v_p, 'profit_share', 150000, 'تجربة 0137 — ربح', '2026-10-31');
  PERFORM set_config('app.partner_money', '', true);
  v_wd := public.partner_money(v_p, 'withdrawal', 200000, 'profit', NULL, v_br, 'cash', NULL, NULL);
  INSERT INTO t0137 VALUES ('3_res', v_wd - 'cards'), ('3_cards', pg_temp.cards(v_p)), ('3_gl', pg_temp.gl()),
    ('3_advance_trigger_no_partner_cash_row', to_jsonb(NOT EXISTS (SELECT 1 FROM public.treasury WHERE reference_id = (v_wd->>'advance_id')::uuid)));

  -- 4) October distribution 30,000
  v_dist := public.distribute_profits(v_t, NULL, 30000, '2026-11-04', 'تجربة 0137', '2026-10-01', '2026-10-31');
  INSERT INTO t0137 VALUES ('4_res', v_dist), ('4_cards', pg_temp.cards(v_p)),
    ('4_adv', (SELECT jsonb_build_object('remaining', remaining_amount, 'status', status) FROM public.partner_advances WHERE id = (v_wd->>'advance_id')::uuid)),
    ('4_entry', (SELECT jsonb_object_agg(c.code, round(s, 2)) FROM (SELECT l.account_id, sum(l.debit - l.credit) s FROM public.journal_entry_lines l
        WHERE l.entry_id = (v_dist->>'journal_entry_id')::uuid GROUP BY 1) q JOIN public.chart_of_accounts c ON c.id = q.account_id)),
    ('4_no_cash_journal_from_payment', to_jsonb(NOT EXISTS (SELECT 1 FROM public.journal_entries WHERE source_type = 'partner_advance_payment'
        AND source_id IN (SELECT id FROM public.partner_advance_payments WHERE reference_id = (v_dist->>'distribution_id')::uuid))));

  -- 5) reverse it
  PERFORM public.reverse_profit_distribution(v_t, (v_dist->>'distribution_id')::uuid, 'تجربة 0137');
  INSERT INTO t0137 VALUES ('5_cards', pg_temp.cards(v_p)),
    ('5_adv', (SELECT jsonb_build_object('remaining', remaining_amount, 'status', status) FROM public.partner_advances WHERE id = (v_wd->>'advance_id')::uuid)),
    ('5_settle_void', to_jsonb((SELECT bool_and(is_void) FROM public.partner_transactions WHERE distribution_id = (v_dist->>'distribution_id')::uuid)));

  -- 6) cancel the profit withdrawal
  SELECT id INTO v_tx FROM public.partner_transactions WHERE related_treasury_id = (v_wd->>'treasury_id')::uuid LIMIT 1;
  x := public.cancel_partner_transaction(v_tx, 'تجربة 0137');
  INSERT INTO t0137 VALUES ('6_res', x), ('6_cards', pg_temp.cards(v_p)), ('6_gl', pg_temp.gl()), ('6_till', to_jsonb(pg_temp.till() - v_till0)),
    ('6_adv_status', to_jsonb((SELECT status FROM public.partner_advances WHERE id = (v_wd->>'advance_id')::uuid))),
    ('6_mirror_same_day', to_jsonb((SELECT count(*) FROM public.treasury WHERE category = 'partner_cancel' AND reference_id = v_p AND transaction_date = public.cairo_today())));

  -- 7) refused
  BEGIN PERFORM public.partner_money(v_p, 'withdrawal', 900000, 'capital', NULL, v_br, 'cash', NULL, NULL); v_err := 'allowed'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  INSERT INTO t0137 VALUES ('7_capital_above', to_jsonb(v_err));
  BEGIN PERFORM public.record_partner_transaction(v_p, 'contribution', 5, 'x', '2026-11', NULL, NULL); v_err := 'allowed'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  INSERT INTO t0137 VALUES ('7_old_door', to_jsonb(v_err));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.partner_money(v_p, 'contribution', 5, 'capital', NULL, v_br, 'cash', NULL, NULL); v_err := 'allowed'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  INSERT INTO t0137 VALUES ('7_manager', to_jsonb(v_err));
  BEGIN PERFORM public.partner_cards(v_p); v_err := 'allowed'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  INSERT INTO t0137 VALUES ('7_manager_cards', to_jsonb(v_err));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- 8) same-day edit 1,000,000 → 900,000
  x := public.edit_partner_contribution(v_contrib, 900000, NULL);
  INSERT INTO t0137 VALUES ('8_cards', pg_temp.cards(v_p)), ('8_till', to_jsonb(pg_temp.till() - v_till0)),
    ('8_day_net', to_jsonb((SELECT sum(CASE WHEN type = 'income' THEN amount ELSE -amount END) FROM public.treasury
                             WHERE reference_id = v_p AND transaction_date = '2026-09-15')));

  -- 9) operating share 10%
  PERFORM public.save_partner(jsonb_build_object('id', v_p, 'name', 'تجربة 0137', 'role_kind', 'partner', 'operating_share', 0.10));
  BEGIN PERFORM public.distribute_profits(v_t, NULL, 1000, '2026-11-04', NULL, '2026-10-01', '2026-10-31'); v_err := 'allowed'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  v_av0 := (public.available_to_distribute(v_t, '2026-10-01', '2026-10-31')->>'available')::numeric;
  x := public.partner_period_shares_preview('2026-10-01', '2026-10-31', '{}'::jsonb);
  v_net := (x->>'net_before')::numeric;
  x := public.post_partner_period_shares('2026-10-01', '2026-10-31', '{}'::jsonb);
  v_av1 := (public.available_to_distribute(v_t, '2026-10-01', '2026-10-31')->>'available')::numeric;
  INSERT INTO t0137 VALUES ('9_refused_before', to_jsonb(v_err)), ('9_share', x->'preview'->'rows'->0->'amount'),
    ('9_share_is_10pct', to_jsonb(round(v_net * 0.10, 2) = ((x->'preview'->'rows'->0->>'amount')::numeric))),
    ('9_available_drop', to_jsonb(round(v_av0 - v_av1, 2))), ('9_gl', pg_temp.gl()), ('9_cards', pg_temp.cards(v_p));
  x := public.partner_period_shares_preview('2025-06-01', '2025-06-01', '{}'::jsonb);
  BEGIN PERFORM public.post_partner_period_shares('2025-06-01', '2025-06-01', '{}'::jsonb); v_err := 'allowed'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  INSERT INTO t0137 VALUES ('9_loss_needs_owner', x->'rows'->0->'needs_owner'), ('9_loss_refused', to_jsonb(v_err));
  x := public.post_partner_period_shares('2025-06-01', '2025-06-01', jsonb_build_object(v_p::text || ':operating', 5000));
  INSERT INTO t0137 VALUES ('9_loss_typed', x->'preview'->'rows'->0->'amount');

  -- 10) employee and partner
  v_p2 := public.save_partner(jsonb_build_object('employee_id', v_emp, 'role_kind', 'employee_partner', 'salary_mode', 'fixed', 'salary_amount', 4500));
  INSERT INTO t0137 VALUES ('10_name', to_jsonb((SELECT name FROM public.equity_partners WHERE id = v_p2))),
    ('10_portal', to_jsonb(EXISTS (SELECT 1 FROM public.partner_users pu JOIN public.employees e ON e.user_id = pu.user_id WHERE e.id = v_emp AND pu.partner_id = v_p2))),
    ('10_salary', to_jsonb((SELECT base_salary FROM public.employees WHERE id = v_emp)));

  FOR r IN SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' LOOP
    IF (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS DISTINCT FROM r.last_value::text
       AND (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS NOT NULL THEN
      PERFORM setval(format('%I.%I', r.schemaname, r.sequencename), (v_seq ->> (r.schemaname || '.' || r.sequencename))::bigint);
    END IF;
  END LOOP;
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq_after FROM pg_sequences WHERE schemaname = 'public';
  INSERT INTO t0137 VALUES ('seq_same', to_jsonb(v_seq = v_seq_after));

  RAISE EXCEPTION '0137 CHECKS %', (SELECT jsonb_object_agg(k, v) FROM t0137);
END
$t$;
