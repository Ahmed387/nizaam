-- Harden system-backups storage read policy: require an explicit tenant match
-- and reject cases where current_tenant_id() is NULL or the folder segment
-- isn't a well-formed uuid matching the caller's tenant.

DROP POLICY IF EXISTS "tenant backup files read admin" ON storage.objects;

CREATE POLICY "tenant backup files read admin"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'system-backups'
  AND (
    public.is_super_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      AND public.current_tenant_id() IS NOT NULL
      AND split_part(name, '/', 1) = public.current_tenant_id()::text
      AND split_part(name, '/', 1) <> ''
    )
  )
);
