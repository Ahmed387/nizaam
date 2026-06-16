
-- Voucher attachments table
CREATE TABLE IF NOT EXISTS public.voucher_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_type text,
  file_size bigint,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voucher_attachments_voucher ON public.voucher_attachments(voucher_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voucher_attachments TO authenticated;
GRANT ALL ON public.voucher_attachments TO service_role;

ALTER TABLE public.voucher_attachments ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user in same tenant as the voucher
CREATE POLICY "read voucher attachments same tenant"
ON public.voucher_attachments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.vouchers v
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE v.id = voucher_attachments.voucher_id
      AND v.tenant_id = p.tenant_id
  )
);

-- Insert: any authenticated user with access to the voucher's branch
CREATE POLICY "insert voucher attachments same tenant"
ON public.voucher_attachments FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid() AND
  EXISTS (
    SELECT 1 FROM public.vouchers v
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE v.id = voucher_attachments.voucher_id
      AND v.tenant_id = p.tenant_id
  )
);

-- Delete: uploader OR admin/manager/accountant in same tenant
CREATE POLICY "delete voucher attachments"
ON public.voucher_attachments FOR DELETE TO authenticated
USING (
  uploaded_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.vouchers v
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE v.id = voucher_attachments.voucher_id
      AND v.tenant_id = p.tenant_id
      AND (
        public.has_role(auth.uid(), 'admin'::app_role)
        OR public.has_role(auth.uid(), 'branch_manager'::app_role)
        OR public.has_role(auth.uid(), 'accountant'::app_role)
      )
  )
);

-- Storage policies for voucher-attachments bucket
CREATE POLICY "voucher-attachments read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'voucher-attachments');

CREATE POLICY "voucher-attachments insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'voucher-attachments' AND owner = auth.uid());

CREATE POLICY "voucher-attachments delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'voucher-attachments' AND (
  owner = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'branch_manager'::app_role)
  OR public.has_role(auth.uid(), 'accountant'::app_role)
));
