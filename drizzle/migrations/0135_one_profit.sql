-- 0135: one net profit for the card, the income statement and the distribution (owner «نفذ», 2026-10-30)
--
-- Before: the card «الشركة كسبانة / خسرانة» (owner_business_snapshot) added up the documents (sales − returns − cost −
-- expense vouchers) while the income statement and the distribution (compute_net_profit_for_period) read the books
-- (journal entries). The two never matched: October 2026 card 22,085 vs books 277,903, because the books also had the
-- inventory count surplus (259,036) and «إيرادات أخرى», and the card did not.
-- Now: everything reads profit_statement_core (the books), split into the same lines everywhere:
--   المبيعات − المرتجعات = صافي المبيعات − تكلفة البضاعة = مجمل الربح − المصروفات = ربح التشغيل
--   + إيرادات أخرى (receipt vouchers to income, the customer-paid transfer fee, …) + فروقات الجرد (surplus − shortage)
--   = صافي الربح
-- profit_reconciliation(from, to) compares the books with the documents per branch (sales, returns, cost, expenses)
-- and counts journal entries whose document is gone — it must be all zero after every imported month.

CREATE OR REPLACE FUNCTION public.profit_statement_core(p_tenant uuid, p_from date, p_to date, p_branch uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH l AS (
    SELECT e.branch_id, a.code, coalesce(a.name_ar, a.name) AS aname, a.account_type,
           CASE WHEN a.code = '4900' OR (a.code = '4100' AND e.source_type LIKE 'sale_return%') THEN 'returns'
                WHEN a.code = '4100' THEN 'sales'
                WHEN a.code = '5100' THEN 'cogs'
                WHEN a.code IN ('4300', '5600') THEN 'count_diff'
                WHEN a.account_type = 'revenue' THEN 'other_income'
                ELSE 'expenses' END AS grp,
           l.credit - l.debit AS cr
      FROM public.journal_entries e
      JOIN public.journal_entry_lines l ON l.entry_id = e.id
      JOIN public.chart_of_accounts a ON a.id = l.account_id
     WHERE e.tenant_id = p_tenant AND e.status = 'posted' AND e.entry_date BETWEEN p_from AND p_to
       AND a.account_type IN ('revenue', 'expense')
       AND (p_branch IS NULL OR e.branch_id = p_branch)
  ),
  g AS (
    SELECT branch_id, GROUPING(branch_id) AS gtot,
           sum(cr) FILTER (WHERE grp = 'sales') AS sales,
           -sum(cr) FILTER (WHERE grp = 'returns') AS returns,
           -sum(cr) FILTER (WHERE grp = 'cogs') AS cogs,
           -sum(cr) FILTER (WHERE grp = 'expenses') AS expenses,
           sum(cr) FILTER (WHERE grp = 'other_income') AS other_income,
           sum(cr) FILTER (WHERE grp = 'count_diff') AS count_diff,
           sum(cr) FILTER (WHERE account_type = 'revenue') AS revenue_total,
           -sum(cr) FILTER (WHERE account_type = 'expense') AS expense_total
      FROM l GROUP BY ROLLUP (branch_id)
  ),
  r AS (
    SELECT g.*, (g.gtot = 1) AS is_total,
           round(coalesce(sales, 0), 2) AS s, round(coalesce(returns, 0), 2) AS rt, round(coalesce(cogs, 0), 2) AS c,
           round(coalesce(expenses, 0), 2) AS x, round(coalesce(other_income, 0), 2) AS oi, round(coalesce(count_diff, 0), 2) AS cd
      FROM g
  ),
  j AS (
    SELECT r.branch_id, r.is_total,
           jsonb_build_object('sales', r.s, 'returns', r.rt, 'net_sales', r.s - r.rt, 'cogs', r.c,
             'gross_profit', r.s - r.rt - r.c, 'expenses', r.x, 'operating_profit', r.s - r.rt - r.c - r.x,
             'other_income', r.oi, 'count_diff', r.cd, 'net_profit', r.s - r.rt - r.c - r.x + r.oi + r.cd,
             'revenue_total', round(coalesce(r.revenue_total, 0), 2), 'expense_total', round(coalesce(r.expense_total, 0), 2)) AS v
      FROM r
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to, 'branch_id', p_branch, 'source', 'books',
    'total', coalesce((SELECT v FROM j WHERE is_total),
      jsonb_build_object('sales', 0, 'returns', 0, 'net_sales', 0, 'cogs', 0, 'gross_profit', 0, 'expenses', 0,
        'operating_profit', 0, 'other_income', 0, 'count_diff', 0, 'net_profit', 0, 'revenue_total', 0, 'expense_total', 0)),
    'branches', coalesce((SELECT jsonb_agg(j.v || jsonb_build_object('branch_id', j.branch_id, 'branch', coalesce(b.name, 'بدون فرع'))
                                  ORDER BY b.name)
                            FROM j LEFT JOIN public.branches b ON b.id = j.branch_id WHERE NOT j.is_total), '[]'::jsonb),
    'accounts', coalesce((SELECT jsonb_agg(jsonb_build_object('code', code, 'name', aname, 'group', grp,
                                  'amount', round(CASE WHEN account_type = 'revenue' THEN amt ELSE -amt END, 2)) ORDER BY code)
                            FROM (SELECT code, aname, grp, account_type, sum(cr) AS amt FROM l GROUP BY 1, 2, 3, 4) a
                           WHERE round(amt, 2) <> 0), '[]'::jsonb));
$function$;
REVOKE ALL ON FUNCTION public.profit_statement_core(uuid, date, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profit_statement_core(uuid, date, date, uuid) TO service_role;

-- the browser: the income statement page (company or one branch)
CREATE OR REPLACE FUNCTION public.profit_statement(p_from date, p_to date, p_branch uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_read_company_report(ARRAY['admin_finance.view', 'net_profit.view',
       'part.admin_home.business_snapshot.view', 'admin_reports_profitability.view']) THEN
    RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
  END IF;
  IF p_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch AND tenant_id = public.current_tenant_id()) THEN
    RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
  END IF;
  RETURN public.profit_statement_core(public.current_tenant_id(), p_from, p_to, p_branch);
END $function$;
REVOKE ALL ON FUNCTION public.profit_statement(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profit_statement(date, date, uuid) TO authenticated;

-- the distribution reads the same number (revenue − expense of the books = the statement's net profit)
CREATE OR REPLACE FUNCTION public.compute_net_profit_for_period(p_tenant_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND auth.uid() IS NOT NULL
     AND p_tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
  END IF;
  v := public.profit_statement_core(p_tenant_id, p_from, p_to, NULL);
  RETURN jsonb_build_object('revenue', (v->'total'->>'revenue_total')::numeric, 'expense', (v->'total'->>'expense_total')::numeric,
    'net_profit', (v->'total'->>'net_profit')::numeric, 'from', p_from, 'to', p_to, 'statement', v->'total');
END $function$;

-- the card: profit lines from the books per branch; money and stock stay from the documents
CREATE OR REPLACE FUNCTION public.owner_business_snapshot(p_from date, p_to date, p_tenant uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_t uuid := CASE WHEN COALESCE(auth.role(), '') = 'service_role' AND p_tenant IS NOT NULL THEN p_tenant ELSE public.current_tenant_id() END;
  v_rows jsonb; v_ps jsonb;
BEGIN
  -- 0133: the scheduled weekly report runs as the service role with p_tenant
  IF NOT v_service AND (auth.uid() IS NULL OR NOT public.can_read_company_report(ARRAY['part.admin_home.business_snapshot.view', 'admin_reports_profitability.view'])) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  -- 0135: the profit lines are the books (profit_statement_core), like the income statement and the distribution
  v_ps := public.profit_statement_core(v_t, p_from, p_to, NULL);
  WITH b AS (SELECT id, name FROM public.branches WHERE tenant_id = v_t AND coalesce(is_system, false) = false),
  ps AS (SELECT (x->>'branch_id')::uuid AS branch_id, x AS v FROM jsonb_array_elements(v_ps->'branches') x),
  inv AS (SELECT i.branch_id, count(*) AS n, sum(coalesce(public.ledger_doc_open('invoice', i.id), 0)) AS open_credit
      FROM public.invoices i WHERE i.tenant_id = v_t AND i.status = 'active' AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to GROUP BY 1),
  money AS (SELECT m.branch_id, sum(CASE WHEN m.direction = 'in' THEN m.amount ELSE -m.amount END) AS collected FROM public.money_movements m
     WHERE m.tenant_id = v_t AND m.side = 'customer' AND m.is_cash AND m.status = 'active' AND m.movement_date BETWEEN p_from AND p_to GROUP BY 1),
  stock AS (SELECT p.branch_id, sum(greatest(p.quantity, 0) * coalesce(p.avg_cost, p.cost_price, 0)) AS value, sum(greatest(p.quantity, 0)) AS qty, count(*) FILTER (WHERE p.quantity > 0) AS items
      FROM public.products p WHERE p.tenant_id = v_t AND p.archived_at IS NULL GROUP BY 1),
  short AS (SELECT p.branch_id, sum(-p.quantity * coalesce(p.avg_cost, p.cost_price, 0)) AS owed FROM public.products p WHERE p.tenant_id = v_t AND p.archived_at IS NULL AND p.quantity < 0 GROUP BY 1)
  SELECT jsonb_agg(jsonb_build_object('branch_id', b.id, 'branch', b.name, 'invoices', coalesce(inv.n, 0),
           'sales', coalesce((ps.v->>'sales')::numeric, 0), 'returns', coalesce((ps.v->>'returns')::numeric, 0),
           'net_sales', coalesce((ps.v->>'net_sales')::numeric, 0), 'collected', round(coalesce(money.collected, 0), 2),
           'open_credit', round(coalesce(inv.open_credit, 0), 2), 'cogs', coalesce((ps.v->>'cogs')::numeric, 0),
           'gross_profit', coalesce((ps.v->>'gross_profit')::numeric, 0), 'expenses', coalesce((ps.v->>'expenses')::numeric, 0),
           'operating_profit', coalesce((ps.v->>'operating_profit')::numeric, 0),
           'other_income', coalesce((ps.v->>'other_income')::numeric, 0), 'count_diff', coalesce((ps.v->>'count_diff')::numeric, 0),
           'net_profit', coalesce((ps.v->>'net_profit')::numeric, 0),
           'stock_value', round(coalesce(stock.value, 0) - coalesce(short.owed, 0), 2), 'stock_qty', coalesce(stock.qty, 0), 'stock_items', coalesce(stock.items, 0),
           'sold_ahead_of_stock', round(coalesce(short.owed, 0), 2)) ORDER BY b.name)
    INTO v_rows
    FROM b LEFT JOIN ps ON ps.branch_id = b.id LEFT JOIN inv ON inv.branch_id = b.id LEFT JOIN money ON money.branch_id = b.id
           LEFT JOIN stock ON stock.branch_id = b.id LEFT JOIN short ON short.branch_id = b.id;
  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'source', 'books', 'branches', coalesce(v_rows, '[]'::jsonb),
    -- the profit lines of the total are the statement's own total (same number as the income statement / distribution)
    'total', (v_ps->'total') - 'revenue_total' - 'expense_total' || (SELECT jsonb_build_object(
       'collected', coalesce(sum((x->>'collected')::numeric), 0), 'open_credit', coalesce(sum((x->>'open_credit')::numeric), 0),
       'stock_value', coalesce(sum((x->>'stock_value')::numeric), 0), 'stock_qty', coalesce(sum((x->>'stock_qty')::numeric), 0),
       'invoices', coalesce(sum((x->>'invoices')::numeric), 0)) FROM jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) x));
END $function$;
REVOKE ALL ON FUNCTION public.owner_business_snapshot(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_business_snapshot(date, date, uuid) TO authenticated, service_role;

-- the guard: books vs documents per branch. Every difference must be 0 after an imported month.
CREATE OR REPLACE FUNCTION public.profit_reconciliation(p_from date, p_to date, p_tenant uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid; v_ps jsonb; v_rows jsonb; v_orphans jsonb;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' OR auth.uid() IS NULL THEN
    v_t := coalesce(p_tenant, public.current_tenant_id());
  ELSE
    IF NOT (public.is_admin(auth.uid()) OR public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
      RAISE EXCEPTION 'مطابقة الربح للإدارة فقط' USING ERRCODE = '42501';
    END IF;
    v_t := public.current_tenant_id();
  END IF;
  v_ps := public.profit_statement_core(v_t, p_from, p_to, NULL);
  WITH b AS (SELECT id, name FROM public.branches WHERE tenant_id = v_t),
  ps AS (SELECT (x->>'branch_id')::uuid AS branch_id, x AS v FROM jsonb_array_elements(v_ps->'branches') x),
  inv AS (SELECT i.branch_id, sum(i.total - coalesce(i.vat_amount, 0)) AS sales
      FROM public.invoices i WHERE i.tenant_id = v_t AND i.status = 'active'
       AND NOT public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id)
       AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to GROUP BY 1),
  cogs AS (SELECT i.branch_id, sum(coalesce(nullif(ii.unit_cost_at_sale, 0), ii.cost_price, 0) * ii.quantity) AS cogs
      FROM public.invoices i JOIN public.invoice_items ii ON ii.invoice_id = i.id
     WHERE i.tenant_id = v_t AND i.status = 'active'
       AND NOT public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id)
       AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to GROUP BY 1),
  ret AS (SELECT r.branch_id, sum(r.total_refund) AS returns, sum(public.sale_return_cost(r.id)) AS cost_back
      FROM public.returns r JOIN public.invoices i ON i.id = r.invoice_id
     WHERE r.tenant_id = v_t AND coalesce(r.status, 'active') = 'active'
       AND NOT public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id)
       AND (coalesce(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to GROUP BY 1),
  exp AS (SELECT v.branch_id, sum(v.amount) AS expenses FROM public.vouchers v JOIN public.voucher_categories c ON c.id = v.category_id
     WHERE v.tenant_id = v_t AND v.type = 'payment' AND v.status = 'active' AND c.is_deductible_from_profit AND v.voucher_date BETWEEN p_from AND p_to GROUP BY 1),
  cmp AS (
    SELECT b.id, b.name,
           round(coalesce((ps.v->>'sales')::numeric, 0) - coalesce(inv.sales, 0), 2) AS sales_diff,
           round(coalesce((ps.v->>'returns')::numeric, 0) - coalesce(ret.returns, 0), 2) AS returns_diff,
           round(coalesce((ps.v->>'cogs')::numeric, 0) - (coalesce(cogs.cogs, 0) - coalesce(ret.cost_back, 0)), 2) AS cogs_diff,
           round(coalesce((ps.v->>'expenses')::numeric, 0) - coalesce(exp.expenses, 0), 2) AS expenses_diff
      FROM b LEFT JOIN ps ON ps.branch_id = b.id LEFT JOIN inv ON inv.branch_id = b.id LEFT JOIN cogs ON cogs.branch_id = b.id
             LEFT JOIN ret ON ret.branch_id = b.id LEFT JOIN exp ON exp.branch_id = b.id
  )
  SELECT jsonb_agg(jsonb_build_object('branch_id', id, 'branch', name, 'sales_diff', sales_diff, 'returns_diff', returns_diff,
                                      'cogs_diff', cogs_diff, 'expenses_diff', expenses_diff) ORDER BY name)
    INTO v_rows FROM cmp WHERE sales_diff <> 0 OR returns_diff <> 0 OR cogs_diff <> 0 OR expenses_diff <> 0;

  -- journal entries of sales / cost whose invoice no longer exists (left behind by deleted documents)
  SELECT jsonb_build_object('entries', count(*), 'amount', round(coalesce(sum(x.v), 0), 2)) INTO v_orphans
    FROM (SELECT e.id, sum(l.credit - l.debit) AS v
            FROM public.journal_entries e JOIN public.journal_entry_lines l ON l.entry_id = e.id
            JOIN public.chart_of_accounts a ON a.id = l.account_id
           WHERE e.tenant_id = v_t AND e.status = 'posted' AND e.entry_date BETWEEN p_from AND p_to
             AND e.source_type IN ('invoice', 'invoice_reversal', 'invoice_cogs') AND a.code = '4100'
             AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = e.source_id)
           GROUP BY e.id) x;

  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'ok', v_rows IS NULL AND (v_orphans->>'entries')::int = 0,
    'branches', coalesce(v_rows, '[]'::jsonb), 'orphan_sales_entries', v_orphans,
    'net_profit', v_ps->'total'->'net_profit');
END $function$;
REVOKE ALL ON FUNCTION public.profit_reconciliation(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profit_reconciliation(date, date, uuid) TO authenticated, service_role;

INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('profit_statement', '0135', 'owner: one profit statement (books) for the card, the income statement and the distribution'),
  ('profit_reconciliation', '0135', 'owner: books vs documents per branch, must be zero after every imported month')
ON CONFLICT DO NOTHING;
