CREATE POLICY "backups_delete_admin" ON public.system_backups
FOR DELETE TO authenticated
USING (
  is_super_admin(auth.uid())
  OR (has_role(auth.uid(), 'admin'::app_role) AND tenant_id = current_tenant_id())
);

CREATE POLICY "tenant backup files delete admin" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'system-backups' AND (
    is_super_admin(auth.uid())
    OR (
      has_role(auth.uid(), 'admin'::app_role)
      AND current_tenant_id() IS NOT NULL
      AND split_part(name, '/', 1) = (current_tenant_id())::text
      AND split_part(name, '/', 1) <> ''
    )
  )
);