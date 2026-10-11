-- 0072 — Owner reports per branch (owner request 2026-10-11):
--   money : net sales  |  money actually received from customers (cash + bank + wallet, minus money given back)
--           |  credit still open on the period's invoices
--   stock : what came in and at what cost, what went out and at what cost, what is left and what it is worth —
--           all at the branch moving average (0071).

-- ---------------------------------------------------------------- «هل بنكسب؟» + money split, stock at the average
CREATE OR REPLACE FUNCTION public.owner_business_snapshot(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t uuid := public.current_tenant_id(); v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  WITH b AS (SELECT id, name FROM public.branches WHERE tenant_id = v_t AND coalesce(is_system, false) = false),
  inv AS (
    SELECT i.branch_id, sum(i.total) AS sales, count(*) AS n, sum(coalesce(public.ledger_doc_open('invoice', i.id), 0)) AS open_credit
      FROM public.invoices i
     WHERE i.tenant_id = v_t AND i.status = 'active'
       AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to
     GROUP BY 1),
  cogs AS (
    SELECT i.branch_id,
           sum(coalesce(nullif(ii.unit_cost_at_sale, 0), ii.cost_price, 0)
               * coalesce(ii.net_quantity, ii.quantity - coalesce(ii.returned_quantity, 0))) AS cogs
      FROM public.invoices i JOIN public.invoice_items ii ON ii.invoice_id = i.id
     WHERE i.tenant_id = v_t AND i.status = 'active'
       AND (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to
     GROUP BY 1),
  ret AS (
    SELECT r.branch_id, sum(r.total_refund) AS returns
      FROM public.returns r
     WHERE r.tenant_id = v_t AND coalesce(r.status, 'active') = 'active'
       AND (coalesce(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to
     GROUP BY 1),
  exp AS (
    SELECT v.branch_id, sum(v.amount) AS expenses
      FROM public.vouchers v JOIN public.voucher_categories c ON c.id = v.category_id
     WHERE v.tenant_id = v_t AND v.type = 'payment' AND v.status = 'active' AND c.is_deductible_from_profit
       AND v.voucher_date BETWEEN p_from AND p_to
     GROUP BY 1),
  money AS (
    SELECT m.branch_id, sum(CASE WHEN m.direction = 'in' THEN m.amount ELSE -m.amount END) AS collected
      FROM public.money_movements m
     WHERE m.tenant_id = v_t AND m.side = 'customer' AND m.is_cash AND m.status = 'active'
       AND m.movement_date BETWEEN p_from AND p_to
     GROUP BY 1),
  stock AS (
    SELECT p.branch_id,
           sum(greatest(p.quantity, 0) * coalesce(p.avg_cost, p.cost_price, 0)) AS value,
           sum(greatest(p.quantity, 0)) AS qty,
           count(*) FILTER (WHERE p.quantity > 0) AS items
      FROM public.products p
     WHERE p.tenant_id = v_t AND p.archived_at IS NULL
     GROUP BY 1),
  short AS (
    SELECT p.branch_id, sum(-p.quantity * coalesce(p.avg_cost, p.cost_price, 0)) AS owed
      FROM public.products p WHERE p.tenant_id = v_t AND p.archived_at IS NULL AND p.quantity < 0 GROUP BY 1)
  SELECT jsonb_agg(jsonb_build_object(
           'branch_id', b.id, 'branch', b.name,
           'invoices', coalesce(inv.n, 0),
           'sales', round(coalesce(inv.sales, 0), 2),
           'returns', round(coalesce(ret.returns, 0), 2),
           'net_sales', round(coalesce(inv.sales, 0) - coalesce(ret.returns, 0), 2),
           'collected', round(coalesce(money.collected, 0), 2),
           'open_credit', round(coalesce(inv.open_credit, 0), 2),
           'cogs', round(coalesce(cogs.cogs, 0), 2),
           'gross_profit', round(coalesce(inv.sales, 0) - coalesce(ret.returns, 0) - coalesce(cogs.cogs, 0), 2),
           'expenses', round(coalesce(exp.expenses, 0), 2),
           'net_profit', round(coalesce(inv.sales, 0) - coalesce(ret.returns, 0) - coalesce(cogs.cogs, 0) - coalesce(exp.expenses, 0), 2),
           'stock_value', round(coalesce(stock.value, 0) - coalesce(short.owed, 0), 2),
           'stock_qty', coalesce(stock.qty, 0),
           'stock_items', coalesce(stock.items, 0),
           'sold_ahead_of_stock', round(coalesce(short.owed, 0), 2)
         ) ORDER BY b.name)
    INTO v_rows
    FROM b LEFT JOIN inv ON inv.branch_id = b.id LEFT JOIN cogs ON cogs.branch_id = b.id LEFT JOIN ret ON ret.branch_id = b.id
           LEFT JOIN exp ON exp.branch_id = b.id LEFT JOIN money ON money.branch_id = b.id
           LEFT JOIN stock ON stock.branch_id = b.id LEFT JOIN short ON short.branch_id = b.id;

  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'branches', coalesce(v_rows, '[]'::jsonb),
    'total', (SELECT jsonb_build_object(
       'sales', sum((x->>'sales')::numeric), 'returns', sum((x->>'returns')::numeric), 'net_sales', sum((x->>'net_sales')::numeric),
       'collected', sum((x->>'collected')::numeric), 'open_credit', sum((x->>'open_credit')::numeric),
       'cogs', sum((x->>'cogs')::numeric), 'gross_profit', sum((x->>'gross_profit')::numeric), 'expenses', sum((x->>'expenses')::numeric),
       'net_profit', sum((x->>'net_profit')::numeric), 'stock_value', sum((x->>'stock_value')::numeric),
       'stock_qty', sum((x->>'stock_qty')::numeric), 'invoices', sum((x->>'invoices')::numeric))
     FROM jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) x));
END $$;
REVOKE ALL ON FUNCTION public.owner_business_snapshot(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_business_snapshot(date, date) TO authenticated, service_role;

-- ---------------------------------------------------------------- stock movement per branch (and per product for one branch)
-- For each product of the branch, replays its cost ledger once and splits the period:
--   opening (as of p_from) + purchases + transfers in + sale returns + count up
--   − sales (at cost) − purchase returns − transfers out − count down = calculated closing
--   closing = the real quantity today (or the ledger at p_to for a past period); any gap is shown as «فرق جرد».
CREATE OR REPLACE FUNCTION public.branch_stock_report(p_from date, p_to date, p_branch uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t uuid := public.current_tenant_id();
  v_from timestamptz := (p_from::timestamp) AT TIME ZONE 'Africa/Cairo';
  v_to   timestamptz := ((p_to + 1)::timestamp) AT TIME ZONE 'Africa/Cairo';
  v_live boolean := p_to >= public.cairo_today();
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF p_branch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM branches WHERE id = p_branch AND tenant_id = v_t) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  WITH prod AS (
    SELECT p.id, p.branch_id, p.name, p.quantity
      FROM products p JOIN branches b ON b.id = p.branch_id
     WHERE p.tenant_id = v_t AND p.archived_at IS NULL AND coalesce(b.is_system, false) = false
       AND (p_branch IS NULL OR p.branch_id = p_branch)),
  led AS (
    SELECT pr.id AS product_id, l.*
      FROM prod pr, LATERAL public.product_cost_ledger(pr.id, v_to - interval '1 microsecond')
           WITH ORDINALITY AS l(ev_at, kind, ref_id, qty, unit_cost, run_qty, run_avg, out_value, seq)),
  o AS (   -- last state before the period
    SELECT DISTINCT ON (product_id) product_id, run_qty AS o_qty, coalesce(run_avg, 0) AS o_avg
      FROM led WHERE ev_at < v_from ORDER BY product_id, seq DESC),
  c AS (   -- last state at the end of the period
    SELECT DISTINCT ON (product_id) product_id, run_qty AS c_ledger_qty, coalesce(run_avg, 0) AS c_avg
      FROM led ORDER BY product_id, seq DESC),
  k AS (   -- what moved inside the period, by kind
    SELECT product_id, kind AS k, sum(abs(qty)) AS q,
           round(sum(CASE WHEN qty > 0 THEN qty * coalesce(unit_cost, run_avg, 0) ELSE coalesce(out_value, 0) END), 2) AS v
      FROM led WHERE ev_at >= v_from GROUP BY 1, 2),
  mv AS (
    SELECT product_id, jsonb_object_agg(k, jsonb_build_object('q', q, 'v', v)) AS mv FROM k GROUP BY 1),
  agg AS (
    SELECT pr.id, pr.branch_id, pr.name, pr.quantity AS qty_now,
           coalesce(o.o_qty, 0) AS o_qty, coalesce(o.o_avg, 0) AS o_avg,
           coalesce(c.c_avg, 0) AS c_avg, coalesce(c.c_ledger_qty, 0) AS c_ledger_qty, mv.mv
      FROM prod pr LEFT JOIN o ON o.product_id = pr.id LEFT JOIN c ON c.product_id = pr.id LEFT JOIN mv ON mv.product_id = pr.id),
  rows AS (
    SELECT a.*, CASE WHEN v_live THEN a.qty_now ELSE a.c_ledger_qty END AS c_qty FROM agg a),
  prod_rows AS (
    SELECT r.branch_id, jsonb_build_object(
      'product_id', r.id, 'name', r.name,
      'opening_qty', r.o_qty, 'opening_value', round(greatest(r.o_qty, 0) * r.o_avg, 2),
      'purchased_qty', coalesce((r.mv->'purchase'->>'q')::numeric, 0), 'purchased_value', coalesce((r.mv->'purchase'->>'v')::numeric, 0),
      'opening_stock_qty', coalesce((r.mv->'opening'->>'q')::numeric, 0), 'opening_stock_value', coalesce((r.mv->'opening'->>'v')::numeric, 0),
      'transfer_in_qty', coalesce((r.mv->'transfer_in'->>'q')::numeric, 0), 'transfer_in_value', coalesce((r.mv->'transfer_in'->>'v')::numeric, 0),
      'sale_return_qty', coalesce((r.mv->'sale_return'->>'q')::numeric, 0), 'sale_return_value', coalesce((r.mv->'sale_return'->>'v')::numeric, 0),
      'sold_qty', coalesce((r.mv->'sale'->>'q')::numeric, 0), 'sold_cost', coalesce((r.mv->'sale'->>'v')::numeric, 0),
      'purchase_return_qty', coalesce((r.mv->'purchase_return'->>'q')::numeric, 0), 'purchase_return_value', coalesce((r.mv->'purchase_return'->>'v')::numeric, 0),
      'transfer_out_qty', coalesce((r.mv->'transfer_out'->>'q')::numeric, 0), 'transfer_out_value', coalesce((r.mv->'transfer_out'->>'v')::numeric, 0),
      'count_diff_qty', r.c_qty - r.c_ledger_qty
                        + coalesce((r.mv->'count_in'->>'q')::numeric, 0) - coalesce((r.mv->'count_out'->>'q')::numeric, 0),
      'closing_qty', r.c_qty, 'avg_cost', round(r.c_avg, 2), 'closing_value', round(greatest(r.c_qty, 0) * r.c_avg, 2),
      -- whatever the in/out lines don't explain (stock counts, quantities fixed by hand, selling ahead of stock)
      'count_diff_value', round(greatest(r.c_qty, 0) * r.c_avg - (
          greatest(r.o_qty, 0) * r.o_avg
          + coalesce((r.mv->'purchase'->>'v')::numeric, 0) + coalesce((r.mv->'opening'->>'v')::numeric, 0)
          + coalesce((r.mv->'transfer_in'->>'v')::numeric, 0) + coalesce((r.mv->'sale_return'->>'v')::numeric, 0)
          - coalesce((r.mv->'sale'->>'v')::numeric, 0) - coalesce((r.mv->'purchase_return'->>'v')::numeric, 0)
          - coalesce((r.mv->'transfer_out'->>'v')::numeric, 0)), 2)
    ) AS j
      FROM rows r
     WHERE r.o_qty <> 0 OR r.c_qty <> 0 OR r.mv IS NOT NULL),
  tot AS (
    SELECT pr.branch_id, b.name AS branch,
      jsonb_build_object(
        'branch_id', pr.branch_id, 'branch', b.name, 'products', count(*),
        'opening_qty', sum((j->>'opening_qty')::numeric), 'opening_value', sum((j->>'opening_value')::numeric),
        'purchased_qty', sum((j->>'purchased_qty')::numeric) + sum((j->>'opening_stock_qty')::numeric),
        'purchased_value', sum((j->>'purchased_value')::numeric) + sum((j->>'opening_stock_value')::numeric),
        'transfer_in_qty', sum((j->>'transfer_in_qty')::numeric), 'transfer_in_value', sum((j->>'transfer_in_value')::numeric),
        'sale_return_qty', sum((j->>'sale_return_qty')::numeric), 'sale_return_value', sum((j->>'sale_return_value')::numeric),
        'sold_qty', sum((j->>'sold_qty')::numeric), 'sold_cost', sum((j->>'sold_cost')::numeric),
        'purchase_return_qty', sum((j->>'purchase_return_qty')::numeric), 'purchase_return_value', sum((j->>'purchase_return_value')::numeric),
        'transfer_out_qty', sum((j->>'transfer_out_qty')::numeric), 'transfer_out_value', sum((j->>'transfer_out_value')::numeric),
        'count_diff_qty', sum((j->>'count_diff_qty')::numeric), 'count_diff_value', sum((j->>'count_diff_value')::numeric),
        'closing_qty', sum((j->>'closing_qty')::numeric), 'closing_value', sum((j->>'closing_value')::numeric)) AS t
      FROM prod_rows pr JOIN branches b ON b.id = pr.branch_id GROUP BY pr.branch_id, b.name)
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to, 'live', v_live,
    'branches', coalesce((SELECT jsonb_agg(t ORDER BY branch) FROM tot), '[]'::jsonb),
    'products', CASE WHEN p_branch IS NULL THEN '[]'::jsonb
                     ELSE coalesce((SELECT jsonb_agg(j ORDER BY (j->>'closing_value')::numeric DESC, j->>'name') FROM prod_rows), '[]'::jsonb) END)
  INTO v_rows;
  RETURN v_rows;
END $$;
REVOKE ALL ON FUNCTION public.branch_stock_report(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.branch_stock_report(date, date, uuid) TO authenticated, service_role;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note)
VALUES ('branch_stock_report', '0072', 'read-only owner/admin report: stock in/out/left per branch at the moving average')
ON CONFLICT DO NOTHING;
