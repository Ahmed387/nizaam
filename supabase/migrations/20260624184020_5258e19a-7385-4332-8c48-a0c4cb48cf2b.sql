CREATE OR REPLACE FUNCTION public.enforce_invoice_date_edit_permission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.invoice_date IS DISTINCT FROM OLD.invoice_date THEN
    IF NOT (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
    ) THEN
      RAISE EXCEPTION 'Only the company owner (admin/super_admin) can edit the invoice date';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;