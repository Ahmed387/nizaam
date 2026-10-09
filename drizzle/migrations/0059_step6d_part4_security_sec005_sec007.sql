-- Step 6D part 4: SEC-005 (fixed reports instead of free SQL) and SEC-007 (guards on definer functions).
CREATE OR REPLACE FUNCTION public.ai_report_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('report', 'sales_summary',        'needs', 'invoices',  'params', 'from, to, branch_id?', 'about', 'عدد وإجمالي فواتير البيع السارية والملغاة لكل فرع في فترة'),
    jsonb_build_object('report', 'sales_by_day',         'needs', 'invoices',  'params', 'from, to, branch_id?', 'about', 'المبيعات يوم بيوم'),
    jsonb_build_object('report', 'top_products',         'needs', 'invoice_items', 'params', 'from, to, branch_id?, limit?', 'about', 'أكتر الأصناف مبيعاً بالكمية والقيمة'),
    jsonb_build_object('report', 'returns_summary',      'needs', 'returns',   'params', 'from, to, branch_id?', 'about', 'مرتجعات البيع: العدد والقيمة والنقدي والرصيد'),
    jsonb_build_object('report', 'purchases_summary',    'needs', 'shipments', 'params', 'from, to, branch_id?', 'about', 'فواتير الشراء لكل فرع'),
    jsonb_build_object('report', 'expenses_by_type',     'needs', 'expenses',  'params', 'from, to, branch_id?', 'about', 'المصروفات حسب النوع'),
    jsonb_build_object('report', 'low_stock',            'needs', 'products',  'params', 'branch_id?', 'about', 'الأصناف اللي وصلت لحد الطلب'),
    jsonb_build_object('report', 'till_balances',        'needs', 'treasury',  'params', 'branch_id?', 'about', 'رصيد خزنة كل فرع حسب طريقة الدفع'),
    jsonb_build_object('report', 'customer_balances',    'needs', 'contacts',  'params', 'branch_id?, limit?', 'about', 'أعلى العملاء مديونية (حساب العميل لوحده)'),
    jsonb_build_object('report', 'supplier_balances',    'needs', 'contacts',  'params', 'branch_id?, limit?', 'about', 'أعلى الموردين مستحقات (حساب المورد لوحده)'),
    jsonb_build_object('report', 'aging',                'needs', 'contacts',  'params', 'side (customer|supplier), branch_id?, as_of?', 'about', 'أعمار الديون'),
    jsonb_build_object('report', 'overdue_installments', 'needs', 'payment_installments', 'params', 'branch_id?', 'about', 'الأقساط المتأخرة'),
    jsonb_build_object('report', 'invoice_lookup',       'needs', 'invoices',  'params', 'number', 'about', 'فاتورة بيع بالرقم: الإجمالي والمدفوع والمتبقي من الدفتر الموحد')
  )
$$;

CREATE OR REPLACE FUNCTION public.ai_report(p_report text, p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid(); v_lvl text; v_tenant uuid; v_need text; v_res jsonb;
  v_from date; v_to date; v_branch uuid; v_limit int; v_side text; v_as_of date; v_num text;
  v_admin boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ai_report: unauthorized'; END IF;
  v_lvl := public.ask_me_access_level(v_uid);
  IF v_lvl = 'none' THEN RAISE EXCEPTION 'ai_report: not allowed'; END IF;
  v_tenant := public.current_tenant_id();
  v_admin := public.is_admin(v_uid) OR public.is_super_admin(v_uid);

  SELECT e->>'needs' INTO v_need FROM jsonb_array_elements(public.ai_report_catalog()) e WHERE e->>'report' = p_report;
  IF v_need IS NULL THEN RAISE EXCEPTION 'ai_report: unknown report %', p_report; END IF;
  IF v_lvl = 'scoped' AND NOT (v_need = ANY (public.ask_me_allowed_tables(v_uid))) THEN
    RAISE EXCEPTION 'ai_report: المعلومة دي خارج صلاحياتك';
  END IF;

  BEGIN
    v_from := COALESCE(NULLIF(p_params->>'from', '')::date, date_trunc('month', public.cairo_today())::date);
    v_to := COALESCE(NULLIF(p_params->>'to', '')::date, public.cairo_today());
    v_branch := NULLIF(p_params->>'branch_id', '')::uuid;
    v_limit := LEAST(GREATEST(COALESCE(NULLIF(p_params->>'limit', '')::int, 20), 1), 200);
    v_side := COALESCE(NULLIF(p_params->>'side', ''), 'customer');
    v_as_of := NULLIF(p_params->>'as_of', '')::date;
    v_num := left(NULLIF(btrim(p_params->>'number'), ''), 60);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'ai_report: parameters not valid (%)', SQLERRM;
  END;
  IF v_to - v_from > 1100 THEN RAISE EXCEPTION 'ai_report: الفترة طويلة جداً (أقصى 3 سنين)'; END IF;
  IF v_side NOT IN ('customer', 'supplier') THEN RAISE EXCEPTION 'ai_report: side must be customer or supplier'; END IF;
  IF v_branch IS NOT NULL AND NOT (EXISTS (SELECT 1 FROM branches b WHERE b.id = v_branch AND b.tenant_id = v_tenant)
                                   AND (v_admin OR public.user_in_branch(v_uid, v_branch))) THEN
    RAISE EXCEPTION 'ai_report: غير مصرح على هذا الفرع';
  END IF;

  INSERT INTO public.ai_ask_log (tenant_id, user_id, kind, sql_text)
  VALUES (v_tenant, v_uid, 'report', p_report || ' ' || COALESCE(p_params::text, '{}'));

  PERFORM set_config('transaction_read_only', 'on', true);
  SET LOCAL statement_timeout = '15s';

  CASE p_report
  WHEN 'sales_summary' THEN
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sales_total DESC), '[]') INTO v_res FROM (
      SELECT b.name AS branch, count(*) FILTER (WHERE i.status = 'active') AS invoices,
             round(COALESCE(sum(i.total) FILTER (WHERE i.status = 'active'), 0), 2) AS sales_total,
             count(*) FILTER (WHERE i.status = 'cancelled') AS cancelled
        FROM invoices i JOIN branches b ON b.id = i.branch_id
       WHERE i.tenant_id = v_tenant AND public.ledger_day(i.invoice_date) BETWEEN v_from AND v_to
         AND (v_branch IS NULL OR i.branch_id = v_branch) AND (v_admin OR public.user_in_branch(v_uid, i.branch_id))
       GROUP BY b.name) t;
  WHEN 'sales_by_day' THEN
    SELECT COALESCE(jsonb_agg(t ORDER BY t.day), '[]') INTO v_res FROM (
      SELECT public.ledger_day(i.invoice_date) AS day, count(*) AS invoices, round(sum(i.total), 2) AS sales_total
        FROM invoices i
       WHERE i.tenant_id = v_tenant AND i.status = 'active' AND public.ledger_day(i.invoice_date) BETWEEN v_from AND v_to
         AND (v_branch IS NULL OR i.branch_id = v_branch) AND (v_admin OR public.user_in_branch(v_uid, i.branch_id))
       GROUP BY 1) t;
  WHEN 'top_products' THEN
    SELECT COALESCE(jsonb_agg(t), '[]') INTO v_res FROM (
      SELECT ii.product_name AS product, sum(COALESCE(ii.net_quantity, ii.quantity)) AS quantity, round(sum(ii.total), 2) AS sales_total
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.tenant_id = v_tenant AND i.status = 'active' AND public.ledger_day(i.invoice_date) BETWEEN v_from AND v_to
         AND (v_branch IS NULL OR i.branch_id = v_branch) AND (v_admin OR public.user_in_branch(v_uid, i.branch_id))
       GROUP BY ii.product_name ORDER BY sum(ii.total) DESC LIMIT v_limit) t;
  WHEN 'returns_summary' THEN
    SELECT COALESCE(jsonb_agg(t), '[]') INTO v_res FROM (
      SELECT b.name AS branch, count(*) AS returns, round(sum(r.total_refund), 2) AS total,
             round(sum(COALESCE(r.refund_cash_amount, 0) + COALESCE(r.refund_transfer_amount, 0)), 2) AS paid_back,
             round(sum(COALESCE(r.refund_balance_amount, 0)), 2) AS to_customer_account
        FROM returns r JOIN branches b ON b.id = r.branch_id
       WHERE r.tenant_id = v_tenant AND COALESCE(r.status, 'active') = 'active'
         AND public.ledger_day(COALESCE(r.invoice_date, r.created_at)) BETWEEN v_from AND v_to
         AND (v_branch IS NULL OR r.branch_id = v_branch) AND (v_admin OR public.user_in_branch(v_uid, r.branch_id))
       GROUP BY b.name) t;
  WHEN 'purchases_summary' THEN
    SELECT COALESCE(jsonb_agg(t), '[]') INTO v_res FROM (
      SELECT b.name AS branch, count(*) AS purchase_invoices, round(sum(s.total_cost), 2) AS total
        FROM shipments s JOIN branches b ON b.id = s.branch_id
       WHERE s.tenant_id = v_tenant AND s.status = 'active'
         AND public.ledger_day(COALESCE(s.invoice_date, s.created_at)) BETWEEN v_from AND v_to
         AND (v_branch IS NULL OR s.branch_id = v_branch) AND (v_admin OR public.user_in_branch(v_uid, s.branch_id))
       GROUP BY b.name) t;
  WHEN 'expenses_by_type' THEN
    SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]') INTO v_res FROM (
      SELECT e.type, count(*) AS entries, round(sum(e.amount), 2) AS total
        FROM expenses e
       WHERE e.tenant_id = v_tenant AND e.date BETWEEN v_from AND v_to
         AND (v_branch IS NULL OR e.branch_id = v_branch) AND (v_admin OR public.user_in_branch(v_uid, e.branch_id))
       GROUP BY e.type) t;
  WHEN 'low_stock' THEN
    SELECT COALESCE(jsonb_agg(t), '[]') INTO v_res FROM (
      SELECT p.name, p.sku, b.name AS branch, p.quantity, p.low_stock_alert
        FROM products p JOIN branches b ON b.id = p.branch_id
       WHERE p.tenant_id = v_tenant AND p.archived_at IS NULL AND COALESCE(p.low_stock_alert, 0) > 0 AND p.quantity <= p.low_stock_alert
         AND (v_branch IS NULL OR p.branch_id = v_branch) AND (v_admin OR public.user_in_branch(v_uid, p.branch_id))
       ORDER BY p.quantity, p.name LIMIT 500) t;
  WHEN 'till_balances' THEN
    SELECT COALESCE(jsonb_agg(t), '[]') INTO v_res FROM (
      SELECT b.name AS branch, COALESCE(NULLIF(tr.payment_method, ''), 'cash') AS method,
             round(sum(CASE WHEN tr.type::text = 'income' THEN tr.amount ELSE -tr.amount END), 2) AS balance
        FROM treasury tr JOIN branches b ON b.id = tr.branch_id
       WHERE tr.tenant_id = v_tenant AND (v_branch IS NULL OR tr.branch_id = v_branch)
         AND (v_admin OR public.user_in_branch(v_uid, tr.branch_id))
       GROUP BY 1, 2) t;
  WHEN 'customer_balances', 'supplier_balances' THEN
    SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'open')::numeric DESC), '[]') INTO v_res FROM (
      SELECT jsonb_build_object('name', r->>'name', 'phone', r->>'phone',
               'open', CASE WHEN p_report = 'customer_balances' THEN r->'customer_open' ELSE r->'supplier_open' END,
               'advance', CASE WHEN p_report = 'customer_balances' THEN r->'customer_advance' ELSE r->'supplier_advance' END,
               'overdue', CASE WHEN p_report = 'customer_balances' THEN r->'customer_overdue' ELSE r->'supplier_overdue' END) AS x
        FROM jsonb_array_elements((public.contacts_page(v_branch, CASE WHEN p_report = 'customer_balances' THEN 'customer' ELSE 'supplier' END,
                                    NULL, ARRAY[CASE WHEN p_report = 'customer_balances' THEN 'owe_us' ELSE 'we_owe' END], v_limit, 0))->'rows') r) q;
  WHEN 'aging' THEN
    SELECT COALESCE(jsonb_agg(a ORDER BY a.total_open DESC), '[]') INTO v_res
      FROM (SELECT * FROM public.ledger_aging(v_side, v_branch, v_as_of) LIMIT 500) a;
  WHEN 'overdue_installments' THEN
    SELECT COALESCE(jsonb_agg(t), '[]') INTO v_res FROM (
      SELECT pp.entity_name AS name, pp.entity_type AS side, b.name AS branch, pi.due_date,
             round(pi.amount - COALESCE(pi.paid_amount, 0), 2) AS due
        FROM payment_installments pi JOIN payment_plans pp ON pp.id = pi.payment_plan_id JOIN branches b ON b.id = pp.branch_id
       WHERE pp.tenant_id = v_tenant AND pp.status = 'active' AND pp.entity_type IN ('customer', 'supplier')
         AND pi.cancelled_at IS NULL AND COALESCE(pi.status, '') NOT IN ('paid', 'cancelled')
         AND pi.due_date < public.cairo_today() AND pi.amount > COALESCE(pi.paid_amount, 0)
         AND (v_branch IS NULL OR pp.branch_id = v_branch) AND (v_admin OR public.user_in_branch(v_uid, pp.branch_id))
       ORDER BY pi.due_date LIMIT 500) t;
  WHEN 'invoice_lookup' THEN
    IF v_num IS NULL THEN RAISE EXCEPTION 'ai_report: number required'; END IF;
    SELECT COALESCE(jsonb_agg(t), '[]') INTO v_res FROM (
      SELECT i.invoice_number, public.ledger_day(i.invoice_date) AS date, b.name AS branch, c.name AS customer, i.status,
             s.total, s.paid, s.remaining, s.state
        FROM invoices i JOIN branches b ON b.id = i.branch_id LEFT JOIN contacts c ON c.id = i.contact_id
        CROSS JOIN LATERAL public.ledger_document_status('invoice', ARRAY[i.id]) s
       WHERE i.tenant_id = v_tenant AND (i.invoice_number = v_num OR i.legacy_number = v_num)
         AND (v_admin OR public.user_in_branch(v_uid, i.branch_id))
       LIMIT 5) t;
  END CASE;
  RETURN COALESCE(v_res, '[]'::jsonb);
END
$fn$;

REVOKE ALL ON FUNCTION public.ai_sql(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ask_me_schema() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_report(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_report(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_report_catalog() TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_is_system_call()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NULL AND COALESCE(auth.role(), '') IN ('', 'service_role')
$$;

CREATE OR REPLACE FUNCTION public.guard_read_branch(p_branch uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF public.guard_is_system_call() THEN RETURN true; END IF;
  PERFORM public.assert_access(p_branch, NULL);
  RETURN true;
END $fn$;

CREATE OR REPLACE FUNCTION public.guard_read_product(p_product uuid, p_permission text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF public.guard_is_system_call() THEN RETURN true; END IF;
  PERFORM public.assert_access((SELECT branch_id FROM products WHERE id = p_product), p_permission);
  RETURN true;
END $fn$;

CREATE OR REPLACE FUNCTION public.guard_read_shift(p_shift uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF public.guard_is_system_call() THEN RETURN true; END IF;
  PERFORM public.assert_access((SELECT branch_id FROM cashier_shifts WHERE id = p_shift), NULL);
  RETURN true;
END $fn$;

CREATE OR REPLACE FUNCTION public.guard_company_object(p_tenant uuid, p_admin_only boolean DEFAULT true)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF public.guard_is_system_call() THEN RETURN true; END IF;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '42501'; END IF;
  IF public.is_super_admin(v_uid) THEN RETURN true; END IF;
  IF p_tenant IS NULL OR p_tenant IS DISTINCT FROM public.current_tenant_id() THEN
    RAISE EXCEPTION 'غير مصرح: يخص شركة أخرى' USING ERRCODE = '42501';
  END IF;
  IF p_admin_only AND NOT (public.is_admin(v_uid) OR public.is_owner(v_uid) OR public.has_role(v_uid, 'accountant'::app_role)) THEN
    RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
  END IF;
  RETURN true;
END $fn$;

CREATE OR REPLACE FUNCTION public.guard_admin()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF public.guard_is_system_call() THEN RETURN true; END IF;
  IF auth.uid() IS NULL OR NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid()) OR public.is_owner(auth.uid())) THEN
    RAISE EXCEPTION 'للإدارة فقط' USING ERRCODE = '42501';
  END IF;
  RETURN true;
END $fn$;

DO $guards$
DECLARE
  g record; p record; v_args text; v_call text; v_ret text; v_body text; v_new text;
BEGIN
  FOR g IN SELECT * FROM (VALUES
    ('current_shift_schedule',          'public.guard_read_branch(p_branch_id)', NULL),
    ('expected_opening_cash',           'public.guard_read_branch(p_branch_id)', NULL),
    ('historical_stock_at',             'public.guard_read_branch(_branch_id)', NULL),
    ('get_available_quantity',          'public.guard_read_product(p_product_id) AND public.guard_read_branch(p_branch_id)', NULL),
    ('get_product_references_count',    'public.guard_read_product(_product_id)', NULL),
    ('restore_product',                 'public.guard_read_product(_product_id, ''inventory.update'')', NULL),
    ('shift_cash_sales',                'public.guard_read_shift(p_shift_id)', NULL),
    ('shift_payment_breakdown',         'public.guard_read_shift(p_shift_id)', NULL),
    ('get_bank_reconciliation_summary', 'public.guard_company_object((SELECT tenant_id FROM public.bank_accounts WHERE id = p_bank_account_id))', NULL),
    ('get_budget_variance',             'public.guard_company_object((SELECT tenant_id FROM public.fiscal_periods WHERE id = _fiscal_period_id))', NULL),
    ('preview_flexible_distribution',   'public.guard_company_object(p_tenant_id)', NULL),
    ('detect_anomalies',                'public.guard_admin()', NULL),
    ('generate_alerts',                 'public.guard_admin()', NULL),
    ('detect_orphaned_batches',         'public.guard_admin()', 'product_id IN (SELECT pr.id FROM public.products pr WHERE pr.tenant_id = public.current_tenant_id())')
  ) AS t(fn, guard, row_filter)
  LOOP
    FOR p IN SELECT pr.oid, pr.proname, pr.proretset, pg_get_function_result(pr.oid) AS res,
                    pg_get_function_arguments(pr.oid) AS args, pg_get_function_identity_arguments(pr.oid) AS idargs,
                    pr.proargnames, pr.pronargs, pr.provolatile
               FROM pg_proc pr WHERE pr.pronamespace = 'public'::regnamespace AND pr.proname = g.fn AND pr.prokind = 'f'
                 AND pr.prorettype <> 'trigger'::regtype
    LOOP
      IF EXISTS (SELECT 1 FROM pg_proc x WHERE x.pronamespace = 'public'::regnamespace AND x.proname = g.fn || '__unguarded'
                   AND pg_get_function_identity_arguments(x.oid) = p.idargs) THEN
        CONTINUE;
      END IF;
      EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I', g.fn, p.idargs, g.fn || '__unguarded');
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', g.fn || '__unguarded', p.idargs);
      SELECT string_agg(quote_ident(a), ', ') INTO v_call FROM unnest(p.proargnames[1:p.pronargs]) a;
      v_call := format('public.%I(%s)', g.fn || '__unguarded', COALESCE(v_call, ''));
      IF p.proretset THEN
        v_body := format('RETURN QUERY SELECT * FROM %s x%s;', v_call, COALESCE(' WHERE x.' || g.row_filter, ''));
      ELSIF p.res = 'void' THEN
        v_body := format('PERFORM %s;', v_call);
      ELSE
        v_body := format('RETURN %s;', v_call);
      END IF;
      v_new := format($f$CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql %s SECURITY DEFINER SET search_path TO 'public' AS $w$
BEGIN
  -- Step 6D (SEC-007): company / branch guard in front of the original body
  PERFORM %s;
  %s
END $w$$f$,
        g.fn, p.args, p.res, CASE p.provolatile WHEN 's' THEN 'STABLE' WHEN 'i' THEN 'STABLE' ELSE 'VOLATILE' END, g.guard, v_body);
      EXECUTE v_new;
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', g.fn, p.idargs);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', g.fn, p.idargs);
    END LOOP;
  END LOOP;
END
$guards$;

DO $internal$
DECLARE f record; v_def text; v_new text; w text;
BEGIN
  FOR f IN SELECT p.oid, p.proname FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('close_cashier_shift', 'open_cashier_shift_secure', 'run_shift_maintenance', 'safe_delete_product')
  LOOP
    v_def := pg_get_functiondef(f.oid);
    v_new := v_def;
    FOREACH w IN ARRAY ARRAY['shift_cash_sales', 'shift_payment_breakdown', 'expected_opening_cash', 'current_shift_schedule',
                             'historical_stock_at', 'get_available_quantity', 'get_product_references_count'] LOOP
      v_new := regexp_replace(v_new, '(public\.)?\m' || w || '\M\s*\(', 'public.' || w || '__unguarded(', 'g');
    END LOOP;
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END LOOP;
END
$internal$;

CREATE OR REPLACE FUNCTION public.release_reservation(p_id uuid, p_status text DEFAULT 'cancelled'::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('cancelled', 'completed', 'expired') THEN RAISE EXCEPTION 'حالة غير صحيحة'; END IF;
  UPDATE inventory_reservations SET status = p_status, released_at = now()
   WHERE id = p_id AND status = 'active' AND tenant_id = public.current_tenant_id()
     AND (public.is_admin(auth.uid()) OR public.user_in_branch(auth.uid(), branch_id));
END $fn$;

CREATE OR REPLACE FUNCTION public.release_reservations_for_draft(p_draft_id text, p_status text DEFAULT 'cancelled'::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('cancelled', 'completed', 'expired') THEN RAISE EXCEPTION 'حالة غير صحيحة'; END IF;
  UPDATE inventory_reservations SET status = p_status, released_at = now()
   WHERE invoice_draft_id = p_draft_id AND status = 'active' AND tenant_id = public.current_tenant_id()
     AND (public.is_admin(auth.uid()) OR public.user_in_branch(auth.uid(), branch_id));
END $fn$;