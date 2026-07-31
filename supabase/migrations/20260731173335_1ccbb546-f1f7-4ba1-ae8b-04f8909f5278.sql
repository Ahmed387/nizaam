DROP POLICY IF EXISTS "Public can view product images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view product images" ON storage.objects;
DROP POLICY IF EXISTS "Public read product images" ON storage.objects;

CREATE POLICY "Tenant members can view product images"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (
    public.is_super_admin(auth.uid())
    OR (storage.foldername(name))[1] = public.current_tenant_id()::text
  )
);