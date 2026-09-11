-- إصلاح خطأ العمود المفقود ctid وتعزيز ثبات استعلامات النسخ الاحتياطي
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
  has_ctid boolean;
  order_by text;
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

  -- بعض الجداول (مثل الـ foreign tables أو الـ views) لا تحمل ctid، لذا نتحقق ونرجع للترتيب بالعمود الأول
  SELECT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = _table AND a.attname = 'ctid' AND a.attisdropped = false
  ) INTO has_ctid;

  order_by := CASE WHEN has_ctid THEN 'x.ctid' ELSE '1' END;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(s.r)), ''[]''::jsonb)
       FROM (SELECT x AS r FROM public.%I x WHERE %s ORDER BY %s OFFSET %s LIMIT %s) s',
    _table, cond, order_by, _offset, _limit
  ) INTO res USING _tenant;

  RETURN COALESCE(res, '[]'::jsonb);
END;
$fn$;

REVOKE ALL ON FUNCTION public.backup_fetch_page(text, uuid, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backup_fetch_page(text, uuid, int, int) TO service_role;
