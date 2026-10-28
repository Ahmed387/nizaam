-- 0133: the profit screens and the weekly report count a return in ITS month, like the card (owner «نفذ», 2026-10-28)
--
-- 0129 moved the card and the books to «a 2026 sale counts at its full quantity on its day; a return takes its
-- money and its cost back on the return's day». The profitability report, the branch dashboard / reports and the
-- weekly report still counted a return on its invoice's day. Example SR00083: IN04796 sold 2/3 for 20,332 (cost
-- 16,350), returned 23/5 → card March +3,982 / May −3,982, the report March 0 / May 0.
--
-- 1) sale_return_lines(from, to, branch?) — every line of the active sale returns dated in the period (return day),
--    with the money given back and, for 2026 invoices, the cost that comes back (the same unit cost as
--    sale_return_cost). Archive invoices (before 2026) give back money only: their cost was already net.
--    SECURITY INVOKER: each screen sees only the returns its RLS lets it read.
-- 2) owner_business_snapshot(from, to, tenant?) — the scheduled weekly report (service role, no user) passes the
--    company; a signed-in user always gets his own company (p_tenant is ignored for him).

CREATE OR REPLACE FUNCTION public.sale_return_lines(p_from date, p_to date, p_branch uuid DEFAULT NULL)
 RETURNS TABLE(branch_id uuid, return_id uuid, return_number text, return_day date, invoice_id uuid, invoice_number text,
               invoice_day date, archive_invoice boolean, product_id uuid, product_name text, quantity numeric,
               refund numeric, unit_cost numeric, cost numeric)
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT r.branch_id, r.id, r.return_number,
         (COALESCE(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date,
         i.id, i.invoice_number, (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date,
         a.arch, ri.product_id, COALESCE(p.name, '—'), ri.quantity::numeric, COALESCE(ri.refund, 0),
         CASE WHEN a.arch THEN 0 ELSE COALESCE(c.unit_cost, 0) END,
         CASE WHEN a.arch THEN 0 ELSE round(ri.quantity * COALESCE(c.unit_cost, 0), 2) END
    FROM public.returns r
    JOIN public.invoices i ON i.id = r.invoice_id
    CROSS JOIN LATERAL (SELECT public.ledger_invoice_is_archive(i.invoice_date, i.created_at, i.is_migrated, i.migration_batch_id) AS arch) a
    JOIN public.return_items ri ON ri.return_id = r.id
    LEFT JOIN public.products p ON p.id = ri.product_id
    LEFT JOIN LATERAL (
      SELECT sum(COALESCE(NULLIF(ii.unit_cost_at_sale, 0), NULLIF(ii.cost_price, 0), 0) * ii.quantity) / NULLIF(sum(ii.quantity), 0) AS unit_cost
        FROM public.invoice_items ii
       WHERE ii.invoice_id = r.invoice_id AND ii.product_id = ri.product_id
    ) c ON ri.product_id IS NOT NULL
   WHERE r.tenant_id = public.current_tenant_id()
     AND COALESCE(r.status, 'active') = 'active'
     AND (COALESCE(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to
     AND (p_branch IS NULL OR r.branch_id = p_branch)
$function$;
REVOKE ALL ON FUNCTION public.sale_return_lines(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sale_return_lines(date, date, uuid) TO authenticated, service_role;

-- owner_business_snapshot: the company can be passed by the service role only
DO $mig$
DECLARE d text := pg_get_functiondef('public.owner_business_snapshot(date,date)'::regprocedure);
  n int := 0;
BEGIN
  d := replace(d, 'owner_business_snapshot(p_from date, p_to date)', 'owner_business_snapshot(p_from date, p_to date, p_tenant uuid DEFAULT NULL)');
  d := replace(d, 'DECLARE v_t uuid := public.current_tenant_id(); v_rows jsonb;',
    $n$DECLARE v_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_t uuid := CASE WHEN COALESCE(auth.role(), '') = 'service_role' AND p_tenant IS NOT NULL THEN p_tenant ELSE public.current_tenant_id() END;
  v_rows jsonb;$n$);
  d := replace(d, $o$IF auth.uid() IS NULL OR NOT public.can_read_company_report(ARRAY['part.admin_home.business_snapshot.view', 'admin_reports_profitability.view']) THEN$o$,
    $n$-- 0133: the scheduled weekly report runs as the service role with p_tenant
  IF NOT v_service AND (auth.uid() IS NULL OR NOT public.can_read_company_report(ARRAY['part.admin_home.business_snapshot.view', 'admin_reports_profitability.view'])) THEN$n$);
  IF position('p_tenant uuid DEFAULT NULL' IN d) = 0 OR position('v_service boolean' IN d) = 0 OR position('IF NOT v_service AND' IN d) = 0 THEN
    RAISE EXCEPTION '0133: owner_business_snapshot not the expected version';
  END IF;
  EXECUTE d;
  DROP FUNCTION public.owner_business_snapshot(date, date);
END
$mig$;
REVOKE ALL ON FUNCTION public.owner_business_snapshot(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_business_snapshot(date, date, uuid) TO authenticated, service_role;
