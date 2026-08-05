ALTER TABLE public.partner_advance_installments DROP CONSTRAINT IF EXISTS partner_advance_installments_status_check;
ALTER TABLE public.partner_advance_installments
  ADD CONSTRAINT partner_advance_installments_status_check
  CHECK (status IN ('pending','partially_paid','paid','overdue','cancelled'));