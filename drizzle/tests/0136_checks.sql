-- 0136 checks — rollback-only (ends with RAISE). Run after migration 0136 (or with its text pasted above for a dry-run).
-- A partner puts 1,000,000 in August, October's profit is distributed (35,945 → all to him, he is the only partner),
-- then the distribution is cancelled. His balance must go back to exactly 1,000,000 (not 964,055), the distribution's
-- journal entry must be reversed, and there is ONE active «الأرباح المحتجزة» account holding the opening stock.
DO $t$
DECLARE
  v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  v_t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
  v_p uuid := '4a260665-29aa-4510-af0f-388166b6c01e';
  v_seq jsonb; v_seq_after jsonb; r record; v_dist jsonb; v_id uuid;
  bal_before numeric; bal_after_dist numeric; bal_after_rev numeric; v_extra int; v_gl numeric;
  v_active_re int; v_re_code text; v_re_bal numeric;
BEGIN
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq FROM pg_sequences WHERE schemaname = 'public';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by, created_at)
  VALUES (v_t, v_p, 'contribution', 1000000, '0136 check', '2026-08', v_owner, '2026-08-01 10:00+02');
  SELECT current_balance INTO bal_before FROM public.v_partner_balances WHERE partner_id = v_p;

  v_dist := public.distribute_profits(v_t, NULL, 35945, '2026-10-31', '0136 check', '2026-10-01', '2026-10-31');
  v_id := (v_dist->>'distribution_id')::uuid;
  SELECT current_balance INTO bal_after_dist FROM public.v_partner_balances WHERE partner_id = v_p;

  PERFORM public.reverse_profit_distribution(v_t, v_id, '0136 check');
  SELECT current_balance INTO bal_after_rev FROM public.v_partner_balances WHERE partner_id = v_p;
  SELECT count(*) INTO v_extra FROM public.partner_transactions WHERE partner_id = v_p AND transaction_type = 'capital_adjustment';
  -- the distribution's entry + its reversal net to zero on every account
  SELECT coalesce(sum(abs(x.v)), 0) INTO v_gl FROM (
    SELECT l.account_id, sum(l.debit - l.credit) AS v FROM public.journal_entries e JOIN public.journal_entry_lines l ON l.entry_id = e.id
     WHERE e.tenant_id = v_t AND e.source_id = v_id GROUP BY 1) x;

  SELECT count(*), min(code) INTO v_active_re, v_re_code FROM public.chart_of_accounts
   WHERE tenant_id = v_t AND is_active AND code IN ('3300', '3800');
  SELECT round(sum(l.credit - l.debit), 2) INTO v_re_bal FROM public.journal_entry_lines l JOIN public.chart_of_accounts c ON c.id = l.account_id
   WHERE c.tenant_id = v_t AND c.code = '3800';

  FOR r IN SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' LOOP
    IF (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS DISTINCT FROM r.last_value::text
       AND (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS NOT NULL THEN
      PERFORM setval(format('%I.%I', r.schemaname, r.sequencename), (v_seq ->> (r.schemaname || '.' || r.sequencename))::bigint);
    END IF;
  END LOOP;
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq_after FROM pg_sequences WHERE schemaname = 'public';

  RAISE EXCEPTION '0136 CHECKS %', jsonb_build_object(
    'balance_before', bal_before, 'after_distribution', bal_after_dist, 'after_reversal', bal_after_rev,
    'C1_back_to_start', bal_after_rev = bal_before, 'C2_no_capital_adjustment', v_extra = 0,
    'C3_journal_nets_to_zero', v_gl = 0, 'C4_one_active_retained_account', v_active_re = 1 AND v_re_code = '3800',
    'retained_3800_balance', v_re_bal, 'C5_sequences_same', v_seq = v_seq_after);
END
$t$;
