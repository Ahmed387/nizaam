GRANT EXECUTE ON FUNCTION public.backup_table_manifest() TO service_role;
GRANT EXECUTE ON FUNCTION public.backup_fetch_page(text, uuid, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.backup_tenant_filter(text, text, int) TO service_role;