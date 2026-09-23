CREATE OR REPLACE FUNCTION pg_temp.rls_wrap(e text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text := e;
BEGIN
  IF r IS NULL THEN RETURN NULL; END IF;
  r := regexp_replace(r, '(?<!SELECT )(public\.)?(is_super_admin|is_admin|has_role)\(auth\.uid\(\)((, ''[a-z_]+''::app_role)?)\)', '(SELECT public.\2(auth.uid()\3))', 'g');
  r := regexp_replace(r, '(?<!SELECT )(public\.)?current_tenant_id\(\)', '(SELECT public.current_tenant_id())', 'g');
  r := regexp_replace(r, '(?<!SELECT )(public\.)?current_tenant_is_suspended\(\)', '(SELECT public.current_tenant_is_suspended())', 'g');
  r := regexp_replace(r, '= auth\.uid\(\)', '= (SELECT auth.uid())', 'g');
  RETURN r;
END $$;

DO $$
DECLARE p record; nq text; nc text; sql text;
BEGIN
  FOR p IN SELECT tablename, policyname, qual, with_check FROM pg_policies WHERE schemaname='public' LOOP
    nq := pg_temp.rls_wrap(p.qual);
    nc := pg_temp.rls_wrap(p.with_check);
    IF nq IS DISTINCT FROM p.qual OR nc IS DISTINCT FROM p.with_check THEN
      sql := format('ALTER POLICY %I ON public.%I', p.policyname, p.tablename);
      IF nq IS NOT NULL THEN sql := sql || ' USING (' || nq || ')'; END IF;
      IF nc IS NOT NULL THEN sql := sql || ' WITH CHECK (' || nc || ')'; END IF;
      EXECUTE sql;
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_branch_name ON public.products(branch_id, name);
CREATE INDEX IF NOT EXISTS idx_role_permissions_tenant ON public.role_permissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_branch_users_user_branch ON public.branch_users(user_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_role ON public.user_roles(user_id, role);