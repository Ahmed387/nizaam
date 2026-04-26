
-- Default tenant_id on insert via trigger that pulls from current user's profile
CREATE OR REPLACE FUNCTION public.set_tenant_id_from_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := (SELECT tenant_id FROM public.profiles WHERE id = auth.uid() LIMIT 1);
  END IF;
  RETURN NEW;
END;
$$;

-- Attach trigger to all tenanted tables
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'branches','user_roles','branch_users','categories','products',
    'customers','suppliers','employees','invoices','invoice_items',
    'returns','return_items','shipments','shipment_items','expenses',
    'treasury','treasury_transfers','stock_transfers','advances',
    'advance_payments','salaries','price_list','audit_log','settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_user()', t);
  END LOOP;
END $$;
