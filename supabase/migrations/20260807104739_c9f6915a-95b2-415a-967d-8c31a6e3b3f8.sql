CREATE OR REPLACE FUNCTION public.guard_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_tenant uuid;
  v_caller uuid := auth.uid();
BEGIN
  IF NEW.role = 'super_admin'::app_role THEN
    -- Only an existing super_admin, or a direct DB session (migrations run by
    -- the database owner), may grant platform-level access. PostgREST and
    -- service-role edge functions both run under the "authenticator" login,
    -- so they are rejected here.
    IF NOT (
      public.is_super_admin(v_caller)
      OR (v_caller IS NULL AND session_user IN ('postgres', 'supabase_admin'))
    ) THEN
      RAISE EXCEPTION 'ممنوع: دور "سوبر أدمن" لا يمكن منحه من التطبيق'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT tenant_id INTO v_target_tenant FROM public.profiles WHERE id = NEW.user_id;
  IF v_target_tenant IS NOT NULL AND NEW.tenant_id IS NOT NULL
     AND v_target_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'ممنوع: لا يمكن منح دور لمستخدم في شركة أخرى' USING ERRCODE = '42501';
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := v_target_tenant;
  END IF;

  RETURN NEW;
END;
$$;

-- Remove the super_admin row created during the penetration test.
DELETE FROM public.user_roles WHERE id = '986507b5-b56a-45c2-a4ad-da6b2acd8a15';