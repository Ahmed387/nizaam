-- 0249 — `vessel_account_statement` (0246): treasury.type is an enum → cast to text (and category) for the result.
DO $m$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.vessel_account_statement(uuid,date,date)'::regprocedure);
  n := replace(d, $a$b.name, t.type, t.category, t.amount$a$, $b$b.name, t.type::text, t.category::text, t.amount$b$);
  IF n = d THEN RAISE EXCEPTION '0249: anchor'; END IF;
  EXECUTE n;
END $m$;
