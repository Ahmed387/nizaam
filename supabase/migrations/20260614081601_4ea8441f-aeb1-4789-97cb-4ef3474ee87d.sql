
-- 1) Allow admins to DELETE from audit logs (admin / super_admin only, scoped to their tenant)
CREATE POLICY "admin delete audit_log"
ON public.audit_log
FOR DELETE
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (public.has_role(auth.uid(), 'admin'::app_role) AND tenant_id = public.current_tenant_id())
);

CREATE POLICY "admin delete price_audit_log"
ON public.price_audit_log
FOR DELETE
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (public.has_role(auth.uid(), 'admin'::app_role) AND (tenant_id IS NULL OR tenant_id = public.current_tenant_id()))
);

-- Ensure DELETE privilege is granted (RLS still enforces who)
GRANT DELETE ON public.audit_log TO authenticated;
GRANT DELETE ON public.price_audit_log TO authenticated;

-- 2) Add price_audit_log support to admin_reset_branch_data (additive — re-create wrapping logic via small helper to avoid full re-create).
-- Simpler approach: create a sibling RPC that wipes price_audit_log scoped to tenant/branch.
CREATE OR REPLACE FUNCTION public.admin_reset_price_audit(p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_n int := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF NOT (public.has_role(v_user, 'admin'::app_role) OR public.is_super_admin(v_user)) THEN
    RAISE EXCEPTION 'هذا الإجراء متاح للمدير العام فقط';
  END IF;
  v_tenant := public.current_tenant_id();

  IF p_branch_id IS NULL THEN
    DELETE FROM public.price_audit_log
    WHERE tenant_id = v_tenant OR tenant_id IS NULL;
  ELSE
    DELETE FROM public.price_audit_log
    WHERE (tenant_id = v_tenant OR tenant_id IS NULL) AND branch_id = p_branch_id;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('price_audit_deleted', v_n);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reset_price_audit(uuid) TO authenticated;
