-- Drop existing UPDATE/DELETE policies that lack tenant isolation
DROP POLICY IF EXISTS "Staff can update product images" ON storage.objects;
DROP POLICY IF EXISTS "Staff can delete product images" ON storage.objects;

-- Recreate with tenant folder check (matches INSERT policy)
CREATE POLICY "Staff can update product images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'cashier'::public.app_role)
    OR public.has_role(auth.uid(), 'warehouse'::public.app_role)
  )
)
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);

CREATE POLICY "Staff can delete product images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'cashier'::public.app_role)
    OR public.has_role(auth.uid(), 'warehouse'::public.app_role)
  )
);