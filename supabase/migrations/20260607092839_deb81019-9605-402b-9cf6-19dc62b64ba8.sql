
-- Remove blanket viewer_read policies that leaked sensitive HR/financial data
DROP POLICY IF EXISTS viewer_read ON public.advance_requests;
DROP POLICY IF EXISTS viewer_read ON public.advances;
DROP POLICY IF EXISTS viewer_read ON public.advance_payments;
DROP POLICY IF EXISTS viewer_read ON public.employees;
DROP POLICY IF EXISTS viewer_read ON public.salaries;

-- Tighten product-images upload policy: staff only + tenant-scoped path
DROP POLICY IF EXISTS "Authenticated can upload product images" ON storage.objects;
CREATE POLICY "Staff can upload product images to own tenant folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  AND (
    public.is_super_admin(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'cashier'::public.app_role)
    OR public.has_role(auth.uid(), 'warehouse'::public.app_role)
  )
);
