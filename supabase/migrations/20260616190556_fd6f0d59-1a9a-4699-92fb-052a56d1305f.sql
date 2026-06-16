
-- Polymorphic attachments table
CREATE TABLE IF NOT EXISTS public.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  record_type text NOT NULL CHECK (record_type IN (
    'voucher','invoice','shipment','sale_return','purchase_return','stock_transfer','inventory_adjustment'
  )),
  record_id uuid NOT NULL,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_type text,
  file_size bigint,
  original_size bigint,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_record ON public.attachments(record_type, record_id);
CREATE INDEX IF NOT EXISTS idx_attachments_tenant ON public.attachments(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attachments TO authenticated;
GRANT ALL ON public.attachments TO service_role;

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

-- Auto-set tenant_id from uploader's profile
CREATE OR REPLACE FUNCTION public.attachments_set_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM public.profiles WHERE id = auth.uid();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_attachments_set_tenant ON public.attachments;
CREATE TRIGGER trg_attachments_set_tenant BEFORE INSERT ON public.attachments
FOR EACH ROW EXECUTE FUNCTION public.attachments_set_tenant();

-- Read: same tenant
CREATE POLICY "att_read" ON public.attachments FOR SELECT TO authenticated
USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Insert: uploader is self, tenant matches (or null → trigger fills it)
CREATE POLICY "att_insert" ON public.attachments FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND (tenant_id IS NULL OR tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
);

-- Delete: uploader OR admin/branch_manager/accountant in same tenant
CREATE POLICY "att_delete" ON public.attachments FOR DELETE TO authenticated
USING (
  tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  AND (
    uploaded_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'branch_manager'::app_role)
    OR public.has_role(auth.uid(), 'accountant'::app_role)
  )
);

-- Realtime
ALTER TABLE public.attachments REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.attachments; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- Storage policies for the new bucket
CREATE POLICY "record-attachments read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'record-attachments');

CREATE POLICY "record-attachments insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'record-attachments' AND owner = auth.uid());

CREATE POLICY "record-attachments delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'record-attachments' AND (
  owner = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'branch_manager'::app_role)
  OR public.has_role(auth.uid(), 'accountant'::app_role)
));
