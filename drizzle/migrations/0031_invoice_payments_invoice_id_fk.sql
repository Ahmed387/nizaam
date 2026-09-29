-- Link every payment to a real invoice so PostgREST can resolve the invoices <-> invoice_payments
-- relationship. The payment-method filter on the sales invoice screen then runs as a genuine
-- join inside the database instead of collecting invoice ids on the client.
-- hard_delete_invoice already deletes an invoice's payments before deleting the invoice itself,
-- so this constraint only formalises behaviour the app already has; no financial row is removed
-- any differently than before.
ALTER TABLE public.invoice_payments
  ADD CONSTRAINT invoice_payments_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.invoices (id) ON DELETE CASCADE;