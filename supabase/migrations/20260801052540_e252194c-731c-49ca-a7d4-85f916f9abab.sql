-- 1) products: brand + model
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS model text;

-- 2) document tables that snapshot product attributes
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS model text;

ALTER TABLE public.shipment_items ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE public.shipment_items ADD COLUMN IF NOT EXISTS model text;

ALTER TABLE public.return_items ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE public.return_items ADD COLUMN IF NOT EXISTS model text;

ALTER TABLE public.purchase_return_items ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE public.purchase_return_items ADD COLUMN IF NOT EXISTS model text;

ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE public.quote_items ADD COLUMN IF NOT EXISTS model text;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS model text;

ALTER TABLE public.stock_adjustment_items ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE public.stock_adjustment_items ADD COLUMN IF NOT EXISTS model text;

ALTER TABLE public.inventory_session_items ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE public.inventory_session_items ADD COLUMN IF NOT EXISTS model text;

ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE public.inventory_reservations ADD COLUMN IF NOT EXISTS model text;

ALTER TABLE public.pre_orders ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE public.pre_orders ADD COLUMN IF NOT EXISTS model text;

-- 3) extend the central snapshot trigger to carry brand + model
CREATE OR REPLACE FUNCTION public.set_item_color_from_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p_color text; p_type text; p_capacity text; p_size text; p_brand text; p_model text;
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    SELECT color, product_type, capacity, size, brand, model
      INTO p_color, p_type, p_capacity, p_size, p_brand, p_model
      FROM public.products WHERE id = NEW.product_id;
    IF NEW.color IS NULL THEN NEW.color := p_color; END IF;
    IF NEW.product_type IS NULL THEN NEW.product_type := p_type; END IF;
    IF NEW.capacity IS NULL THEN NEW.capacity := p_capacity; END IF;
    IF NEW.size IS NULL THEN NEW.size := p_size; END IF;
    IF NEW.brand IS NULL THEN NEW.brand := p_brand; END IF;
    IF NEW.model IS NULL THEN NEW.model := p_model; END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 4) brands reference table (mirrors colors/capacities/sizes pattern)
CREATE TABLE IF NOT EXISTS public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated;
GRANT ALL ON public.brands TO service_role;

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brands_select_tenant" ON public.brands;
CREATE POLICY "brands_select_tenant" ON public.brands
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "brands_write_tenant" ON public.brands;
CREATE POLICY "brands_write_tenant" ON public.brands
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE UNIQUE INDEX IF NOT EXISTS brands_tenant_name_uniq ON public.brands (tenant_id, lower(name));

-- 5) search indexes
CREATE INDEX IF NOT EXISTS idx_products_brand ON public.products (tenant_id, brand) WHERE brand IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_model ON public.products (tenant_id, model) WHERE model IS NOT NULL;