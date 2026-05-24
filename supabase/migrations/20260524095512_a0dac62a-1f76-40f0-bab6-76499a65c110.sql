-- 1) Add new roles to enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'supervisor';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'worker';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'driver';

-- 2) Role permissions table
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  role text NOT NULL,
  permission_key text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, role, permission_key)
);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY rp_read ON public.role_permissions FOR SELECT
USING (tenant_id = current_tenant_id() OR is_super_admin(auth.uid()));

CREATE POLICY rp_write ON public.role_permissions FOR ALL
USING (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())))
WITH CHECK (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())));

CREATE INDEX IF NOT EXISTS idx_role_permissions_lookup ON public.role_permissions(tenant_id, role, permission_key);

-- 3) has_permission helper (admin/super always true)
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    is_super_admin(_user_id)
    OR is_admin(_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
      JOIN public.role_permissions rp
        ON rp.tenant_id = p.tenant_id
       AND rp.role = ur.role::text
       AND rp.permission_key = _key
      WHERE ur.user_id = _user_id AND rp.allowed = true
    );
$$;