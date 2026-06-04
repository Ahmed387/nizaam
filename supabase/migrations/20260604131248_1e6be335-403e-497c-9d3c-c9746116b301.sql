
-- 1) Sale invoices: switch format to IN + 5 digits (reuse existing invoice_seq)
CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS text
LANGUAGE sql
SET search_path TO 'public'
AS $$
  SELECT 'IN' || LPAD(nextval('public.invoice_seq')::TEXT, 5, '0')
$$;

-- Backfill existing invoices preserving original numeric tail
UPDATE public.invoices
SET invoice_number = 'IN' || LPAD(SPLIT_PART(invoice_number, '-', 3), 5, '0')
WHERE invoice_number LIKE 'INV-%';

-- 2) Shipments (purchase invoices): add shipment_number PO + 5 digits
CREATE SEQUENCE IF NOT EXISTS public.shipment_seq START 1;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS shipment_number TEXT;

CREATE OR REPLACE FUNCTION public.next_shipment_number()
RETURNS text
LANGUAGE sql
SET search_path TO 'public'
AS $$
  SELECT 'PO' || LPAD(nextval('public.shipment_seq')::TEXT, 5, '0')
$$;

-- Backfill shipments in chronological order
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.shipments
  WHERE shipment_number IS NULL
)
UPDATE public.shipments s
SET shipment_number = 'PO' || LPAD(o.rn::TEXT, 5, '0')
FROM ordered o
WHERE s.id = o.id;

-- Move sequence forward past backfilled rows
SELECT setval('public.shipment_seq', GREATEST((SELECT count(*) FROM public.shipments), 1), true);

ALTER TABLE public.shipments
  ALTER COLUMN shipment_number SET DEFAULT public.next_shipment_number();
ALTER TABLE public.shipments ALTER COLUMN shipment_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shipments_shipment_number_uniq ON public.shipments(shipment_number);

-- 3) Sale returns: add return_number SR + 5 digits
CREATE SEQUENCE IF NOT EXISTS public.sale_return_seq START 1;
ALTER TABLE public.returns ADD COLUMN IF NOT EXISTS return_number TEXT;

CREATE OR REPLACE FUNCTION public.next_sale_return_number()
RETURNS text
LANGUAGE sql
SET search_path TO 'public'
AS $$
  SELECT 'SR' || LPAD(nextval('public.sale_return_seq')::TEXT, 5, '0')
$$;

WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.returns
  WHERE return_number IS NULL
)
UPDATE public.returns r
SET return_number = 'SR' || LPAD(o.rn::TEXT, 5, '0')
FROM ordered o
WHERE r.id = o.id;

SELECT setval('public.sale_return_seq', GREATEST((SELECT count(*) FROM public.returns), 1), true);

ALTER TABLE public.returns
  ALTER COLUMN return_number SET DEFAULT public.next_sale_return_number();
ALTER TABLE public.returns ALTER COLUMN return_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS returns_return_number_uniq ON public.returns(return_number);

-- 4) Purchase returns: replace ad-hoc PR-<timestamp> with PR + 5 digits
CREATE SEQUENCE IF NOT EXISTS public.purchase_return_seq START 1;

CREATE OR REPLACE FUNCTION public.next_purchase_return_number()
RETURNS text
LANGUAGE sql
SET search_path TO 'public'
AS $$
  SELECT 'PR' || LPAD(nextval('public.purchase_return_seq')::TEXT, 5, '0')
$$;

WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.purchase_returns
)
UPDATE public.purchase_returns p
SET return_number = 'PR' || LPAD(o.rn::TEXT, 5, '0')
FROM ordered o
WHERE p.id = o.id;

SELECT setval('public.purchase_return_seq', GREATEST((SELECT count(*) FROM public.purchase_returns), 1), true);

ALTER TABLE public.purchase_returns
  ALTER COLUMN return_number SET DEFAULT public.next_purchase_return_number();
