DROP POLICY IF EXISTS presence_read_admin_supervisor ON public.user_presence;
CREATE POLICY presence_read_admin_supervisor ON public.user_presence
FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id()
    AND (
      is_admin(auth.uid())
      OR has_role(auth.uid(), 'supervisor'::app_role)
      OR has_role(auth.uid(), 'viewer'::app_role)
    )
  )
);