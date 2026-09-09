
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
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'المستأجر مطلوب';
  END IF;
  IF data = '{}'::jsonb THEN
    RAISE EXCEPTION 'ملف النسخة الاحتياطية فارغ';
  END IF;

  -- تعطيل التريجرات داخل المعاملة الحالية فقط
  PERFORM set_config('session_replication_role', 'replica', true);

  -- 1) حذف بيانات المستأجر بالترتيب العكسي للاعتماديات
  FOR m IN SELECT * FROM public.backup_table_manifest() ORDER BY ord DESC LOOP
    CONTINUE WHEN m.table_name = ANY(skip_tables);
    CONTINUE WHEN NOT m.tenant_scoped;
    CONTINUE WHEN NOT (data ? m.table_name);
    cond := m.filter_sql;
    EXECUTE format('DELETE FROM public.%I x WHERE %s', m.table_name, cond) USING _tenant;
  END LOOP;

  -- 2) إعادة الإدخال بالترتيب الهرمي
  FOR m IN SELECT * FROM public.backup_table_manifest() ORDER BY ord ASC LOOP
    CONTINUE WHEN m.table_name = ANY(skip_tables);
    CONTINUE WHEN NOT m.tenant_scoped;
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
  -- المعاملة كاملة تُلغى تلقائياً (ROLLBACK) ولا تبقى القاعدة فارغة
  PERFORM set_config('session_replication_role', 'origin', true);
  RAISE EXCEPTION 'فشل الاستعادة وتم التراجع بالكامل: %', SQLERRM;
END;
$fn$;

REVOKE ALL ON FUNCTION public.restore_tenant_snapshot(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_tenant_snapshot(uuid, jsonb) TO service_role;
