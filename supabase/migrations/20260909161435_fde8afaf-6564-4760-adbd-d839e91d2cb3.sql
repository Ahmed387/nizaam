
-- ============ 1) شرط عزل المستأجر لأي جدول (مباشر أو عبر الأب) ============
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
    SELECT c.conname, c.confrelid::regclass::text AS parent
    FROM pg_constraint c
    WHERE c.conrelid = format('public.%I', _table)::regclass
      AND c.contype = 'f'
      AND c.confrelid <> c.conrelid
      AND c.confrelid::regclass::text NOT LIKE 'auth.%'
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

    sub := public.backup_tenant_filter(split_part(r.parent, '.', 2), 'p' || _depth, _depth + 1);
    IF sub <> 'false' THEN
      RETURN format(
        'EXISTS (SELECT 1 FROM public.%I %I WHERE %I.%I = %I.%I AND %s)',
        split_part(r.parent, '.', 2), 'p' || _depth,
        'p' || _depth, parent_col, _alias, child_col, sub
      );
    END IF;
  END LOOP;

  RETURN 'false';
END;
$fn$;

REVOKE ALL ON FUNCTION public.backup_tenant_filter(text, text, int) FROM PUBLIC, anon, authenticated;

-- ============ 2) فهرس الجداول بترتيب طوبولوجي ============
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
      SELECT COALESCE(array_agg(DISTINCT split_part(con.confrelid::regclass::text, '.', 2)), ARRAY[]::text[])
        INTO deps
      FROM pg_constraint con
      WHERE con.conrelid = format('public.%I', t)::regclass
        AND con.contype = 'f'
        AND con.confrelid <> con.conrelid
        AND con.confrelid::regclass::text LIKE 'public.%';
      IF (SELECT COALESCE(bool_and(d = ANY(placed)), true) FROM unnest(deps) d) THEN
        placed := placed || t;
        progressed := true;
      END IF;
    END LOOP;
    EXIT WHEN NOT progressed;
  END LOOP;

  -- أي جداول متبقية (دورات مرجعية) تُضاف في النهاية
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

REVOKE ALL ON FUNCTION public.backup_table_manifest() FROM PUBLIC, anon, authenticated;

-- ============ 3) سحب صفحة من أي جدول مقصورة على المستأجر ============
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
  IF cond = 'false' THEN RETURN '[]'::jsonb; END IF;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.ctid), ''[]''::jsonb)
       FROM (SELECT * FROM public.%I x WHERE %s ORDER BY x.ctid OFFSET %s LIMIT %s) x',
    _table, cond, _offset, _limit
  ) INTO res USING _tenant;

  RETURN COALESCE(res, '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.backup_fetch_page(text, uuid, int, int) FROM PUBLIC, anon, authenticated;

-- ============ 4) إعدادات النسخ الاحتياطي لكل شركة ============
CREATE TABLE IF NOT EXISTS public.backup_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  drive_folder_id text,
  drive_file_id text,
  drive_file_name text NOT NULL DEFAULT 'AL_SHOROUK_ERP_MASTER_BACKUP.tar.gz',
  drive_connected boolean NOT NULL DEFAULT false,
  refresh_token_encrypted text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_settings TO authenticated;
GRANT ALL ON public.backup_settings TO service_role;

ALTER TABLE public.backup_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners manage backup settings" ON public.backup_settings;
CREATE POLICY "owners manage backup settings"
ON public.backup_settings
FOR ALL
TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'super_admin'))
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'super_admin'))
);

DROP TRIGGER IF EXISTS trg_backup_settings_updated_at ON public.backup_settings;
CREATE TRIGGER trg_backup_settings_updated_at
BEFORE UPDATE ON public.backup_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
