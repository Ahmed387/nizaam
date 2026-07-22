DROP POLICY IF EXISTS audit_insert_any ON public.audit_log;

CREATE POLICY audit_insert_authenticated ON public.audit_log
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (user_id IS NULL OR user_id = auth.uid())
  AND (tenant_id IS NULL OR tenant_id = public.current_tenant_id())
);