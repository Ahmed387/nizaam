CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin(_user_id)
    OR public.is_admin(_user_id)
    OR COALESCE(
      (
        SELECT up.allowed
        FROM public.user_permissions up
        JOIN public.profiles p
          ON p.id = up.user_id
         AND p.tenant_id = up.tenant_id
        WHERE up.user_id = _user_id
          AND up.permission_key = _key
        LIMIT 1
      ),
      (
        SELECT bool_or(rp.allowed)
        FROM public.user_roles ur
        JOIN public.profiles p ON p.id = ur.user_id
        JOIN public.role_permissions rp
          ON rp.tenant_id = p.tenant_id
         AND rp.role = ur.role::text
         AND rp.permission_key = _key
        WHERE ur.user_id = _user_id
      ),
      false
    );
$$;