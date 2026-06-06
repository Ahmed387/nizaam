ALTER TABLE public.shipment_items
  ADD COLUMN IF NOT EXISTS discount_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;