
CREATE OR REPLACE FUNCTION public.backup_tenant_filter(_table text, _alias text, _depth int DEFAULT 0)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  has_tenant boolean;
  r record;
  child_col text;
  parent_col text;
  sub text;
BEGIN
  IF _depth > 4 THEN RETURN 'false'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=_table AND column_name='tenant_id'
  ) INTO has_tenant;

  IF has_tenant THEN
    RETURN format('%I.tenant_id = $1', _alias);
  END IF;

  FOR r IN
    SELECT c.conname, pc.relname::text AS parent
    FROM pg_constraint c
    JOIN pg_class pc ON pc.oid = c.confrelid
    JOIN pg_namespace pn ON pn.oid = pc.relnamespace
    WHERE c.conrelid = format('public.%I', _table)::regclass
      AND c.contype = 'f'
      AND c.confrelid <> c.conrelid
      AND pn.nspname = 'public'
    ORDER BY c.conname
  LOOP
    SELECT a.attname, af.attname
      INTO child_col, parent_col
    FROM pg_constraint c
    JOIN LATERAL unnest(c.conkey, c.confkey) AS k(ck, fk) ON true
    JOIN pg_attribute a  ON a.attrelid = c.conrelid  AND a.attnum = k.ck
    JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = k.fk
    WHERE c.conname = r.conname AND c.conrelid = format('public.%I', _table)::regclass
    LIMIT 1;

    sub := public.backup_tenant_filter(r.parent, 'p' || _depth, _depth + 1);
    IF sub <> 'false' THEN
      RETURN format(
        'EXISTS (SELECT 1 FROM public.%I %I WHERE %I.%I = %I.%I AND %s)',
        r.parent, 'p' || _depth,
        'p' || _depth, parent_col, _alias, child_col, sub
      );
    END IF;
  END LOOP;

  RETURN 'false';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.backup_table_manifest()
RETURNS TABLE(ord int, table_name text, tenant_scoped boolean, filter_sql text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  placed text[] := ARRAY[]::text[];
  remaining text[];
  progressed boolean;
  t text;
  deps text[];
  i int := 0;
BEGIN
  SELECT array_agg(c.relname::text ORDER BY c.relname)
    INTO remaining
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r';

  LOOP
    progressed := false;
    FOREACH t IN ARRAY COALESCE(remaining, ARRAY[]::text[]) LOOP
      IF t = ANY(placed) THEN CONTINUE; END IF;
      SELECT COALESCE(array_agg(DISTINCT pc.relname::text), ARRAY[]::text[])
        INTO deps
      FROM pg_constraint con
      JOIN pg_class pc ON pc.oid = con.confrelid
      JOIN pg_namespace pn ON pn.oid = pc.relnamespace
      WHERE con.conrelid = format('public.%I', t)::regclass
        AND con.contype = 'f'
        AND con.confrelid <> con.conrelid
        AND pn.nspname = 'public';
      IF (SELECT COALESCE(bool_and(d = ANY(placed)), true) FROM unnest(deps) d) THEN
        placed := placed || t;
        progressed := true;
      END IF;
    END LOOP;
    EXIT WHEN NOT progressed;
  END LOOP;

  FOREACH t IN ARRAY COALESCE(remaining, ARRAY[]::text[]) LOOP
    IF NOT (t = ANY(placed)) THEN placed := placed || t; END IF;
  END LOOP;

  FOREACH t IN ARRAY placed LOOP
    i := i + 1;
    ord := i;
    table_name := t;
    filter_sql := public.backup_tenant_filter(t, 'x', 0);
    tenant_scoped := filter_sql <> 'false';
    RETURN NEXT;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.backup_tenant_filter(text, text, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backup_table_manifest() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backup_tenant_filter(text, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.backup_table_manifest() TO service_role;
