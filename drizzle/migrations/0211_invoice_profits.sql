-- 0211 — «ربح الفاتورة» column on the sale invoices list (owner 2026-11-14).
-- profit = (invoice total − VAT − its active returns' value) − (cost of the pieces sold − cost of the pieces returned)
-- The cost is the one the ledger posts (post_invoice_cogs / sale_return_cost), so Σ of the column matches the
-- income statement's gross profit for the same invoices. Archive invoices (before 2026) already carry the net
-- quantity's cost, so their returns' cost is not taken again (same rule as 0129).
-- Who may read it: the permission «رؤية صافي الربح» (net_profit.view) — owner / admin always.
CREATE OR REPLACE FUNCTION public.invoice_profits(p_ids uuid[])
 RETURNS TABLE(invoice_id uuid, sales numeric, cost numeric, returned numeric, returned_cost numeric, profit numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH inv AS (
    SELECT i.id, i.total - COALESCE(i.vat_amount, 0) AS sales,
           public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id) AS archive
      FROM public.invoices i
     WHERE i.id = ANY (p_ids) AND i.status = 'active'
       AND i.tenant_id = public.current_tenant_id()
       AND (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid()) OR public.has_permission(auth.uid(), 'net_profit.view'))
  ),
  c AS (
    SELECT inv.id, COALESCE(sum(COALESCE(NULLIF(ii.unit_cost_at_sale, 0), NULLIF(ii.cost_price, 0), 0)
             * CASE WHEN inv.archive THEN COALESCE(ii.net_quantity, ii.quantity - COALESCE(ii.returned_quantity, 0)) ELSE ii.quantity END), 0) AS cost
      FROM inv LEFT JOIN public.invoice_items ii ON ii.invoice_id = inv.id
     GROUP BY inv.id
  ),
  r AS (
    SELECT inv.id, COALESCE(sum(rt.total_refund), 0) AS returned,
           COALESCE(sum(CASE WHEN inv.archive THEN 0 ELSE public.sale_return_cost(rt.id) END), 0) AS returned_cost
      FROM inv LEFT JOIN public.returns rt ON rt.invoice_id = inv.id AND COALESCE(rt.status, 'active') <> 'cancelled'
     GROUP BY inv.id
  )
  SELECT inv.id, round(inv.sales, 2), round(c.cost, 2), round(r.returned, 2), round(r.returned_cost, 2),
         round(inv.sales - r.returned - (c.cost - r.returned_cost), 2)
    FROM inv JOIN c ON c.id = inv.id JOIN r ON r.id = inv.id;
$function$;

REVOKE ALL ON FUNCTION public.invoice_profits(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_profits(uuid[]) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
VALUES ('invoice_profits', '0211', 'per-invoice profit, gated by net_profit.view inside')
ON CONFLICT DO NOTHING;
