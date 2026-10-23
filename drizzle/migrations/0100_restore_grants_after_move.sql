-- 0100 — Restore SEC-001 / SEC-004 / SEC-005 after the move to «New Nizam» (kkfiplnucefytutlwaiz)
--
-- Why: the database was restored into the new project without its privileges (ACLs). Supabase's
-- default privileges then gave anon + authenticated EXECUTE on all 493 SECURITY DEFINER functions
-- and INSERT/UPDATE/DELETE on every table. Proven on 2026-10-23 (read-only / rolled back):
--   * anon (no login) read a branch row through backup_fetch_page;
--   * the cashier wrote a cash row straight into the till and updated an invoice payment.
--
-- What it does (same end state the original migrations 0049 / 0050 / 0052 / 0053 / 0054 / 0059 had):
--   1. Every SECURITY DEFINER function in public: no PUBLIC / anon / authenticated EXECUTE;
--      service_role keeps it (edge functions, cron). The functions on security_rpc_allowlist
--      (the browser RPCs) are granted to authenticated again.
--   2. anon keeps EXECUTE only on the allow-listed helpers that RLS / storage policies call
--      (is_admin, current_tenant_id, …) so an anonymous request gets "no rows", not an error.
--   3. ai_sql revoked (SEC-005); ai_report / ai_report_catalog for authenticated only.
--   4. Money and document tables: no INSERT / UPDATE / DELETE / TRUNCATE from the browser (SEC-004 +
--      the ledger, settlement, document log and adjustments tables). Internal tables: no access.
--
-- Not touched (owner rule 2026-10-23): the historical archive (historical_*) and the owner's
-- personal ledger (owner_personal_*, owner_expenses_access) keep the access they have today.
-- No row of any table is changed; auth.users is not touched.

DO $fn$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig,
           EXISTS (SELECT 1 FROM public.security_rpc_allowlist a WHERE a.function_name = p.proname) AS allowed
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    IF r.allowed THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;

  -- Allow-listed helpers used inside RLS / storage policies stay callable by anon.
  FOR r IN
    SELECT DISTINCT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f'
       AND EXISTS (SELECT 1 FROM public.security_rpc_allowlist a WHERE a.function_name = p.proname)
       AND EXISTS (SELECT 1 FROM pg_policies pol
                    WHERE pol.schemaname IN ('public', 'storage')
                      AND (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) ~ ('\m' || p.proname || '\('))
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);
  END LOOP;
END
$fn$;

-- SEC-005
REVOKE ALL ON FUNCTION public.ai_sql(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_sql(text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_report(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_report(text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_report_catalog() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_report_catalog() TO authenticated, service_role;

DO $tbl$
DECLARE t text;
BEGIN
  -- Read stays, writes only through the guarded RPCs.
  FOREACH t IN ARRAY ARRAY[
    'invoices', 'invoice_items', 'invoice_payments',
    'shipments', 'shipment_items', 'product_batches',
    'payment_plans', 'payment_installments', 'payment_transactions', 'supplier_payments',
    'customer_credit_log', 'returns', 'return_items', 'purchase_returns', 'purchase_return_items',
    'vouchers', 'treasury', 'journal_entries', 'journal_entry_lines', 'stock_movements',
    'contacts', 'partner_transactions',
    'money_movements', 'payment_allocations', 'audit_log',
    'partner_advances', 'partner_advance_payments', 'partner_advance_installments',
    'invoice_settlement', 'shipment_settlement', 'employee_adjustments', 'document_events', 'stock_shortages'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN RAISE NOTICE '0100: table % not found — skipped', t; CONTINUE; END IF;
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;

  -- Server-only tables: no browser access at all.
  FOREACH t IN ARRAY ARRAY[
    'system_integrity_cache', 'sale_requests', 'platform_flags', 'security_rpc_allowlist',
    'ledger_sync_errors', 'ledger_gl_skipped', 'ledger_gl_links', 'ledger_credit_balance_snapshot',
    'backup_cron_runs', 'backup_cron_parts'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN RAISE NOTICE '0100: table % not found — skipped', t; CONTINUE; END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END
$tbl$;

-- price_audit_log is append-only.
REVOKE UPDATE, DELETE, TRUNCATE ON public.price_audit_log FROM PUBLIC, anon, authenticated;

-- Final checks: the migration fails (and rolls back) if anything is still open.
DO $check$
DECLARE v_auth text; v_anon text; v_tables text;
BEGIN
  SELECT string_agg(function_signature, ', ') INTO v_auth FROM public.security_exposed_definer_functions();
  IF v_auth IS NOT NULL THEN
    RAISE EXCEPTION '0100: definer functions executable by authenticated outside the allow-list: %', v_auth;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_anon
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f'
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM pg_policies pol
                      WHERE pol.schemaname IN ('public', 'storage')
                        AND (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) ~ ('\m' || p.proname || '\('));
  IF v_anon IS NOT NULL THEN
    RAISE EXCEPTION '0100: definer functions still executable by anon: %', v_anon;
  END IF;

  SELECT string_agg(c.relname, ', ') INTO v_tables
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
     AND c.relname IN ('invoices', 'invoice_items', 'invoice_payments', 'shipments', 'shipment_items', 'product_batches',
                       'payment_plans', 'payment_installments', 'payment_transactions', 'supplier_payments',
                       'customer_credit_log', 'returns', 'return_items', 'purchase_returns', 'purchase_return_items',
                       'vouchers', 'treasury', 'journal_entries', 'journal_entry_lines', 'stock_movements',
                       'contacts', 'partner_transactions', 'money_movements', 'payment_allocations', 'audit_log')
     AND (has_table_privilege('authenticated', c.oid, 'INSERT') OR has_table_privilege('authenticated', c.oid, 'UPDATE')
          OR has_table_privilege('authenticated', c.oid, 'DELETE') OR has_table_privilege('anon', c.oid, 'INSERT'));
  IF v_tables IS NOT NULL THEN
    RAISE EXCEPTION '0100: the browser can still write: %', v_tables;
  END IF;
END
$check$;
