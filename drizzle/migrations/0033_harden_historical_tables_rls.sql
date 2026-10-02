DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['historical_invoices','historical_invoice_items','historical_vouchers'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow authenticated read/write %s" ON public.%I', t, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format($p$CREATE POLICY "hist_select_scoped" ON public.%I FOR SELECT TO authenticated USING (
      public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'accountant')
      OR branch_name IN (SELECT b.name FROM public.branch_users bu JOIN public.branches b ON b.id = bu.branch_id WHERE bu.user_id = auth.uid())
    )$p$, t);
    EXECUTE format($p$CREATE POLICY "hist_insert_admin" ON public.%I FOR INSERT TO authenticated WITH CHECK (
      public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin'))$p$, t);
    EXECUTE format($p$CREATE POLICY "hist_update_owner" ON public.%I FOR UPDATE TO authenticated USING (
      public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin')) WITH CHECK (
      public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin'))$p$, t);
    EXECUTE format($p$CREATE POLICY "hist_delete_owner" ON public.%I FOR DELETE TO authenticated USING (
      public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin'))$p$, t);
  END LOOP;
END $$;