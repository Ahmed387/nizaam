ALTER TABLE public.products  ADD COLUMN IF NOT EXISTS is_migrated boolean NOT NULL DEFAULT false;
ALTER TABLE public.contacts  ADD COLUMN IF NOT EXISTS is_migrated boolean NOT NULL DEFAULT false;
ALTER TABLE public.invoices  ADD COLUMN IF NOT EXISTS is_migrated boolean NOT NULL DEFAULT false;
ALTER TABLE public.invoices  ADD COLUMN IF NOT EXISTS migration_source text;
CREATE INDEX IF NOT EXISTS idx_invoices_is_migrated ON public.invoices(is_migrated) WHERE is_migrated = true;
CREATE INDEX IF NOT EXISTS idx_products_is_migrated ON public.products(is_migrated) WHERE is_migrated = true;