
-- 1) Add invoice_date column to all four invoice-like tables
ALTER TABLE public.invoices         ADD COLUMN IF NOT EXISTS invoice_date date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public.shipments        ADD COLUMN IF NOT EXISTS invoice_date date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public.returns          ADD COLUMN IF NOT EXISTS invoice_date date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS invoice_date date NOT NULL DEFAULT CURRENT_DATE;

-- 2) Backfill existing rows from created_at
UPDATE public.invoices         SET invoice_date = created_at::date WHERE invoice_date = CURRENT_DATE AND created_at IS NOT NULL;
UPDATE public.shipments        SET invoice_date = created_at::date WHERE invoice_date = CURRENT_DATE AND created_at IS NOT NULL;
UPDATE public.returns          SET invoice_date = created_at::date WHERE invoice_date = CURRENT_DATE AND created_at IS NOT NULL;
UPDATE public.purchase_returns SET invoice_date = created_at::date WHERE invoice_date = CURRENT_DATE AND created_at IS NOT NULL;

-- 3) Trigger to restrict UPDATE of invoice_date to admin/super_admin only
CREATE OR REPLACE FUNCTION public.enforce_invoice_date_edit_permission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_privileged boolean;
BEGIN
  -- Allow if value did not change
  IF NEW.invoice_date IS NOT DISTINCT FROM OLD.invoice_date THEN
    RETURN NEW;
  END IF;

  -- Allow service_role / no JWT context (server-side jobs)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin','super_admin')
  ) INTO is_privileged;

  IF NOT is_privileged THEN
    RAISE EXCEPTION 'Only admin or super_admin can change invoice_date'
      USING ERRCODE = '42501';
  END IF;

  -- Log change to audit_log if table exists
  BEGIN
    INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, old_values, new_values, created_at)
    VALUES (
      auth.uid(),
      'invoice_date_changed',
      TG_TABLE_NAME,
      NEW.id,
      jsonb_build_object('invoice_date', OLD.invoice_date),
      jsonb_build_object('invoice_date', NEW.invoice_date),
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    -- never block update if audit logging fails
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_date_edit         ON public.invoices;
DROP TRIGGER IF EXISTS trg_shipments_date_edit        ON public.shipments;
DROP TRIGGER IF EXISTS trg_returns_date_edit          ON public.returns;
DROP TRIGGER IF EXISTS trg_purchase_returns_date_edit ON public.purchase_returns;

CREATE TRIGGER trg_invoices_date_edit         BEFORE UPDATE ON public.invoices         FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_date_edit_permission();
CREATE TRIGGER trg_shipments_date_edit        BEFORE UPDATE ON public.shipments        FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_date_edit_permission();
CREATE TRIGGER trg_returns_date_edit          BEFORE UPDATE ON public.returns          FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_date_edit_permission();
CREATE TRIGGER trg_purchase_returns_date_edit BEFORE UPDATE ON public.purchase_returns FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_date_edit_permission();

-- 4) Helpful indexes for date-range filters
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date         ON public.invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_shipments_invoice_date        ON public.shipments(invoice_date);
CREATE INDEX IF NOT EXISTS idx_returns_invoice_date          ON public.returns(invoice_date);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_invoice_date ON public.purchase_returns(invoice_date);
