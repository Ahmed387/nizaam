-- 0135 checks — rollback-only (ends with RAISE). Run after migration 0135 (or with its text pasted above for a dry-run).
-- The card (owner_business_snapshot), the income statement (profit_statement) and the distribution
-- (compute_net_profit_for_period) give the SAME net profit for every month of 2026, the lines add up, and only the
-- management can read them.
DO $t$
DECLARE
  v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  v_t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
  v_cashier uuid;
  d date; e date; v_card jsonb; v_st jsonb; v_dist jsonb; v_rec jsonb; tot jsonb;
  c1 int := 0; c2 int := 0; c3 int := 0; c4 int := 0; c6 text; v_refused boolean := false;
  v_months jsonb := '[]'::jsonb; v_oct jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  FOR d IN SELECT generate_series('2026-01-01'::date, '2026-10-01', '1 month')::date LOOP
    e := (d + interval '1 month - 1 day')::date;
    v_card := public.owner_business_snapshot(d, e);
    v_st := public.profit_statement(d, e);
    v_dist := public.compute_net_profit_for_period(v_t, d, e);
    tot := v_st->'total';
    -- C1: card = statement = distribution
    IF (v_card->'total'->>'net_profit')::numeric IS DISTINCT FROM (tot->>'net_profit')::numeric
       OR abs((v_dist->>'net_profit')::numeric - (tot->>'net_profit')::numeric) > 0.01 THEN c1 := c1 + 1; END IF;
    -- C2: net = revenue − expense of the books
    IF abs((tot->>'net_profit')::numeric - ((tot->>'revenue_total')::numeric - (tot->>'expense_total')::numeric)) > 0.02 THEN c2 := c2 + 1; END IF;
    -- C3: the lines add up
    IF abs((tot->>'net_profit')::numeric - ((tot->>'sales')::numeric - (tot->>'returns')::numeric - (tot->>'cogs')::numeric
          - (tot->>'expenses')::numeric + (tot->>'other_income')::numeric + (tot->>'count_diff')::numeric)) > 0.02 THEN c3 := c3 + 1; END IF;
    -- C4: the branches add up to the total
    IF abs((tot->>'net_profit')::numeric - (SELECT coalesce(sum((x->>'net_profit')::numeric), 0) FROM jsonb_array_elements(v_st->'branches') x)) > 0.05 THEN c4 := c4 + 1; END IF;
    v_months := v_months || jsonb_build_object(to_char(d, 'YYYY-MM'), (tot->>'net_profit')::numeric);
    IF d = '2026-10-01' THEN v_oct := tot; END IF;
  END LOOP;

  -- C5: the books-vs-documents guard runs (today's data still has entries of deleted invoices)
  v_rec := public.profit_reconciliation('2026-01-01', '2026-10-31');

  -- C6: a cashier cannot read the statement
  SELECT ur.user_id INTO v_cashier FROM public.user_roles ur WHERE ur.tenant_id = v_t AND ur.role = 'cashier'
     AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ur.user_id AND x.role IN ('owner', 'admin')) LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cashier, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.profit_statement('2026-10-01', '2026-10-31');
  EXCEPTION WHEN OTHERS THEN v_refused := true; c6 := SQLERRM;
  END;

  RAISE EXCEPTION '0135 CHECKS %', jsonb_build_object(
    'C1_card_statement_distribution_differ', c1, 'C2_net_not_rev_minus_exp', c2, 'C3_lines_dont_add_up', c3,
    'C4_branches_dont_add_up', c4, 'C6_cashier_refused', v_refused, 'C6_msg', c6,
    'october', v_oct, 'months', v_months,
    'reconciliation_ok', v_rec->'ok', 'orphan_sales_entries', v_rec->'orphan_sales_entries',
    'reconciliation_branches', v_rec->'branches');
END
$t$;
