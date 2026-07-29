ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS setup_completed BOOLEAN NOT NULL DEFAULT false;

-- Existing tenants have branches/CoA → mark them as completed
UPDATE public.tenants t
SET setup_completed = true
WHERE EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id = t.id)
   OR EXISTS (SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id = t.id);