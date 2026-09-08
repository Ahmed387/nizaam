
-- 1) close cross-tenant read hole on product images
DROP POLICY IF EXISTS "Product images are publicly viewable" ON storage.objects;

-- 2) owner immunity on product images (is_admin covers admin/super_admin/owner)
DROP POLICY IF EXISTS "Staff can update product images" ON storage.objects;
CREATE POLICY "Staff can update product images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
  AND (
    public.is_admin(auth.uid())
    OR public.is_super_admin(auth.uid())
    OR public.has_role(auth.uid(), 'branch_manager'::app_role)
    OR public.has_role(auth.uid(), 'cashier'::app_role)
    OR public.has_role(auth.uid(), 'warehouse'::app_role)
  )
)
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
);

DROP POLICY IF EXISTS "Staff can delete product images" ON storage.objects;
CREATE POLICY "Staff can delete product images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
  AND (
    public.is_admin(auth.uid())
    OR public.is_super_admin(auth.uid())
    OR public.has_role(auth.uid(), 'branch_manager'::app_role)
    OR public.has_role(auth.uid(), 'cashier'::app_role)
    OR public.has_role(auth.uid(), 'warehouse'::app_role)
  )
);

-- 3) missing UPDATE (replace same path) policies, tenant-scoped
DROP POLICY IF EXISTS "record-attachments update" ON storage.objects;
CREATE POLICY "record-attachments update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'record-attachments'
  AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
  AND (
    owner = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'branch_manager'::app_role)
    OR public.has_role(auth.uid(), 'accountant'::app_role)
  )
)
WITH CHECK (
  bucket_id = 'record-attachments'
  AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
);

DROP POLICY IF EXISTS "voucher-attachments update" ON storage.objects;
CREATE POLICY "voucher-attachments update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'voucher-attachments'
  AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
  AND (
    owner = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'branch_manager'::app_role)
    OR public.has_role(auth.uid(), 'accountant'::app_role)
  )
)
WITH CHECK (
  bucket_id = 'voucher-attachments'
  AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
);

DROP POLICY IF EXISTS "tenant backup files update admin" ON storage.objects;
CREATE POLICY "tenant backup files update admin"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'system-backups'
  AND (
    public.is_super_admin(auth.uid())
    OR (
      public.is_admin(auth.uid())
      AND public.current_tenant_id() IS NOT NULL
      AND split_part(name, '/', 1) = (public.current_tenant_id())::text
      AND split_part(name, '/', 1) <> ''
    )
  )
)
WITH CHECK (
  bucket_id = 'system-backups'
  AND (
    public.is_super_admin(auth.uid())
    OR split_part(name, '/', 1) = (public.current_tenant_id())::text
  )
);
