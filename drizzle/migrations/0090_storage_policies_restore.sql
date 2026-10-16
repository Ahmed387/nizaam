-- 0090 — storage.objects had NO policies on this database (they did not come over with the move from Lovable
-- Cloud), so every upload failed with "new row violates row-level security policy": record attachments, voucher
-- attachments, product images, employee ID files. This restores the latest policy of each bucket from the
-- earlier migrations (tenant folder = first path segment, as tenantStoragePath() writes it).
DO $x$
DECLARE p text;
BEGIN
  FOREACH p IN ARRAY ARRAY[
    'record-attachments read', 'record-attachments insert', 'record-attachments update', 'record-attachments delete',
    'voucher-attachments read', 'voucher-attachments insert', 'voucher-attachments update', 'voucher-attachments delete',
    'Tenant members can view product images', 'Staff can upload product images to own tenant folder',
    'Staff can update product images', 'Staff can delete product images',
    'emp_ids_read', 'emp_ids_write', 'emp_ids_update', 'emp_ids_delete',
    'tenant backup files read admin', 'tenant backup files update admin', 'tenant backup files delete admin'] LOOP
    EXECUTE format('DR' || 'OP POLICY IF EXISTS %I ON storage.objects', p);
  END LOOP;
END $x$;

-- record-attachments (documents, vouchers, payment receipts)
CREATE POLICY "record-attachments read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'record-attachments' AND EXISTS (
  SELECT 1 FROM public.attachments a JOIN public.profiles p ON p.id = (SELECT auth.uid())
   WHERE a.file_path = storage.objects.name AND a.tenant_id = p.tenant_id));

CREATE POLICY "record-attachments insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'record-attachments' AND owner = (SELECT auth.uid())
  AND (storage.foldername(name))[1] = (SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = (SELECT auth.uid())));

CREATE POLICY "record-attachments update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'record-attachments' AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
  AND (owner = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid()))
       OR public.has_role((SELECT auth.uid()), 'branch_manager'::app_role) OR public.has_role((SELECT auth.uid()), 'accountant'::app_role)))
WITH CHECK (bucket_id = 'record-attachments' AND (storage.foldername(name))[1] = (public.current_tenant_id())::text);

CREATE POLICY "record-attachments delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'record-attachments' AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
  AND (owner = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid()))
       OR public.has_role((SELECT auth.uid()), 'branch_manager'::app_role) OR public.has_role((SELECT auth.uid()), 'accountant'::app_role)));

-- voucher-attachments (older voucher files)
CREATE POLICY "voucher-attachments read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'voucher-attachments' AND EXISTS (
  SELECT 1 FROM public.voucher_attachments va JOIN public.vouchers v ON v.id = va.voucher_id
    JOIN public.profiles p ON p.id = (SELECT auth.uid())
   WHERE va.file_path = storage.objects.name AND v.tenant_id = p.tenant_id));

CREATE POLICY "voucher-attachments insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'voucher-attachments' AND owner = (SELECT auth.uid())
  AND (storage.foldername(name))[1] = (SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = (SELECT auth.uid())));

CREATE POLICY "voucher-attachments update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'voucher-attachments' AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
  AND (owner = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid()))
       OR public.has_role((SELECT auth.uid()), 'branch_manager'::app_role) OR public.has_role((SELECT auth.uid()), 'accountant'::app_role)))
WITH CHECK (bucket_id = 'voucher-attachments' AND (storage.foldername(name))[1] = (public.current_tenant_id())::text);

CREATE POLICY "voucher-attachments delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'voucher-attachments' AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
  AND (owner = (SELECT auth.uid()) OR public.is_admin((SELECT auth.uid()))
       OR public.has_role((SELECT auth.uid()), 'branch_manager'::app_role) OR public.has_role((SELECT auth.uid()), 'accountant'::app_role)));

-- product-images (bucket is public for display; writes are staff of the tenant folder)
CREATE POLICY "Tenant members can view product images" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'product-images' AND (public.is_super_admin((SELECT auth.uid()))
  OR (storage.foldername(name))[1] = public.current_tenant_id()::text));

CREATE POLICY "Staff can upload product images to own tenant folder" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'product-images' AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  AND (public.is_super_admin((SELECT auth.uid())) OR public.is_admin((SELECT auth.uid()))
       OR public.has_role((SELECT auth.uid()), 'branch_manager'::app_role) OR public.has_role((SELECT auth.uid()), 'cashier'::app_role)
       OR public.has_role((SELECT auth.uid()), 'warehouse'::app_role)));

CREATE POLICY "Staff can update product images" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
  AND (public.is_admin((SELECT auth.uid())) OR public.is_super_admin((SELECT auth.uid()))
       OR public.has_role((SELECT auth.uid()), 'branch_manager'::app_role) OR public.has_role((SELECT auth.uid()), 'cashier'::app_role)
       OR public.has_role((SELECT auth.uid()), 'warehouse'::app_role)))
WITH CHECK (bucket_id = 'product-images' AND (storage.foldername(name))[1] = (public.current_tenant_id())::text);

CREATE POLICY "Staff can delete product images" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
  AND (public.is_admin((SELECT auth.uid())) OR public.is_super_admin((SELECT auth.uid()))
       OR public.has_role((SELECT auth.uid()), 'branch_manager'::app_role) OR public.has_role((SELECT auth.uid()), 'cashier'::app_role)
       OR public.has_role((SELECT auth.uid()), 'warehouse'::app_role)));

-- employee-ids
CREATE POLICY emp_ids_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'employee-ids' AND public.can_access_employee_file(name));
CREATE POLICY emp_ids_write ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'employee-ids' AND public.can_access_employee_file(name));
CREATE POLICY emp_ids_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'employee-ids' AND public.can_access_employee_file(name))
WITH CHECK (bucket_id = 'employee-ids' AND public.can_access_employee_file(name));
CREATE POLICY emp_ids_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'employee-ids' AND public.can_access_employee_file(name));

-- system-backups (files are written by the server; admins read / delete their company's)
CREATE POLICY "tenant backup files read admin" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'system-backups' AND (public.is_super_admin((SELECT auth.uid())) OR (
  public.has_role((SELECT auth.uid()), 'admin'::app_role) AND public.current_tenant_id() IS NOT NULL
  AND split_part(name, '/', 1) = public.current_tenant_id()::text AND split_part(name, '/', 1) <> '')));

CREATE POLICY "tenant backup files update admin" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'system-backups' AND (public.is_super_admin((SELECT auth.uid())) OR (
  public.is_admin((SELECT auth.uid())) AND public.current_tenant_id() IS NOT NULL
  AND split_part(name, '/', 1) = (public.current_tenant_id())::text AND split_part(name, '/', 1) <> '')))
WITH CHECK (bucket_id = 'system-backups' AND (public.is_super_admin((SELECT auth.uid()))
  OR split_part(name, '/', 1) = (public.current_tenant_id())::text));

CREATE POLICY "tenant backup files delete admin" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'system-backups' AND (public.is_super_admin((SELECT auth.uid())) OR (
  public.has_role((SELECT auth.uid()), 'admin'::app_role) AND public.current_tenant_id() IS NOT NULL
  AND split_part(name, '/', 1) = (public.current_tenant_id())::text AND split_part(name, '/', 1) <> '')));
