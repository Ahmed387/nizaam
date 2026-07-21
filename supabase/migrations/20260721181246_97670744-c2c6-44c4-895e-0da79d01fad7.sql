
-- Colors reference table
CREATE TABLE public.colors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  hex TEXT NOT NULL DEFAULT '#cccccc',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.colors TO authenticated;
GRANT ALL ON public.colors TO service_role;

ALTER TABLE public.colors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "colors tenant read" ON public.colors
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "colors tenant write" ON public.colors
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

-- Add color column to affected tables
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.shipment_items ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.return_items ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.purchase_return_items ADD COLUMN IF NOT EXISTS color TEXT;

-- Seed default palette for every existing tenant
INSERT INTO public.colors (tenant_id, name, hex)
SELECT t.id, v.name, v.hex FROM public.tenants t
CROSS JOIN (VALUES
  ('أبيض','#FFFFFF'),
  ('أسود','#111111'),
  ('رمادي','#9CA3AF'),
  ('فضي','#C0C0C0'),
  ('ذهبي','#D4AF37'),
  ('أحمر','#DC2626'),
  ('أزرق','#2563EB'),
  ('أخضر','#16A34A'),
  ('أصفر','#EAB308'),
  ('بني','#78350F'),
  ('بيج','#E7D3B1'),
  ('شفاف','#E5E7EB')
) AS v(name, hex)
ON CONFLICT (tenant_id, name) DO NOTHING;
