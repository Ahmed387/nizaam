
-- 1) Allow admins to DELETE vouchers (scoped to tenant)
CREATE POLICY "admin delete vouchers"
ON public.vouchers
FOR DELETE
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (public.has_role(auth.uid(), 'admin'::app_role) AND tenant_id = public.current_tenant_id())
);

GRANT DELETE ON public.vouchers TO authenticated;

-- 2) RPC to delete a single voucher (admin only). Cancels first to reverse treasury impact, then deletes.
CREATE OR REPLACE FUNCTION public.delete_voucher_admin(p_voucher_id uuid, p_reason text DEFAULT 'حذف بواسطة المدير')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_voucher record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;
  IF NOT (public.has_role(v_user, 'admin'::app_role) OR public.is_super_admin(v_user)) THEN
    RAISE EXCEPTION 'هذا الإجراء متاح للمدير العام فقط';
  END IF;

  v_tenant := public.current_tenant_id();

  SELECT * INTO v_voucher FROM public.vouchers WHERE id = p_voucher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'السند غير موجود';
  END IF;
  IF v_voucher.tenant_id IS DISTINCT FROM v_tenant AND NOT public.is_super_admin(v_user) THEN
    RAISE EXCEPTION 'السند ليس ضمن شركتك';
  END IF;

  -- If active, cancel first to reverse treasury / linked side-effects
  IF v_voucher.status = 'active' THEN
    BEGIN
      PERFORM public.cancel_voucher(p_voucher_id, COALESCE(NULLIF(trim(p_reason), ''), 'حذف بواسطة المدير'));
    EXCEPTION WHEN OTHERS THEN
      -- ignore cancel errors and just delete (admin override)
      NULL;
    END;
  END IF;

  DELETE FROM public.vouchers WHERE id = p_voucher_id;

  INSERT INTO public.audit_log (tenant_id, user_id, user_name, branch_id, action, entity, entity_id, details)
  VALUES (v_tenant, v_user, COALESCE((SELECT name FROM public.profiles WHERE id = v_user), 'النظام'),
          v_voucher.branch_id, 'DELETE', 'Voucher', p_voucher_id,
          jsonb_build_object('voucher_number', v_voucher.voucher_number, 'reason', p_reason));

  RETURN jsonb_build_object('deleted', true, 'voucher_number', v_voucher.voucher_number);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_voucher_admin(uuid, text) TO authenticated;

-- 3) Bulk reset RPC for vouchers (used by admin Settings مسح البيانات)
CREATE OR REPLACE FUNCTION public.admin_reset_vouchers(p_branch_id uuid DEFAULT NULL)
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
    DELETE FROM public.vouchers WHERE tenant_id = v_tenant;
  ELSE
    DELETE FROM public.vouchers WHERE tenant_id = v_tenant AND branch_id = p_branch_id;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO public.audit_log (tenant_id, user_id, user_name, branch_id, action, entity, entity_id, details)
  VALUES (v_tenant, v_user, COALESCE((SELECT name FROM public.profiles WHERE id = v_user), 'النظام'),
          p_branch_id, 'RESET', 'Vouchers', COALESCE(p_branch_id, v_tenant),
          jsonb_build_object('deleted_count', v_n));

  RETURN jsonb_build_object('vouchers_deleted', v_n);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reset_vouchers(uuid) TO authenticated;
