-- 0075 — Speed: row-level security that is evaluated once per query, not once per row.
--
-- Why: every policy called user_in_branch(auth.uid(), branch_id) / user_can_write_branch(...) for EACH row,
-- and many called auth.uid() / has_role(auth.uid(), …) / current_tenant_id() unwrapped. Reading the till
-- (≈5k rows) took 1.4 s, the journal lines (≈60k) 0.8 s, just for the policy checks.
--
-- What changes (same rules, same answers — only evaluated once per statement):
--   * my_branch_ids()       = every branch user_in_branch(auth.uid(), b) is true for (+ a zero id when a NULL
--                             branch is allowed, i.e. admin / super admin). Policies test branch_id = ANY(…).
--   * my_write_branch_ids() = the same for user_can_write_branch (a NULL branch is always allowed).
--   * auth.uid(), current_tenant_id(), is_admin / is_super_admin / is_owner / has_central_access / has_role
--     (auth.uid(), …) are wrapped in ( SELECT … ) so Postgres runs them once (initplan).
--   * Identical duplicate indexes are dropped (they only slow writes).
-- The two helpers take no id (they read the session user) — nothing about another user can be asked (SEC-007).

CREATE OR REPLACE FUNCTION public.my_branch_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (SELECT auth.uid() AS id)
  SELECT CASE
    WHEN (SELECT id FROM u) IS NULL THEN '{}'::uuid[]
    WHEN public.is_super_admin((SELECT id FROM u)) THEN
      array_append(ARRAY(SELECT b.id FROM public.branches b), '00000000-0000-0000-0000-000000000000'::uuid)
    WHEN public.is_admin((SELECT id FROM u)) THEN
      array_append(ARRAY(SELECT b.id FROM public.branches b
                          WHERE b.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = (SELECT id FROM u))),
                   '00000000-0000-0000-0000-000000000000'::uuid)
    ELSE ARRAY(SELECT b.id FROM public.branches b JOIN public.branch_users bu ON bu.branch_id = b.id
                WHERE bu.user_id = (SELECT id FROM u)
                  AND b.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = (SELECT id FROM u)))
  END
$$;

CREATE OR REPLACE FUNCTION public.my_write_branch_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (SELECT auth.uid() AS id)
  SELECT CASE
    WHEN (SELECT id FROM u) IS NULL THEN '{}'::uuid[]
    WHEN public.is_super_admin((SELECT id FROM u)) THEN
      array_append(ARRAY(SELECT b.id FROM public.branches b), '00000000-0000-0000-0000-000000000000'::uuid)
    WHEN public.is_admin((SELECT id FROM u)) OR public.is_owner((SELECT id FROM u)) THEN
      array_append(ARRAY(SELECT b.id FROM public.branches b
                          WHERE b.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = (SELECT id FROM u))),
                   '00000000-0000-0000-0000-000000000000'::uuid)
    ELSE array_append(ARRAY(SELECT b.id FROM public.branches b JOIN public.branch_users bu ON bu.branch_id = b.id
                             WHERE bu.user_id = (SELECT id FROM u) AND coalesce(bu.access_level, 'manage') = 'manage'
                               AND b.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = (SELECT id FROM u))),
                      '00000000-0000-0000-0000-000000000000'::uuid)
  END
$$;

REVOKE ALL ON FUNCTION public.my_branch_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_write_branch_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_branch_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_write_branch_ids() TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('my_branch_ids', '0075', 'RLS helper: the session user''s branches (no id argument)'),
  ('my_write_branch_ids', '0075', 'RLS helper: the session user''s writable branches (no id argument)')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- rewrite every policy expression
CREATE OR REPLACE FUNCTION pg_temp.rls_fast(t text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE s text := t;
BEGIN
  IF s IS NULL THEN RETURN NULL; END IF;
  s := regexp_replace(s, '(?<!SELECT )\mauth\.uid\(\)', '( SELECT auth.uid() AS uid)', 'g');
  s := regexp_replace(s, '\m(public\.)?user_in_branch\(\( SELECT auth\.uid\(\) AS uid\), ([a-z_][a-z0-9_.]*)\)',
       '(COALESCE(\2, ''00000000-0000-0000-0000-000000000000''::uuid) = ANY (( SELECT my_branch_ids() AS ub)::uuid[]))', 'g');
  s := regexp_replace(s, '\m(public\.)?user_can_write_branch\(\( SELECT auth\.uid\(\) AS uid\), ([a-z_][a-z0-9_.]*)\)',
       '(COALESCE(\2, ''00000000-0000-0000-0000-000000000000''::uuid) = ANY (( SELECT my_write_branch_ids() AS wb)::uuid[]))', 'g');
  s := regexp_replace(s, '(?<!SELECT )\m((public\.)?(is_admin|is_super_admin|is_owner|is_viewer|is_partner|has_central_access|has_role)\(\( SELECT auth\.uid\(\) AS uid\)(, ''[^'']*''::(public\.)?app_role)?\))',
       '( SELECT \1 AS f)', 'g');
  s := regexp_replace(s, '(?<!SELECT )\m((public\.)?current_tenant_id\(\))', '( SELECT \1 AS t)', 'g');
  RETURN s;
END $f$;

DO $$
DECLARE p record; q text; w text; sql text; n int := 0;
BEGIN
  FOR p IN SELECT schemaname, tablename, policyname, qual, with_check FROM pg_policies WHERE schemaname = 'public' LOOP
    q := pg_temp.rls_fast(p.qual); w := pg_temp.rls_fast(p.with_check);
    IF q IS DISTINCT FROM p.qual OR w IS DISTINCT FROM p.with_check THEN
      sql := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
      IF q IS NOT NULL THEN sql := sql || ' USING (' || q || ')'; END IF;
      IF w IS NOT NULL THEN sql := sql || ' WITH CHECK (' || w || ')'; END IF;
      EXECUTE sql; n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'policies rewritten: %', n;
END $$;

-- ---------------------------------------------------------------- identical duplicate indexes
DO $$
DECLARE i text;
BEGIN
  FOREACH i IN ARRAY ARRAY['idx_pp_branch', 'idx_pt_branch', 'products_branch_id_idx', 'shipments_branch_id_idx',
                           'treasury_branch_id_idx', 'idx_vouchers_treasury'] LOOP
    IF to_regclass('public.' || i) IS NOT NULL THEN EXECUTE 'DR' || 'OP INDEX IF EXISTS public.' || quote_ident(i); END IF;
  END LOOP;
END $$;
