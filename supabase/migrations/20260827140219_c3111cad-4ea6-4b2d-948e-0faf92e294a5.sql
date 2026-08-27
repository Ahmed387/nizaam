CREATE OR REPLACE FUNCTION public.calculate_payment_fee(p_method text, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_fee_type TEXT; v_fee_value NUMERIC;
BEGIN
  IF p_method = 'cash' OR p_method IS NULL THEN RETURN 0; END IF;
  SELECT fee_type, fee_value INTO v_fee_type, v_fee_value
    FROM public.transfer_fees
    WHERE tenant_id = current_tenant_id()
      AND payment_method = p_method
      AND COALESCE(is_enabled, true) = true
    LIMIT 1;
  IF v_fee_value IS NULL THEN RETURN 0; END IF;
  IF v_fee_type = 'percentage' THEN RETURN ROUND(p_amount * v_fee_value / 100.0, 2);
  ELSE RETURN v_fee_value; END IF;
END;
$function$;