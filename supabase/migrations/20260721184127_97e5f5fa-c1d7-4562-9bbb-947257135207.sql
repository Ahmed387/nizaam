DROP POLICY IF EXISTS "record-attachments read" ON storage.objects;
DROP POLICY IF EXISTS "voucher-attachments read" ON storage.objects;

CREATE POLICY "record-attachments read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'record-attachments'
  AND EXISTS (
    SELECT 1 FROM public.attachments a
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE a.file_path = storage.objects.name
      AND a.tenant_id = p.tenant_id
  )
);

CREATE POLICY "voucher-attachments read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'voucher-attachments'
  AND EXISTS (
    SELECT 1 FROM public.voucher_attachments va
    JOIN public.vouchers v ON v.id = va.voucher_id
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE va.file_path = storage.objects.name
      AND v.tenant_id = p.tenant_id
  )
);