-- 0214 — two more financial statements (owner «نفذ» 2026-11-14), both read from the books only:
--   equity_changes(from, to)          «قائمة التغيرات في حقوق الملكية»: per equity line — opening, increases,
--                                     decreases, the period's net profit, closing — and a check against the
--                                     balance sheet (assets − liabilities on `to` = closing equity).
--   cogs_statement(from, to, branch)  «قائمة تكلفة البضاعة المباعة»: stock at the start + purchases − purchase
--                                     returns + prior-year returns + opening corrections + other = available;
--                                     − stock at the end = cost of goods sold (already net of what customers
--                                     returned, since those pieces are in the end stock) = sold at cost − cost
--                                     back; check = account 5100 in the income statement for the same period.
-- Who may read: owner / admin, or whoever has «المحاسبة ← القوائم المالية» (admin_acc_statements.view).

CREATE OR REPLACE FUNCTION public.equity_changes(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; v jsonb;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid()) OR public.has_permission(auth.uid(), 'admin_acc_statements.view')) THEN
    RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
  END IF;
  WITH l AS (
    SELECT a.code, a.account_type, e.entry_date AS d, e.source_type, l.credit - l.debit AS cr
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.tenant_id = v_t AND e.status = 'posted' AND e.entry_date <= p_to
  ),
  grp AS (
    SELECT CASE WHEN code IN ('3100', '3200') THEN 'capital'
                WHEN code = '3950' THEN 'opening'
                WHEN code IN ('3800', '3300', '3900') THEN 'retained'
                WHEN account_type IN ('revenue', 'expense') THEN 'pl'
                WHEN account_type = 'equity' THEN 'other' END AS g, d, source_type, cr
      FROM l
  ),
  s AS (
    SELECT g,
           round(COALESCE(sum(cr) FILTER (WHERE d < p_from), 0), 2) AS opening,
           round(COALESCE(sum(cr) FILTER (WHERE d >= p_from AND cr > 0), 0), 2) AS inc,
           round(COALESCE(-sum(cr) FILTER (WHERE d >= p_from AND cr < 0), 0), 2) AS dec,
           round(COALESCE(sum(cr) FILTER (WHERE d >= p_from), 0), 2) AS mv
      FROM grp WHERE g IS NOT NULL GROUP BY g
  ),
  pl AS (SELECT COALESCE(opening, 0) AS before, COALESCE(mv, 0) AS period FROM s WHERE g = 'pl'),
  rows AS (
    SELECT 'capital' AS k, 'رأس مال الشركاء (مساهمات − مسحوبات من رأس المال)' AS label, 1 AS o,
           COALESCE(s.opening, 0) AS opening, COALESCE(s.inc, 0) AS inc, COALESCE(s.dec, 0) AS dec, 0::numeric AS profit
      FROM (SELECT 1) x LEFT JOIN s ON s.g = 'capital'
    UNION ALL
    SELECT 'opening', 'رصيد بداية التشغيل (الأرصدة الافتتاحية)', 2, COALESCE(s.opening, 0), COALESCE(s.inc, 0), COALESCE(s.dec, 0), 0
      FROM (SELECT 1) x LEFT JOIN s ON s.g = 'opening'
    UNION ALL
    SELECT 'retained', 'الأرباح المحتجزة (أرباح الفترات + تسويات السنين اللي فاتت − التوزيعات)', 3,
           COALESCE(s.opening, 0) + COALESCE((SELECT before FROM pl), 0), COALESCE(s.inc, 0), COALESCE(s.dec, 0), COALESCE((SELECT period FROM pl), 0)
      FROM (SELECT 1) x LEFT JOIN s ON s.g = 'retained'
    UNION ALL
    SELECT 'other', 'حسابات حقوق ملكية أخرى', 4, s.opening, s.inc, s.dec, 0 FROM s WHERE s.g = 'other' AND (s.opening <> 0 OR s.mv <> 0)
  ),
  bs AS (
    SELECT round(COALESCE(sum(-cr) FILTER (WHERE account_type = 'asset'), 0), 2) AS assets,
           round(COALESCE(sum(cr) FILTER (WHERE account_type = 'liability'), 0), 2) AS liabilities
      FROM l
  ),
  det AS (
    SELECT g, CASE source_type
                WHEN 'treasury_row' THEN 'حركات شركاء / مرتجعات سنين سابقة'
                WHEN 'profit_distribution' THEN 'توزيع أرباح'
                WHEN 'opening_balance' THEN 'أرصدة افتتاحية'
                WHEN 'opening_stock_correction' THEN 'تصحيح مخزون افتتاحي'
                WHEN 'opening_ca_reclass' THEN 'أرصدة افتتاحية على الحسابات'
                WHEN 'year_end_closing' THEN 'إقفال سنة'
                ELSE COALESCE(source_type, 'قيود يدوية') END AS src,
           round(sum(cr), 2) AS amount
      FROM grp WHERE g IN ('capital', 'opening', 'retained', 'other') AND d >= p_from
     GROUP BY 1, 2 HAVING abs(sum(cr)) > 0.005
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'rows', (SELECT jsonb_agg(jsonb_build_object('key', k, 'label', label, 'opening', opening, 'increase', inc, 'decrease', dec,
                                  'profit', profit, 'closing', round(opening + inc - dec + profit, 2),
                                  'details', COALESCE((SELECT jsonb_agg(jsonb_build_object('source', src, 'amount', amount) ORDER BY abs(amount) DESC)
                                                         FROM det WHERE det.g = rows.k), '[]'::jsonb)) ORDER BY o) FROM rows),
    'total', (SELECT jsonb_build_object('opening', round(sum(opening), 2), 'increase', round(sum(inc), 2), 'decrease', round(sum(dec), 2),
                                        'profit', round(sum(profit), 2), 'closing', round(sum(opening + inc - dec + profit), 2)) FROM rows),
    'balance_sheet', (SELECT jsonb_build_object('assets', assets, 'liabilities', liabilities, 'equity', round(assets - liabilities, 2)) FROM bs)
  ) INTO v;
  RETURN v;
END
$function$;
REVOKE ALL ON FUNCTION public.equity_changes(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equity_changes(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.cogs_statement(p_from date, p_to date, p_branch uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; v jsonb;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid()) OR public.has_permission(auth.uid(), 'admin_acc_statements.view')) THEN
    RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
  END IF;
  WITH l AS (
    SELECT a.code, e.entry_date AS d, e.source_type, l.debit - l.credit AS dr
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.tenant_id = v_t AND e.status = 'posted' AND e.entry_date <= p_to AND a.code IN ('1300', '5100')
       AND (p_branch IS NULL OR e.branch_id = p_branch)
  ),
  inv AS (
    SELECT round(COALESCE(sum(dr) FILTER (WHERE code = '1300' AND d < p_from), 0), 2) AS opening,
           round(COALESCE(sum(dr) FILTER (WHERE code = '1300'), 0), 2) AS closing,
           round(COALESCE(sum(dr) FILTER (WHERE code = '1300' AND d >= p_from AND source_type LIKE 'shipment%'), 0), 2) AS purchases,
           round(COALESCE(-sum(dr) FILTER (WHERE code = '1300' AND d >= p_from AND source_type LIKE 'purchase_return%'), 0), 2) AS purchase_returns,
           round(COALESCE(sum(dr) FILTER (WHERE code = '1300' AND d >= p_from AND source_type LIKE 'sale_return%'), 0), 2) AS customer_returns,
           round(COALESCE(sum(dr) FILTER (WHERE code = '1300' AND d >= p_from AND source_type = 'treasury_row'), 0), 2) AS prior_year_returns,
           round(COALESCE(sum(dr) FILTER (WHERE code = '1300' AND d >= p_from AND source_type IN ('opening_balance', 'opening_balance_reversal', 'opening_stock_correction')), 0), 2) AS opening_corrections,
           round(COALESCE(sum(dr) FILTER (WHERE code = '1300' AND d >= p_from
                   AND source_type NOT LIKE 'shipment%' AND source_type NOT LIKE 'purchase_return%' AND source_type NOT LIKE 'sale_return%'
                   AND source_type NOT IN ('treasury_row', 'opening_balance', 'opening_balance_reversal', 'opening_stock_correction', 'invoice_cogs')), 0), 2) AS other,
           round(COALESCE(-sum(dr) FILTER (WHERE code = '1300' AND d >= p_from AND source_type = 'invoice_cogs'), 0), 2) AS sold_at_cost,
           round(COALESCE(sum(dr) FILTER (WHERE code = '5100' AND d >= p_from), 0), 2) AS cogs_books
      FROM l
  )
  SELECT jsonb_build_object('from', p_from, 'to', p_to, 'branch_id', p_branch,
           'opening', opening, 'purchases', purchases, 'purchase_returns', purchase_returns,
           'customer_returns', customer_returns, 'prior_year_returns', prior_year_returns,
           'opening_corrections', opening_corrections, 'other', other,
           'available', round(opening + purchases - purchase_returns + prior_year_returns + opening_corrections + other, 2),
           'closing', closing,
           'cogs', round(opening + purchases - purchase_returns + prior_year_returns + opening_corrections + other - closing, 2),
           'sold_at_cost', sold_at_cost, 'cogs_books', cogs_books)
    INTO v FROM inv;
  RETURN v;
END
$function$;
REVOKE ALL ON FUNCTION public.cogs_statement(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cogs_statement(date, date, uuid) TO authenticated;

INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('equity_changes', '0214', 'statement of changes in equity, admin or admin_acc_statements.view'),
  ('cogs_statement', '0214', 'cost of goods sold statement, admin or admin_acc_statements.view')
ON CONFLICT DO NOTHING;
