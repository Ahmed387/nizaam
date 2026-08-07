ALTER TABLE public.treasury DROP CONSTRAINT IF EXISTS treasury_payment_method_check;
ALTER TABLE public.treasury ADD CONSTRAINT treasury_payment_method_check
  CHECK (payment_method IS NULL OR (btrim(payment_method) <> '' AND payment_method <> 'credit'));

CREATE OR REPLACE FUNCTION public.process_sale(
  p_branch_id uuid, p_customer_id uuid, p_subtotal numeric, p_discount_amount numeric,
  p_discount_percent numeric, p_discount_reason text, p_total numeric, p_payment_method text,
  p_items jsonb, p_payments jsonb DEFAULT NULL::jsonb, p_vat_rate numeric DEFAULT 0, p_vat_amount numeric DEFAULT 0)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_def text;
BEGIN
  RETURN NULL;
END $function$;