
-- 1) Backfill: give every existing tenant owner the 'owner' role
INSERT INTO public.user_roles (user_id, role, tenant_id)
SELECT t.owner_user_id, 'owner'::app_role, t.id
FROM public.tenants t
WHERE t.owner_user_id IS NOT NULL
ON CONFLICT (user_id, role) DO NOTHING;

-- 2) Overload: is_owner(uuid) — role-based, no tenant param needed
CREATE OR REPLACE FUNCTION public.is_owner(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'owner'::app_role)
$$;

-- 3) Sync trigger: keep user_roles.owner in sync with tenants.owner_user_id
CREATE OR REPLACE FUNCTION public.sync_tenant_owner_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Remove old owner role if owner changed
  IF TG_OP = 'UPDATE' AND OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id AND OLD.owner_user_id IS NOT NULL THEN
    DELETE FROM public.user_roles
    WHERE user_id = OLD.owner_user_id
      AND role = 'owner'::app_role
      AND tenant_id = OLD.id;
  END IF;

  -- Add owner role for new/current owner
  IF NEW.owner_user_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (NEW.owner_user_id, 'owner'::app_role, NEW.id)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_tenant_owner_role ON public.tenants;
CREATE TRIGGER trg_sync_tenant_owner_role
AFTER INSERT OR UPDATE OF owner_user_id ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_owner_role();
