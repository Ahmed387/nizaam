-- Function: prevent deleting the founder admin (oldest admin role per tenant)
CREATE OR REPLACE FUNCTION public.prevent_founder_admin_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_founder uuid;
BEGIN
  -- Only guard admin roles
  IF OLD.role <> 'admin' THEN
    RETURN OLD;
  END IF;

  -- Super admin can always delete
  IF public.is_super_admin(auth.uid()) THEN
    RETURN OLD;
  END IF;

  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = OLD.user_id;
  IF v_tenant IS NULL THEN
    RETURN OLD;
  END IF;

  -- Founder = oldest admin in this tenant (by profile created_at)
  SELECT ur.user_id INTO v_founder
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.role = 'admin' AND p.tenant_id = v_tenant
  ORDER BY p.created_at ASC
  LIMIT 1;

  IF v_founder = OLD.user_id THEN
    RAISE EXCEPTION 'لا يمكن حذف المدير العام المؤسس للشركة'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_founder_role_delete ON public.user_roles;
CREATE TRIGGER trg_prevent_founder_role_delete
BEFORE DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_founder_admin_delete();

-- Also prevent deleting the founder's profile directly
CREATE OR REPLACE FUNCTION public.prevent_founder_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_founder uuid;
BEGIN
  IF public.is_super_admin(auth.uid()) THEN
    RETURN OLD;
  END IF;
  IF OLD.tenant_id IS NULL THEN
    RETURN OLD;
  END IF;

  SELECT ur.user_id INTO v_founder
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.role = 'admin' AND p.tenant_id = OLD.tenant_id
  ORDER BY p.created_at ASC
  LIMIT 1;

  IF v_founder = OLD.id THEN
    RAISE EXCEPTION 'لا يمكن حذف المدير العام المؤسس للشركة'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_founder_profile_delete ON public.profiles;
CREATE TRIGGER trg_prevent_founder_profile_delete
BEFORE DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_founder_profile_delete();

-- Allow admins to delete profiles within their tenant (except founder, enforced by trigger above)
DROP POLICY IF EXISTS profiles_delete ON public.profiles;
CREATE POLICY profiles_delete ON public.profiles
FOR DELETE
USING (
  public.is_super_admin(auth.uid())
  OR (tenant_id = public.current_tenant_id() AND public.is_admin(auth.uid()))
);

-- Helper RPC: get the founder admin id for current tenant (for UI)
CREATE OR REPLACE FUNCTION public.tenant_founder_admin(_tenant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.user_id
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.role = 'admin' AND p.tenant_id = _tenant_id
  ORDER BY p.created_at ASC
  LIMIT 1
$$;