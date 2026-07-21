
-- 1) Lookup tables
CREATE TABLE IF NOT EXISTS public.product_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_types TO authenticated;
GRANT ALL ON public.product_types TO service_role;
ALTER TABLE public.product_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_types tenant read"   ON public.product_types FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "product_types tenant insert" ON public.product_types FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "product_types tenant update" ON public.product_types FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "product_types tenant delete" ON public.product_types FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE TABLE IF NOT EXISTS public.capacities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capacities TO authenticated;
GRANT ALL ON public.capacities TO service_role;
ALTER TABLE public.capacities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "capacities tenant read"   ON public.capacities FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "capacities tenant insert" ON public.capacities FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "capacities tenant update" ON public.capacities FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "capacities tenant delete" ON public.capacities FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE TABLE IF NOT EXISTS public.sizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sizes TO authenticated;
GRANT ALL ON public.sizes TO service_role;
ALTER TABLE public.sizes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sizes tenant read"   ON public.sizes FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "sizes tenant insert" ON public.sizes FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "sizes tenant update" ON public.sizes FOR UPDATE TO authenticated USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "sizes tenant delete" ON public.sizes FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());

-- 2) Columns
ALTER TABLE public.products                 ADD COLUMN IF NOT EXISTS product_type text, ADD COLUMN IF NOT EXISTS capacity text, ADD COLUMN IF NOT EXISTS size text;
ALTER TABLE public.inventory_reservations   ADD COLUMN IF NOT EXISTS product_type text, ADD COLUMN IF NOT EXISTS capacity text, ADD COLUMN IF NOT EXISTS size text;
ALTER TABLE public.inventory_session_items  ADD COLUMN IF NOT EXISTS product_type text, ADD COLUMN IF NOT EXISTS capacity text, ADD COLUMN IF NOT EXISTS size text;
ALTER TABLE public.invoice_items            ADD COLUMN IF NOT EXISTS product_type text, ADD COLUMN IF NOT EXISTS capacity text, ADD COLUMN IF NOT EXISTS size text;
ALTER TABLE public.purchase_return_items    ADD COLUMN IF NOT EXISTS product_type text, ADD COLUMN IF NOT EXISTS capacity text, ADD COLUMN IF NOT EXISTS size text;
ALTER TABLE public.quote_items              ADD COLUMN IF NOT EXISTS product_type text, ADD COLUMN IF NOT EXISTS capacity text, ADD COLUMN IF NOT EXISTS size text;
ALTER TABLE public.return_items             ADD COLUMN IF NOT EXISTS product_type text, ADD COLUMN IF NOT EXISTS capacity text, ADD COLUMN IF NOT EXISTS size text;
ALTER TABLE public.shipment_items           ADD COLUMN IF NOT EXISTS product_type text, ADD COLUMN IF NOT EXISTS capacity text, ADD COLUMN IF NOT EXISTS size text;
ALTER TABLE public.stock_adjustment_items   ADD COLUMN IF NOT EXISTS product_type text, ADD COLUMN IF NOT EXISTS capacity text, ADD COLUMN IF NOT EXISTS size text;
ALTER TABLE public.stock_transfers          ADD COLUMN IF NOT EXISTS product_type text, ADD COLUMN IF NOT EXISTS capacity text, ADD COLUMN IF NOT EXISTS size text;
ALTER TABLE public.pre_orders               ADD COLUMN IF NOT EXISTS product_type text, ADD COLUMN IF NOT EXISTS capacity text, ADD COLUMN IF NOT EXISTS size text;

-- 3) Extend trigger function
CREATE OR REPLACE FUNCTION public.set_item_color_from_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p_color text; p_type text; p_capacity text; p_size text;
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    SELECT color, product_type, capacity, size
      INTO p_color, p_type, p_capacity, p_size
      FROM public.products WHERE id = NEW.product_id;
    IF NEW.color IS NULL THEN NEW.color := p_color; END IF;
    IF NEW.product_type IS NULL THEN NEW.product_type := p_type; END IF;
    IF NEW.capacity IS NULL THEN NEW.capacity := p_capacity; END IF;
    IF NEW.size IS NULL THEN NEW.size := p_size; END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 4) Backfill (skip pre_orders — no product_id)
UPDATE public.inventory_reservations  r SET product_type = p.product_type, capacity = p.capacity, size = p.size FROM public.products p WHERE p.id = r.product_id AND (r.product_type IS NULL OR r.capacity IS NULL OR r.size IS NULL);
UPDATE public.inventory_session_items r SET product_type = p.product_type, capacity = p.capacity, size = p.size FROM public.products p WHERE p.id = r.product_id AND (r.product_type IS NULL OR r.capacity IS NULL OR r.size IS NULL);
UPDATE public.invoice_items           r SET product_type = p.product_type, capacity = p.capacity, size = p.size FROM public.products p WHERE p.id = r.product_id AND (r.product_type IS NULL OR r.capacity IS NULL OR r.size IS NULL);
UPDATE public.purchase_return_items   r SET product_type = p.product_type, capacity = p.capacity, size = p.size FROM public.products p WHERE p.id = r.product_id AND (r.product_type IS NULL OR r.capacity IS NULL OR r.size IS NULL);
UPDATE public.quote_items             r SET product_type = p.product_type, capacity = p.capacity, size = p.size FROM public.products p WHERE p.id = r.product_id AND (r.product_type IS NULL OR r.capacity IS NULL OR r.size IS NULL);
UPDATE public.return_items            r SET product_type = p.product_type, capacity = p.capacity, size = p.size FROM public.products p WHERE p.id = r.product_id AND (r.product_type IS NULL OR r.capacity IS NULL OR r.size IS NULL);
UPDATE public.shipment_items          r SET product_type = p.product_type, capacity = p.capacity, size = p.size FROM public.products p WHERE p.id = r.product_id AND (r.product_type IS NULL OR r.capacity IS NULL OR r.size IS NULL);
UPDATE public.stock_adjustment_items  r SET product_type = p.product_type, capacity = p.capacity, size = p.size FROM public.products p WHERE p.id = r.product_id AND (r.product_type IS NULL OR r.capacity IS NULL OR r.size IS NULL);
UPDATE public.stock_transfers         r SET product_type = p.product_type, capacity = p.capacity, size = p.size FROM public.products p WHERE p.id = r.product_id AND (r.product_type IS NULL OR r.capacity IS NULL OR r.size IS NULL);

-- 5) Seed lookups
INSERT INTO public.product_types (tenant_id, name)
SELECT DISTINCT tenant_id, btrim(product_type) FROM public.products
WHERE product_type IS NOT NULL AND btrim(product_type) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.capacities (tenant_id, name)
SELECT DISTINCT tenant_id, btrim(capacity) FROM public.products
WHERE capacity IS NOT NULL AND btrim(capacity) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.sizes (tenant_id, name)
SELECT DISTINCT tenant_id, btrim(size) FROM public.products
WHERE size IS NOT NULL AND btrim(size) <> ''
ON CONFLICT DO NOTHING;
