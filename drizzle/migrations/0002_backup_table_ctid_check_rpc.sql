-- دالة مساعدة تُستدعى مرة واحدة لكل جدول لتحديد ما إذا كان يحمل العمود النظامي ctid
-- تُستخدم في scheduled-backup لتجنب فحص pg_attribute في كل صفحة.
CREATE OR REPLACE FUNCTION public.backup_table_ctid_check(_tables text[])
RETURNS TABLE(table_name text, has_ctid boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.relname::text AS table_name,
    EXISTS (
      SELECT 1
      FROM pg_attribute a
      WHERE a.attrelid = c.oid
        AND a.attname = 'ctid'
        AND a.attisdropped = false
    ) AS has_ctid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname = ANY(_tables)
  ORDER BY array_position(_tables, c.relname::text);
$$;

REVOKE ALL ON FUNCTION public.backup_table_ctid_check(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backup_table_ctid_check(text[]) TO service_role;
