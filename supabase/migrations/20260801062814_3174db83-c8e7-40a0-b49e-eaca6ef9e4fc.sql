DROP POLICY IF EXISTS "record-attachments insert" ON storage.objects;
CREATE POLICY "record-attachments insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'record-attachments'
  AND owner = auth.uid()
  AND (storage.foldername(name))[1] = (
    SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
  )
);

DROP POLICY IF EXISTS "voucher-attachments insert" ON storage.objects;
CREATE POLICY "voucher-attachments insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'voucher-attachments'
  AND owner = auth.uid()
  AND (storage.foldername(name))[1] = (
    SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
  )
);