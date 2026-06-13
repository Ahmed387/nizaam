
CREATE TABLE IF NOT EXISTS public.system_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  filename text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  table_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'success',
  error text,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_backups TO authenticated;
GRANT ALL ON public.system_backups TO service_role;

ALTER TABLE public.system_backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backups_read_admin" ON public.system_backups
  FOR SELECT TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.is_super_admin(auth.uid()))
  );

CREATE INDEX IF NOT EXISTS idx_system_backups_tenant_created ON public.system_backups(tenant_id, created_at DESC);
