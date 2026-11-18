-- 0258 (owner 2026-11-18, unified filter «المستلم / البائع … شاشة منسدلة بها الكاشير وغيره من اليوزرات التى بإمكانها عمل الفواتير»):
-- branch_doc_users(branch) → the active users of the company who can make sale or purchase invoices in that branch
-- (perm_resolve sales.create / shipments.create there, and in the branch or the owner / a manager), name as written on
-- documents. Read only; any user who can read the branch may call it (assert_read_access). The till filter matches these
-- ids against treasury.created_by; document screens match the name against received_by.
CREATE OR REPLACE FUNCTION public.branch_doc_users(p_branch uuid)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid;
BEGIN
  PERFORM public.assert_read_access(p_branch, NULL);
  SELECT b.tenant_id INTO v_t FROM public.branches b WHERE b.id = p_branch;
  RETURN QUERY
  SELECT p.id, coalesce(nullif(trim(p.name), ''), p.username)::text
    FROM public.profiles p
   WHERE p.tenant_id = v_t AND coalesce(p.is_active, true)
     AND (public.user_in_branch(p.id, p_branch) OR public.is_owner(p.id) OR public.is_admin(p.id))
     AND (public.perm_resolve(p.id, 'sales.create', p_branch) OR public.perm_resolve(p.id, 'shipments.create', p_branch))
   ORDER BY 2;
END $$;
REVOKE ALL ON FUNCTION public.branch_doc_users(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.branch_doc_users(uuid) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
VALUES ('branch_doc_users', '0258', 'unified filter: users who make documents in a branch') ON CONFLICT DO NOTHING;
