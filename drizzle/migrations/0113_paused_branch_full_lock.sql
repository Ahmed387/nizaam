-- 0113: everything that belongs to a paused branch is locked (owner decision 2026-10-24: «كل حاجة تخص الفرع تتقفل»).
-- Why: 0109 removed a paused branch from my_branch_ids / my_write_branch_ids, but some tables read by
-- company only (inventory_sessions, sale_requests, shift_cash_handovers, ...) still showed its rows.
-- Rule, on every table with branch_id (RESTRICTIVE, added on top of the existing policies):
--   read  : rows of a paused branch only for the super admin and the company owner / admin
--   write : rows of a paused branch only for the super admin (insert, update, delete)
-- Not added: branch_users (membership, the pause screen needs it), contacts / customers / suppliers
-- (company-wide parties; branch_id only says where they were added).
-- SECURITY DEFINER functions (postgres, BYPASSRLS) are not affected; they check assert_access (0109).

CREATE OR REPLACE FUNCTION public.paused_branch_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(b.id), '{}'::uuid[])
    FROM public.branches b
   WHERE b.platform_paused AND b.tenant_id = public.current_tenant_id();
$function$;

-- The pause screen: names of the caller's own paused branches (the branch row itself is hidden from employees).
CREATE OR REPLACE FUNCTION public.my_paused_branches()
 RETURNS TABLE(id uuid, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT b.id, b.name
    FROM public.branch_users bu JOIN public.branches b ON b.id = bu.branch_id
   WHERE bu.user_id = auth.uid() AND b.platform_paused;
$function$;

REVOKE ALL ON FUNCTION public.paused_branch_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_paused_branches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paused_branch_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_paused_branches() TO authenticated;

INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
SELECT v, '0113', 'paused branch lock: RLS helper (own company only) / pause screen names'
  FROM unnest(ARRAY['paused_branch_ids', 'my_paused_branches']) v
 WHERE NOT EXISTS (SELECT 1 FROM public.security_rpc_allowlist a WHERE a.function_name = v);

DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'advance_requests','approval_requests','attendance','audit_log','branch_capital_allocations',
    'branch_closures','branch_schedules','cashier_shifts','discount_approval_requests','document_events',
    'employee_adjustments','employees','expenses','inventory_reservations','inventory_sessions',
    'invoice_payments','invoice_settlement','invoices','journal_entries','migration_batches',
    'money_movements','payment_plans','payment_transactions','pre_order_transactions','pre_orders',
    'price_audit_log','product_batches','products','purchase_returns','quotes','returns',
    'sale_requests','shift_cash_handovers','shift_schedules','shipment_settlement','shipments',
    'stock_adjustments','stock_movements','stock_shortages','supplier_payments','treasury','vouchers'];
  ok_row text := '(branch_id IS NULL OR NOT (branch_id = ANY ((SELECT public.paused_branch_ids())::uuid[])))';
  super text := '(SELECT public.is_super_admin((SELECT auth.uid())))';
  boss text := '(SELECT public.is_admin((SELECT auth.uid())) OR public.is_owner((SELECT auth.uid())))';
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS branch_paused_read ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS branch_paused_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS branch_paused_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS branch_paused_delete ON public.%I', t);
    EXECUTE format('CREATE POLICY branch_paused_read ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (%s OR %s OR %s)', t, ok_row, super, boss);
    EXECUTE format('CREATE POLICY branch_paused_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s OR %s)', t, ok_row, super);
    EXECUTE format('CREATE POLICY branch_paused_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s OR %s) WITH CHECK (%s OR %s)', t, ok_row, super, ok_row, super);
    EXECUTE format('CREATE POLICY branch_paused_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (%s OR %s)', t, ok_row, super);
  END LOOP;
END $$;
