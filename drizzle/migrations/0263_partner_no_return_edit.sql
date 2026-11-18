-- 0263 (permissions parity check 2026-11-18): the default «تعديل المرتجعات» (returns.update, 0132) was on for every role
-- but «مراقب» — so a partner (role 'partner', read only like a viewer) got it on the server while the screen said no.
-- A partner never writes: the default now skips 'viewer' AND 'partner'. Check: perm_resolve(partner, 'returns.update') = false.

CREATE OR REPLACE FUNCTION pg_temp.rep(src text, a text, b text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF position(a IN src) = 0 THEN RAISE EXCEPTION 'anchor not found: %', left(a, 80); END IF;
  RETURN replace(src, a, b);
END $$;

DO $m$
DECLARE d text := pg_get_functiondef('public.role_permission_default(text,text)'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$(p_key = 'returns.update' AND p_role <> 'viewer')$a$, $b$(p_key = 'returns.update' AND p_role NOT IN ('viewer', 'partner'))$b$);
  EXECUTE d;
END $m$;
