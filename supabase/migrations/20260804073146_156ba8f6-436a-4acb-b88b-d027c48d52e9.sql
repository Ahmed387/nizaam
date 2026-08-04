ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS legacy_number text, ADD COLUMN IF NOT EXISTS migration_batch_id uuid;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS legacy_number text, ADD COLUMN IF NOT EXISTS migration_batch_id uuid;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS legacy_number text, ADD COLUMN IF NOT EXISTS migration_batch_id uuid;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS legacy_number text, ADD COLUMN IF NOT EXISTS migration_batch_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_legacy_number_branch_uidx ON public.invoices (branch_id, legacy_number) WHERE legacy_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shipments_legacy_number_branch_uidx ON public.shipments (branch_id, legacy_number) WHERE legacy_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS returns_legacy_number_branch_uidx ON public.returns (branch_id, legacy_number) WHERE legacy_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_returns_legacy_number_branch_uidx ON public.purchase_returns (branch_id, legacy_number) WHERE legacy_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_migration_batch_idx ON public.invoices (migration_batch_id) WHERE migration_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS shipments_migration_batch_idx ON public.shipments (migration_batch_id) WHERE migration_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS returns_migration_batch_idx ON public.returns (migration_batch_id) WHERE migration_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_returns_migration_batch_idx ON public.purchase_returns (migration_batch_id) WHERE migration_batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.migration_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  kind text NOT NULL,
  label text NOT NULL,
  file_name text,
  docs_total integer NOT NULL DEFAULT 0,
  docs_ok integer NOT NULL DEFAULT 0,
  docs_failed integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.migration_batches TO authenticated;
GRANT ALL ON public.migration_batches TO service_role;

ALTER TABLE public.migration_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "migration_batches_admin_all" ON public.migration_batches
  FOR ALL TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'super_admin'))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'super_admin'))
  );

CREATE OR REPLACE FUNCTION public.touch_migration_batches_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER update_migration_batches_updated_at
  BEFORE UPDATE ON public.migration_batches
  FOR EACH ROW EXECUTE FUNCTION public.touch_migration_batches_updated_at();