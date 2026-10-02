DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
    WHERE s.nspname='public' AND p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
    WHERE s.nspname='public' AND p.proname IN ('ai_sql','map_treasury_to_category_key')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
  END LOOP;
END $$;
ALTER VIEW public.v_shifts_history SET (security_invoker = true);
ALTER VIEW public.v_treasury_balances SET (security_invoker = true);
ALTER VIEW public.v_contact_balances SET (security_invoker = true);
ALTER VIEW public.v_treasury_gl_variance SET (security_invoker = true);
ALTER VIEW public.voucher_treasury_balances SET (security_invoker = true);
ALTER VIEW public.v_account_balances SET (security_invoker = true);