CREATE OR REPLACE FUNCTION public.record_shipment(p_header jsonb, p_lines jsonb, p_plan jsonb DEFAULT NULL::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_src text;
BEGIN
  RETURN NULL;
END;
$function$;