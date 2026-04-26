-- Allow same SKU to exist in multiple branches within the same tenant
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_tenant_sku_uniq;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_branch_sku_uniq
  ON public.products(tenant_id, branch_id, sku);