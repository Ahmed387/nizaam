
ALTER TABLE public.invoices
  ALTER COLUMN invoice_date TYPE timestamptz USING (invoice_date::timestamptz),
  ALTER COLUMN invoice_date SET DEFAULT now();

ALTER TABLE public.shipments
  ALTER COLUMN invoice_date TYPE timestamptz USING (invoice_date::timestamptz),
  ALTER COLUMN invoice_date SET DEFAULT now();

ALTER TABLE public.returns
  ALTER COLUMN invoice_date TYPE timestamptz USING (invoice_date::timestamptz),
  ALTER COLUMN invoice_date SET DEFAULT now();

ALTER TABLE public.purchase_returns
  ALTER COLUMN invoice_date TYPE timestamptz USING (invoice_date::timestamptz),
  ALTER COLUMN invoice_date SET DEFAULT now();
