
-- Add tenant_id to bank_accounts and backfill from chart_of_accounts
ALTER TABLE public.bank_accounts ADD COLUMN IF NOT EXISTS tenant_id uuid;

UPDATE public.bank_accounts ba
SET tenant_id = coa.tenant_id
FROM public.chart_of_accounts coa
WHERE ba.gl_account_id = coa.id AND ba.tenant_id IS NULL;

ALTER TABLE public.bank_accounts ALTER COLUMN tenant_id SET NOT NULL;

-- Trigger to auto-fill tenant_id from gl_account
CREATE OR REPLACE FUNCTION public.set_bank_account_tenant_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM public.chart_of_accounts WHERE id = NEW.gl_account_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_bank_account_tenant_id ON public.bank_accounts;
CREATE TRIGGER trg_set_bank_account_tenant_id
BEFORE INSERT ON public.bank_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_bank_account_tenant_id();

-- Policies
DROP POLICY IF EXISTS "Admins manage tenant budgets" ON public.budgets;
CREATE POLICY "Admins manage tenant budgets" ON public.budgets FOR ALL
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage bank accounts" ON public.bank_accounts;
CREATE POLICY "Admins manage bank accounts" ON public.bank_accounts FOR ALL
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage fiscal periods" ON public.fiscal_periods;
CREATE POLICY "Admins manage fiscal periods" ON public.fiscal_periods FOR ALL
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage distributions" ON public.profit_distributions;
CREATE POLICY "Admins manage distributions" ON public.profit_distributions FOR ALL
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage statements" ON public.bank_statements;
CREATE POLICY "Admins manage statements" ON public.bank_statements FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (SELECT 1 FROM public.bank_accounts ba WHERE ba.id = bank_statements.bank_account_id AND ba.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (SELECT 1 FROM public.bank_accounts ba WHERE ba.id = bank_statements.bank_account_id AND ba.tenant_id = public.current_tenant_id())
  );

DROP POLICY IF EXISTS "Admins manage statement lines" ON public.bank_statement_lines;
CREATE POLICY "Admins manage statement lines" ON public.bank_statement_lines FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (SELECT 1 FROM public.bank_accounts ba WHERE ba.id = bank_statement_lines.bank_account_id AND ba.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (SELECT 1 FROM public.bank_accounts ba WHERE ba.id = bank_statement_lines.bank_account_id AND ba.tenant_id = public.current_tenant_id())
  );

DROP POLICY IF EXISTS "Admins manage distribution lines" ON public.profit_distribution_lines;
CREATE POLICY "Admins manage distribution lines" ON public.profit_distribution_lines FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (SELECT 1 FROM public.profit_distributions pd WHERE pd.id = profit_distribution_lines.distribution_id AND pd.tenant_id = public.current_tenant_id())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (SELECT 1 FROM public.profit_distributions pd WHERE pd.id = profit_distribution_lines.distribution_id AND pd.tenant_id = public.current_tenant_id())
  );
