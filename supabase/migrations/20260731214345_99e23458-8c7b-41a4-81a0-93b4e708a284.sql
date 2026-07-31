CREATE OR REPLACE FUNCTION public.capture_shipment_prev_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.contact_id IS NOT NULL AND NEW.previous_balance IS NULL THEN
    SELECT COALESCE(total_balance, 0) INTO NEW.previous_balance
      FROM public.v_contact_balances WHERE contact_id = NEW.contact_id;
    NEW.previous_balance := COALESCE(NEW.previous_balance, 0);
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.capture_shipment_curr_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_curr numeric;
BEGIN
  IF NEW.contact_id IS NOT NULL AND NEW.current_balance IS NULL THEN
    SELECT COALESCE(total_balance, 0) INTO v_curr
      FROM public.v_contact_balances WHERE contact_id = NEW.contact_id;
    UPDATE public.shipments SET current_balance = COALESCE(v_curr, 0) WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;