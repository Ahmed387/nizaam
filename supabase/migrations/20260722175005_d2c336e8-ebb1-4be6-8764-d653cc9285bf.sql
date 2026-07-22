DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.equity_partners; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_transactions; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
ALTER TABLE public.equity_partners REPLICA IDENTITY FULL;
ALTER TABLE public.partner_transactions REPLICA IDENTITY FULL;