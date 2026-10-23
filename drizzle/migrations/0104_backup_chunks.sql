-- 0104 — Nightly backup: big tables are copied in 16 pieces
--
-- Why: after 0103 the statement timeout is gone, but the edge worker still runs out of memory / CPU
-- («WORKER_RESOURCE_LIMIT») when it holds journal_entry_lines (333k rows) or journal_entries (166k) in one
-- request. Last full backup: 2026-10-12.
--
-- What: a table with a uuid «id» and more than 100,000 rows becomes 16 parts «<table>#0» … «<table>#f»,
-- one per first hex digit of the id (≈ 21k rows each, ids are random so the pieces are even). Each piece is read
-- with keyset paging on the primary key (id > last id), no deep OFFSET. The archive holds
-- tables/<table>.<hex>.json.gz; restore-system-backup joins the pieces back. Smaller tables are unchanged.
-- Read-only on business data: no row is written; backup_fetch_range is for service_role only.

CREATE OR REPLACE FUNCTION public.backup_part_list()
RETURNS TABLE(table_name text, ord int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE WHEN big THEN m.table_name || '#' || h.d ELSE m.table_name END, m.ord
    FROM (
      SELECT m.table_name, m.ord,
             (c.reltuples > 100000 AND EXISTS (
                SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'id'
                   AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype)) AS big
        FROM public.backup_table_manifest() m
        JOIN pg_class c ON c.relname = m.table_name AND c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
    ) m
    LEFT JOIN LATERAL (SELECT d FROM unnest(string_to_array('0,1,2,3,4,5,6,7,8,9,a,b,c,d,e,f', ',')) d) h ON m.big
   ORDER BY m.ord, 1;
$$;

CREATE OR REPLACE FUNCTION public.backup_fetch_range(_table text, _tenant uuid, _hex text, _after uuid, _limit int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  cond text; res jsonb; v_lo uuid; v_hi uuid; v_next text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname = _table) THEN
    RAISE EXCEPTION 'جدول غير معروف: %', _table;
  END IF;
  IF _hex IS NULL OR _hex !~ '^[0-9a-f]$' THEN RAISE EXCEPTION 'جزء غير صالح: %', _hex; END IF;
  IF _limit IS NULL OR _limit < 1 OR _limit > 5000 THEN RAISE EXCEPTION 'حد غير صالح'; END IF;

  cond := public.backup_tenant_filter(_table, 'x', 0);
  IF cond = 'false' THEN cond := 'true'; END IF;   -- same rule as backup_fetch_page

  v_lo := (_hex || '0000000-0000-0000-0000-000000000000')::uuid;
  v_next := substr('0123456789abcdef', position(_hex in '0123456789abcdef') + 1, 1);
  v_hi := CASE WHEN v_next = '' THEN NULL ELSE (v_next || '0000000-0000-0000-0000-000000000000')::uuid END;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(s.r) ORDER BY (s.r).id), ''[]''::jsonb)
       FROM (SELECT x AS r FROM public.%I x
              WHERE %s AND x.id >= $2 AND ($3 IS NULL OR x.id < $3) AND ($4 IS NULL OR x.id > $4)
              ORDER BY x.id LIMIT %s) s',
    _table, cond, _limit
  ) INTO res USING _tenant, v_lo, v_hi, _after;
  RETURN COALESCE(res, '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.backup_part_list() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backup_fetch_range(text, uuid, text, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backup_part_list() TO service_role;
GRANT EXECUTE ON FUNCTION public.backup_fetch_range(text, uuid, text, uuid, int) TO service_role;

CREATE OR REPLACE FUNCTION public.nizam_backup_start()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t record; v_run uuid; n int := 0;
BEGIN
  FOR t IN SELECT id FROM public.tenants WHERE coalesce(is_suspended, false) = false LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.backup_cron_runs WHERE tenant_id = t.id AND status IN ('running','finalizing'));
    INSERT INTO public.backup_cron_runs(tenant_id) VALUES (t.id) RETURNING id INTO v_run;
    INSERT INTO public.backup_cron_parts(run_id, table_name, ord)
    SELECT v_run, p.table_name, p.ord FROM public.backup_part_list() p;
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;

DO $check$
BEGIN
  IF (SELECT count(*) FROM public.backup_part_list() WHERE table_name LIKE 'journal_entry_lines#%') <> 16 THEN
    RAISE EXCEPTION '0104: journal_entry_lines should be in 16 parts';
  END IF;
  IF EXISTS (SELECT 1 FROM public.security_exposed_definer_functions()) THEN
    RAISE EXCEPTION '0104: a definer function is exposed to the browser';
  END IF;
END $check$;
