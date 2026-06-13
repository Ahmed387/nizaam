REVOKE ALL ON FUNCTION public.admin_reset_branch_data(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reset_branch_data(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_branch_data(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_branch_data(uuid, jsonb) TO service_role;