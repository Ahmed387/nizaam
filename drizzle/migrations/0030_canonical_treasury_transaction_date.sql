ALTER TABLE public.treasury
  ADD COLUMN IF NOT EXISTS transaction_date date;

COMMENT ON COLUMN public.treasury.transaction_date IS
  'Canonical accounting date for treasury filtering and ordering; document date, never record creation time.';

UPDATE public.treasury AS t
SET transaction_date = COALESCE(
  (SELECT v.voucher_date FROM public.vouchers AS v WHERE v.treasury_id = t.id ORDER BY v.created_at DESC LIMIT 1),
  (SELECT i.invoice_date AT TIME ZONE 'Africa/Cairo' FROM public.invoices AS i WHERE i.id = t.reference_id),
  (SELECT r.invoice_date AT TIME ZONE 'Africa/Cairo' FROM public.returns AS r WHERE r.id = t.reference_id),
  (SELECT pr.invoice_date AT TIME ZONE 'Africa/Cairo' FROM public.purchase_returns AS pr WHERE pr.id = t.reference_id),
  (SELECT COALESCE(vr.cancelled_at AT TIME ZONE 'Africa/Cairo', vr.voucher_date::timestamp) FROM public.vouchers AS vr WHERE vr.id = t.reference_id),
  (t.created_at AT TIME ZONE 'Africa/Cairo')::date
)
WHERE t.transaction_date IS NULL;

ALTER TABLE public.treasury
  ALTER COLUMN transaction_date SET DEFAULT ((now() AT TIME ZONE 'Africa/Cairo')::date),
  ALTER COLUMN transaction_date SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_treasury_branch_transaction_date
  ON public.treasury (branch_id, transaction_date DESC, id);

CREATE OR REPLACE FUNCTION public.treasury_set_transaction_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_date date;
BEGIN
  IF NEW.transaction_date IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.reference_id IS NOT NULL THEN
    SELECT COALESCE(
      (SELECT (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date FROM public.invoices i WHERE i.id = NEW.reference_id),
      (SELECT (r.invoice_date AT TIME ZONE 'Africa/Cairo')::date FROM public.returns r WHERE r.id = NEW.reference_id),
      (SELECT (pr.invoice_date AT TIME ZONE 'Africa/Cairo')::date FROM public.purchase_returns pr WHERE pr.id = NEW.reference_id),
      (SELECT COALESCE((v.cancelled_at AT TIME ZONE 'Africa/Cairo')::date, v.voucher_date) FROM public.vouchers v WHERE v.id = NEW.reference_id)
    ) INTO v_date;
  END IF;

  NEW.transaction_date := COALESCE(v_date, (now() AT TIME ZONE 'Africa/Cairo')::date);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_treasury_set_transaction_date ON public.treasury;
CREATE TRIGGER trg_treasury_set_transaction_date
BEFORE INSERT OR UPDATE OF reference_id, transaction_date ON public.treasury
FOR EACH ROW EXECUTE FUNCTION public.treasury_set_transaction_date();

CREATE OR REPLACE FUNCTION public.sync_treasury_date_from_voucher()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.treasury_id IS NOT NULL THEN
    UPDATE public.treasury
       SET transaction_date = NEW.voucher_date
     WHERE id = NEW.treasury_id
       AND transaction_date IS DISTINCT FROM NEW.voucher_date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_treasury_date_from_voucher ON public.vouchers;
CREATE TRIGGER trg_sync_treasury_date_from_voucher
AFTER INSERT OR UPDATE OF voucher_date, treasury_id ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.sync_treasury_date_from_voucher();