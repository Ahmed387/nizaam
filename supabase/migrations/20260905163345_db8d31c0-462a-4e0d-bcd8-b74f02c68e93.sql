DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='admin_reset_go_live_extras';

  d := replace(d,
    'FROM public.returns t WHERE t.contact_id = c.id',
    'FROM public.returns t JOIN public.invoices iv ON iv.id = t.invoice_id WHERE iv.contact_id = c.id');
  d := replace(d,
    'public.vouchers t WHERE t.party_contact_id = c.id',
    'public.vouchers t WHERE t.party_id = c.id');
  d := replace(d,
    'public.payment_plans t WHERE t.contact_id = c.id',
    'public.payment_plans t WHERE t.entity_id = c.id');

  EXECUTE d;
END $$;