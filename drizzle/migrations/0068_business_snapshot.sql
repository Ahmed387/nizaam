-- 0068 — "Are we winning or losing, and what is the stock of each branch worth?"
-- One read-only RPC for the owner's dashboard and the profit report, per branch and in total:
--   sales (active invoices, by invoice date) − sale returns = net sales
--   cost of goods sold = unit cost at sale × quantity kept (same figure the COGS journal posts)
--   gross profit = net sales − COGS
--   operating expenses = payment vouchers whose category is "deducted from profit"
--   net profit = gross profit − expenses
--   stock value now = Σ remaining batch quantity × batch cost (products without batches: quantity × cost),
--                     minus goods sold ahead of arrival (open negative-stock shortages).
CREATE OR REPLACE FUNCTION public.owner_business_snapshot(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t uuid := public.current_tenant_id(); v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  WITH b AS (SELECT id, name FROM public.branches WHERE tenant_id = v_t AND coalesce(is_system, false) = false),
  inv AS (
    SELECT i.branch_id, sum(i.total) AS sales, count(*) AS n
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
  stock AS (
    SELECT p.branch_id,
           sum(CASE WHEN x.n > 0 THEN x.val ELSE greatest(p.quantity, 0) * coalesce(p.cost_price, 0) END) AS value,
           sum(greatest(p.quantity, 0)) AS qty,
           count(*) FILTER (WHERE p.quantity > 0) AS items
      FROM public.products p
      LEFT JOIN LATERAL (SELECT count(*) AS n, coalesce(sum(pb.quantity_remaining * pb.cost_price), 0) AS val
                           FROM public.product_batches pb WHERE pb.product_id = p.id AND pb.quantity_remaining > 0) x ON true
     WHERE p.tenant_id = v_t AND p.archived_at IS NULL
     GROUP BY 1),
  short AS (
    SELECT s.branch_id, sum((s.qty - s.qty_settled) * s.provisional_unit_cost) AS owed
      FROM public.stock_shortages s WHERE s.tenant_id = v_t AND s.status = 'open' GROUP BY 1)
  SELECT jsonb_agg(jsonb_build_object(
           'branch_id', b.id, 'branch', b.name,
           'invoices', coalesce(inv.n, 0),
           'sales', round(coalesce(inv.sales, 0), 2),
           'returns', round(coalesce(ret.returns, 0), 2),
           'net_sales', round(coalesce(inv.sales, 0) - coalesce(ret.returns, 0), 2),
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
           LEFT JOIN exp ON exp.branch_id = b.id LEFT JOIN stock ON stock.branch_id = b.id LEFT JOIN short ON short.branch_id = b.id;

  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'branches', coalesce(v_rows, '[]'::jsonb),
    'total', (SELECT jsonb_build_object(
       'sales', sum((x->>'sales')::numeric), 'returns', sum((x->>'returns')::numeric), 'net_sales', sum((x->>'net_sales')::numeric),
       'cogs', sum((x->>'cogs')::numeric), 'gross_profit', sum((x->>'gross_profit')::numeric), 'expenses', sum((x->>'expenses')::numeric),
       'net_profit', sum((x->>'net_profit')::numeric), 'stock_value', sum((x->>'stock_value')::numeric),
       'stock_qty', sum((x->>'stock_qty')::numeric), 'invoices', sum((x->>'invoices')::numeric))
     FROM jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) x));
END $$;
REVOKE ALL ON FUNCTION public.owner_business_snapshot(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_business_snapshot(date, date) TO authenticated, service_role;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note)
VALUES ('owner_business_snapshot', '0068', 'read-only owner/admin summary: profit and stock value per branch of the caller''s company')
ON CONFLICT DO NOTHING;
