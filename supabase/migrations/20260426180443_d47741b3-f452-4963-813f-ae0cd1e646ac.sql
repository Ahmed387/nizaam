-- Extend price_list to act as the official supplier price list
ALTER TABLE public.price_list
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS category_name text,
  ADD COLUMN IF NOT EXISTS old_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description text;

CREATE INDEX IF NOT EXISTS idx_price_list_tenant_sku ON public.price_list(tenant_id, sku);

-- Add old_price on products so cashier can see previous price vs current
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS old_price numeric NOT NULL DEFAULT 0;