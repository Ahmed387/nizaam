
DROP FUNCTION IF EXISTS public.backup_table_manifest();
CREATE OR REPLACE FUNCTION public.backup_table_manifest()
RETURNS TABLE(ord int, table_name text, scope text, filter_sql text)
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
  f text;
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
    f := public.backup_tenant_filter(t, 'x', 0);
    filter_sql := f;
    scope := CASE WHEN f = 'false' THEN 'global' ELSE 'tenant' END;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.backup_fetch_page(_table text, _tenant uuid, _offset int, _limit int)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  cond text;
  res jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname = _table
  ) THEN
    RAISE EXCEPTION 'جدول غير معروف: %', _table;
  END IF;

  cond := public.backup_tenant_filter(_table, 'x', 0);
  -- الجداول التي لا تحمل رقم شركة (الأرشيف التاريخي وسجلات المالك) تُسحب بالكامل
  IF cond = 'false' THEN cond := 'true'; END IF;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(s.r)), ''[]''::jsonb)
       FROM (SELECT x AS r FROM public.%I x WHERE %s ORDER BY x.ctid OFFSET %s LIMIT %s) s',
    _table, cond, _offset, _limit
  ) INTO res USING _tenant;

  RETURN COALESCE(res, '[]'::jsonb);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.restore_tenant_snapshot(_tenant uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  skip_tables text[] := ARRAY['tenants','backup_settings','system_backups','system_cron_tokens','schema_migrations'];
  m record;
  arr jsonb;
  cond text;
  n bigint;
  counts jsonb := '{}'::jsonb;
  data jsonb := COALESCE(_payload -> 'data', '{}'::jsonb);
BEGIN
  IF _tenant IS NULL THEN RAISE EXCEPTION 'المستأجر مطلوب'; END IF;
  IF data = '{}'::jsonb THEN RAISE EXCEPTION 'ملف النسخة الاحتياطية فارغ'; END IF;

  PERFORM set_config('session_replication_role', 'replica', true);

  FOR m IN SELECT * FROM public.backup_table_manifest() ORDER BY ord DESC LOOP
    CONTINUE WHEN m.table_name = ANY(skip_tables);
    CONTINUE WHEN NOT (data ? m.table_name);
    cond := CASE WHEN m.scope = 'global' THEN 'true' ELSE m.filter_sql END;
    EXECUTE format('DELETE FROM public.%I x WHERE %s', m.table_name, cond) USING _tenant;
  END LOOP;

  FOR m IN SELECT * FROM public.backup_table_manifest() ORDER BY ord ASC LOOP
    CONTINUE WHEN m.table_name = ANY(skip_tables);
    arr := data -> m.table_name;
    CONTINUE WHEN arr IS NULL OR jsonb_typeof(arr) <> 'array' OR jsonb_array_length(arr) = 0;
    EXECUTE format(
      'INSERT INTO public.%I SELECT * FROM jsonb_populate_recordset(NULL::public.%I, $1)',
      m.table_name, m.table_name
    ) USING arr;
    GET DIAGNOSTICS n = ROW_COUNT;
    counts := counts || jsonb_build_object(m.table_name, n);
  END LOOP;

  PERFORM set_config('session_replication_role', 'origin', true);
  RETURN jsonb_build_object('ok', true, 'restored', counts);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('session_replication_role', 'origin', true);
  RAISE EXCEPTION 'فشل الاستعادة وتم التراجع بالكامل: %', SQLERRM;
END;
$fn$;

REVOKE ALL ON FUNCTION public.backup_table_manifest() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backup_fetch_page(text, uuid, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_tenant_snapshot(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backup_table_manifest() TO service_role;
GRANT EXECUTE ON FUNCTION public.backup_fetch_page(text, uuid, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_tenant_snapshot(uuid, jsonb) TO service_role;
