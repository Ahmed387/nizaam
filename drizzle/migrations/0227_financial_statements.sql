-- 0227 — «القوائم المالية» in one page + «تحليل القوائم المالية» (owner 2026-11-15 «صفحة او تابه مسماه القوائم المالية وكل تابه
-- فيها قائمة لوحدها … وبعد كدا تابه بتحلل القوائم المالية»; answers: trial balance stays with the books, comparison = the period
-- before by default or two periods he picks, ONE filter (period + branch) for every tab, «هل بنكسب؟» / الربحية stay in reports).
-- Read only, from the books. Two readers:
--   * balance_sheet(as_of, branch) — every asset / liability / equity account at the end of a day, ONE scan on the server (the
--     page used to read every journal line into the browser). Customers / suppliers are shown as the accounts' balances
--     (Σ مدين / Σ دائن per account, contacts_debit_credit) instead of the gross 1200 / 2100: since 0212 the books carry each
--     account's whole current account there (2026-11-15: 1200 = 32,005,105.74, 2100 = 32,257,407.32), and only their DIFFERENCE
--     is a balance — it equals Σ مدين − Σ دائن to the piaster (9,924,638.47 − 10,176,940.05 = −252,301.58). Totals still balance.
--   * financial_analysis(from, to, cmp_from, cmp_to, branch) — the income statement of both periods (same groups as
--     profit_statement_core), the balance items at the start and end of both periods, and the last 12 months; ONE scan of the
--     journal lines summed per day × account first (profit_statement_core over a year takes ≈ 4 s; the browser limit is 8 s). The ratios are computed on the
--     screen from these numbers (src/lib/financialAnalysis.ts).
-- Permission: admin / super admin / admin_acc_statements.view (like equity_changes / cogs_statement).

CREATE OR REPLACE FUNCTION public.fin_statements_guard(p_branch uuid)
 RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid()) OR public.has_permission(auth.uid(), 'admin_acc_statements.view')) THEN
    RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
  END IF;
  IF p_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch AND tenant_id = v_t) THEN
    RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
  END IF;
  RETURN v_t;
END
$function$;
REVOKE ALL ON FUNCTION public.fin_statements_guard(uuid) FROM PUBLIC, anon, authenticated;

-- Σ مدين / Σ دائن of the accounts at the end of two days (contacts_debit_credit = «أرصدة الحسابات بتاريخ سابق»)
CREATE OR REPLACE FUNCTION public.fin_accounts_dc(p_branch uuid, p_a date, p_b date)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'a', jsonb_build_object('receivables', round(coalesce(sum(prev_debit), 0), 2), 'payables', round(coalesce(sum(prev_credit), 0), 2)),
    'b', jsonb_build_object('receivables', round(coalesce(sum(cur_debit), 0), 2), 'payables', round(coalesce(sum(cur_credit), 0), 2)))
    FROM public.contacts_debit_credit__all(p_branch, p_a, p_b)
$function$;
REVOKE ALL ON FUNCTION public.fin_accounts_dc(uuid, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.balance_sheet(p_as_of date, p_branch uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; v_rows jsonb; v_ni numeric; dc jsonb;
BEGIN
  v_t := public.fin_statements_guard(p_branch);
  WITH s AS (
    SELECT a.code, coalesce(a.name_ar, a.name) AS name, a.account_type AS t,
           sum(CASE WHEN a.normal_balance = 'debit' THEN l.debit - l.credit ELSE l.credit - l.debit END) AS bal
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.tenant_id = v_t AND e.status = 'posted' AND e.entry_date <= p_as_of AND (p_branch IS NULL OR e.branch_id = p_branch)
     GROUP BY 1, 2, 3
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'type', t, 'amount', round(bal, 2)) ORDER BY code)
                  FILTER (WHERE t IN ('asset', 'liability', 'equity') AND code NOT IN ('1200', '2100', '2150', '1460') AND round(bal, 2) <> 0), '[]'::jsonb),
         round(coalesce(sum(bal) FILTER (WHERE t = 'revenue'), 0) - coalesce(sum(bal) FILTER (WHERE t = 'expense'), 0), 2)
    INTO v_rows, v_ni FROM s;
  dc := public.fin_accounts_dc(p_branch, p_as_of, p_as_of)->'b';
  RETURN jsonb_build_object('as_of', p_as_of, 'branch_id', p_branch, 'accounts', v_rows, 'net_income', v_ni,
                            'receivables', dc->'receivables', 'payables', dc->'payables');
END
$function$;

CREATE OR REPLACE FUNCTION public.financial_analysis(p_from date, p_to date, p_cmp_from date, p_cmp_to date, p_branch uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; v_max date := greatest(p_to, p_cmp_to); v_m0 date; v jsonb; dc1 jsonb; dc2 jsonb;
BEGIN
  v_t := public.fin_statements_guard(p_branch);
  IF p_from > p_to OR p_cmp_from > p_cmp_to THEN RAISE EXCEPTION 'الفترة غلط'; END IF;
  v_m0 := greatest(date '2026-01-01', (date_trunc('month', p_to) - interval '11 months')::date);

  WITH f AS MATERIALIZED (
    SELECT e.entry_date AS d, a.code, a.account_type AS t,
           CASE WHEN a.account_type NOT IN ('revenue', 'expense') THEN NULL
                WHEN a.code = '4900' OR (a.code = '4100' AND e.source_type LIKE 'sale_return%') THEN 'returns'
                WHEN a.code = '4100' THEN 'sales'
                WHEN a.code = '5100' THEN 'cogs'
                WHEN a.code IN ('4300', '5600') THEN 'count_diff'
                WHEN a.account_type = 'revenue' THEN 'other_income'
                ELSE 'expenses' END AS grp,
           sum(l.debit - l.credit) AS dr
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.tenant_id = v_t AND e.status = 'posted' AND e.entry_date <= v_max AND (p_branch IS NULL OR e.branch_id = p_branch)
     GROUP BY 1, 2, 3, 4   -- one row per day × account × group (≈ 10k rows instead of ≈ 200k lines)
  ),
  -- the income statement of a period (cr = credit − debit, the groups of profit_statement_core)
  pl AS (
    SELECT k, jsonb_build_object(
             'sales', round(coalesce(-sum(dr) FILTER (WHERE grp = 'sales'), 0), 2),
             'returns', round(coalesce(sum(dr) FILTER (WHERE grp = 'returns'), 0), 2),
             'cogs', round(coalesce(sum(dr) FILTER (WHERE grp = 'cogs'), 0), 2),
             'expenses', round(coalesce(sum(dr) FILTER (WHERE grp = 'expenses'), 0), 2),
             'other_income', round(coalesce(-sum(dr) FILTER (WHERE grp = 'other_income'), 0), 2),
             'count_diff', round(coalesce(-sum(dr) FILTER (WHERE grp = 'count_diff'), 0), 2)) AS j
      FROM (SELECT 'cur' AS k, f.dr, f.grp FROM f WHERE f.grp IS NOT NULL AND f.d BETWEEN p_from AND p_to
            UNION ALL SELECT 'cmp', f.dr, f.grp FROM f WHERE f.grp IS NOT NULL AND f.d BETWEEN p_cmp_from AND p_cmp_to) x
     GROUP BY k
  ),
  -- balance items at the end of a day
  dates(k, d) AS (VALUES ('cur_end', p_to), ('cur_start', p_from - 1), ('cmp_end', p_cmp_to), ('cmp_start', p_cmp_from - 1)),
  bal AS (
    SELECT dt.k, jsonb_build_object(
             'cash', round(coalesce(sum(f.dr) FILTER (WHERE f.code LIKE '11%'), 0), 2),
             'inventory', round(coalesce(sum(f.dr) FILTER (WHERE f.code = '1300'), 0), 2),
             'other_current', round(coalesce(sum(f.dr) FILTER (WHERE f.t = 'asset' AND (f.code LIKE '14%' OR f.code LIKE '19%') AND f.code <> '1460'), 0), 2),
             'fixed_net', round(coalesce(sum(f.dr) FILTER (WHERE f.t = 'asset' AND f.code LIKE '15%'), 0), 2),
             'other_assets', round(coalesce(sum(f.dr) FILTER (WHERE f.t = 'asset' AND f.code NOT LIKE '11%' AND f.code NOT IN ('1200', '1300', '1460')
                                                                AND f.code NOT LIKE '14%' AND f.code NOT LIKE '19%' AND f.code NOT LIKE '15%'), 0), 2),
             'other_liabilities', round(coalesce(-sum(f.dr) FILTER (WHERE f.t = 'liability' AND f.code NOT IN ('2100', '2150')), 0), 2),
             'equity_accounts', round(coalesce(-sum(f.dr) FILTER (WHERE f.t = 'equity'), 0), 2),
             'profit_to_date', round(coalesce(-sum(f.dr) FILTER (WHERE f.t IN ('revenue', 'expense')), 0), 2),
             'gl_accounts_net', round(coalesce(sum(f.dr) FILTER (WHERE f.code IN ('1200', '2100', '2150', '1460')), 0), 2)) AS j
      FROM dates dt LEFT JOIN f ON f.d <= dt.d
     GROUP BY dt.k
  ),
  mon AS (
    SELECT jsonb_build_object('month', to_char(m, 'YYYY-MM'),
             'net_sales', round(coalesce(-sum(dr) FILTER (WHERE grp IN ('sales', 'returns')), 0), 2),
             'cogs', round(coalesce(sum(dr) FILTER (WHERE grp = 'cogs'), 0), 2),
             'net_profit', round(coalesce(-sum(dr), 0), 2)) AS e, m
      FROM (SELECT date_trunc('month', d)::date AS m, grp, dr FROM f WHERE d BETWEEN v_m0 AND p_to AND grp IS NOT NULL) x
     GROUP BY m
  )
  SELECT jsonb_build_object(
    'pl', coalesce((SELECT jsonb_object_agg(k, j) FROM pl), '{}'::jsonb),
    'bal', (SELECT jsonb_object_agg(k, j) FROM bal),
    'months', coalesce((SELECT jsonb_agg(e ORDER BY m) FROM mon), '[]'::jsonb))
    INTO v;

  -- customers / suppliers = the accounts' balances (Σ مدين / Σ دائن), not the gross 1200 / 2100
  dc1 := public.fin_accounts_dc(p_branch, p_cmp_to, p_to);
  dc2 := public.fin_accounts_dc(p_branch, p_cmp_from - 1, p_from - 1);
  v := jsonb_set(v, '{bal,cur_end}', (v->'bal'->'cur_end') || (dc1->'b'));
  v := jsonb_set(v, '{bal,cmp_end}', (v->'bal'->'cmp_end') || (dc1->'a'));
  v := jsonb_set(v, '{bal,cur_start}', (v->'bal'->'cur_start') || (dc2->'b'));
  v := jsonb_set(v, '{bal,cmp_start}', (v->'bal'->'cmp_start') || (dc2->'a'));
  RETURN v || jsonb_build_object('cur', jsonb_build_object('from', p_from, 'to', p_to),
                                 'cmp', jsonb_build_object('from', p_cmp_from, 'to', p_cmp_to), 'branch_id', p_branch);
END
$function$;

REVOKE ALL ON FUNCTION public.balance_sheet(date, uuid), public.financial_analysis(date, date, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.balance_sheet(date, uuid), public.financial_analysis(date, date, date, date, uuid) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('balance_sheet', '0227', 'statements: balance sheet at a day (books; customers / suppliers as the accounts'' balances)'),
  ('financial_analysis', '0227', 'statements: two periods + balances + 12 months for the analysis tab')
ON CONFLICT DO NOTHING;
