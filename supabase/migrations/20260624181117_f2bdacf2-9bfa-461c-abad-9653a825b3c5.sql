CREATE OR REPLACE FUNCTION public.enforce_invoice_date_edit_permission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_owner boolean;
BEGIN
  IF NEW.invoice_date IS NOT DISTINCT FROM OLD.invoice_date THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'super_admin'
  ) INTO is_owner;

  IF NOT is_owner THEN
    RAISE EXCEPTION 'Only the company owner can change invoice_date'
      USING ERRCODE = '42501';
  END IF;

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
    NULL;
  END;

  RETURN NEW;
END;
$$;