-- Add missing tables to realtime publication
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'vouchers','suppliers','customers',
    'purchase_returns','purchase_return_items',
    'quotes','quote_items',
    'stock_adjustments','stock_adjustment_items',
    'attendance','user_presence','supplier_payments',
    'invoice_payments','payment_transactions','pre_orders','pre_order_transactions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t)
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    END IF;
  END LOOP;
END $$;