
DO $$ BEGIN
  CREATE TYPE public.account_type AS ENUM ('asset','liability','equity','revenue','expense');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.normal_balance AS ENUM ('debit','credit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  name_ar TEXT,
  account_type public.account_type NOT NULL,
  normal_balance public.normal_balance NOT NULL,
  parent_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chart_of_accounts TO authenticated;
GRANT ALL ON public.chart_of_accounts TO service_role;
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tenant accounts"
  ON public.chart_of_accounts FOR ALL
  USING (tenant_id = public.current_tenant_id() AND (
    public.has_role(auth.uid(),'admin'::app_role) OR
    public.has_role(auth.uid(),'super_admin'::app_role) OR
    public.has_role(auth.uid(),'accountant'::app_role)
  ))
  WITH CHECK (tenant_id = public.current_tenant_id() AND (
    public.has_role(auth.uid(),'admin'::app_role) OR
    public.has_role(auth.uid(),'super_admin'::app_role) OR
    public.has_role(auth.uid(),'accountant'::app_role)
  ));

CREATE POLICY "Authenticated read tenant accounts"
  ON public.chart_of_accounts FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_coa_tenant ON public.chart_of_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_coa_type ON public.chart_of_accounts(tenant_id, account_type);

CREATE TABLE IF NOT EXISTS public.journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  entry_number TEXT NOT NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  source_type TEXT,
  source_id UUID,
  status TEXT NOT NULL DEFAULT 'posted',
  reversed_by UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by UUID,
  total_debit NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_credit NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, entry_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entries TO authenticated;
GRANT ALL ON public.journal_entries TO service_role;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tenant journal"
  ON public.journal_entries FOR ALL
  USING (tenant_id = public.current_tenant_id() AND (
    public.has_role(auth.uid(),'admin'::app_role) OR
    public.has_role(auth.uid(),'super_admin'::app_role) OR
    public.has_role(auth.uid(),'accountant'::app_role)
  ))
  WITH CHECK (tenant_id = public.current_tenant_id() AND (
    public.has_role(auth.uid(),'admin'::app_role) OR
    public.has_role(auth.uid(),'super_admin'::app_role) OR
    public.has_role(auth.uid(),'accountant'::app_role)
  ));

CREATE POLICY "Authenticated read tenant journal"
  ON public.journal_entries FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_je_tenant_date ON public.journal_entries(tenant_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_je_source ON public.journal_entries(source_type, source_id);

CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.chart_of_accounts(id),
  debit NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit NUMERIC(18,2) NOT NULL DEFAULT 0,
  description TEXT,
  line_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK (NOT (debit > 0 AND credit > 0))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entry_lines TO authenticated;
GRANT ALL ON public.journal_entry_lines TO service_role;
ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tenant journal lines"
  ON public.journal_entry_lines FOR ALL
  USING (tenant_id = public.current_tenant_id() AND (
    public.has_role(auth.uid(),'admin'::app_role) OR
    public.has_role(auth.uid(),'super_admin'::app_role) OR
    public.has_role(auth.uid(),'accountant'::app_role)
  ))
  WITH CHECK (tenant_id = public.current_tenant_id() AND (
    public.has_role(auth.uid(),'admin'::app_role) OR
    public.has_role(auth.uid(),'super_admin'::app_role) OR
    public.has_role(auth.uid(),'accountant'::app_role)
  ));

CREATE POLICY "Authenticated read tenant journal lines"
  ON public.journal_entry_lines FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_jel_entry ON public.journal_entry_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_jel_account ON public.journal_entry_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_jel_tenant ON public.journal_entry_lines(tenant_id);

CREATE OR REPLACE FUNCTION public.set_updated_at_ledger()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_coa_updated ON public.chart_of_accounts;
CREATE TRIGGER trg_coa_updated BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ledger();

DROP TRIGGER IF EXISTS trg_je_updated ON public.journal_entries;
CREATE TRIGGER trg_je_updated BEFORE UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_ledger();

CREATE OR REPLACE FUNCTION public.recalc_journal_entry_totals()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_entry UUID; v_debit NUMERIC(18,2); v_credit NUMERIC(18,2);
BEGIN
  v_entry := COALESCE(NEW.entry_id, OLD.entry_id);
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO v_debit, v_credit
    FROM public.journal_entry_lines WHERE entry_id = v_entry;
  UPDATE public.journal_entries SET total_debit = v_debit, total_credit = v_credit WHERE id = v_entry;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_jel_recalc ON public.journal_entry_lines;
CREATE TRIGGER trg_jel_recalc
AFTER INSERT OR UPDATE OR DELETE ON public.journal_entry_lines
FOR EACH ROW EXECUTE FUNCTION public.recalc_journal_entry_totals();

CREATE OR REPLACE FUNCTION public.enforce_journal_balance()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'posted' AND ROUND(NEW.total_debit,2) <> ROUND(NEW.total_credit,2) THEN
    RAISE EXCEPTION 'Journal entry % is not balanced: debit=% credit=%', NEW.entry_number, NEW.total_debit, NEW.total_credit;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_je_balance ON public.journal_entries;
CREATE TRIGGER trg_je_balance
BEFORE UPDATE ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION public.enforce_journal_balance();

CREATE OR REPLACE FUNCTION public.create_journal_entry(
  p_tenant_id UUID, p_entry_date DATE, p_description TEXT,
  p_source_type TEXT, p_source_id UUID, p_lines JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entry_id UUID; v_entry_number TEXT; v_line JSONB; v_account_id UUID; v_seq INTEGER;
  v_total_debit NUMERIC(18,2) := 0; v_total_credit NUMERIC(18,2) := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'Journal entry requires at least 2 lines';
  END IF;

  SELECT COALESCE(MAX(CAST(SPLIT_PART(entry_number,'-',3) AS INTEGER)),0)+1 INTO v_seq
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id
     AND entry_number LIKE 'JE-'||to_char(p_entry_date,'YYYYMM')||'-%';

  v_entry_number := 'JE-'||to_char(p_entry_date,'YYYYMM')||'-'||LPAD(v_seq::TEXT,4,'0');

  INSERT INTO public.journal_entries(tenant_id, entry_number, entry_date, description, source_type, source_id, status, created_by)
  VALUES (p_tenant_id, v_entry_number, p_entry_date, p_description, p_source_type, p_source_id, 'draft', auth.uid())
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT id INTO v_account_id FROM public.chart_of_accounts
      WHERE tenant_id = p_tenant_id AND code = v_line->>'account_code' LIMIT 1;
    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Account code % not found', v_line->>'account_code';
    END IF;

    INSERT INTO public.journal_entry_lines(tenant_id, entry_id, account_id, debit, credit, description)
    VALUES (p_tenant_id, v_entry_id, v_account_id,
      COALESCE((v_line->>'debit')::NUMERIC, 0),
      COALESCE((v_line->>'credit')::NUMERIC, 0),
      v_line->>'description');

    v_total_debit  := v_total_debit  + COALESCE((v_line->>'debit')::NUMERIC, 0);
    v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::NUMERIC, 0);
  END LOOP;

  IF ROUND(v_total_debit,2) <> ROUND(v_total_credit,2) THEN
    RAISE EXCEPTION 'Unbalanced entry: debit=% credit=%', v_total_debit, v_total_credit;
  END IF;

  UPDATE public.journal_entries SET status = 'posted' WHERE id = v_entry_id;
  RETURN v_entry_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_journal_entry(UUID,DATE,TEXT,TEXT,UUID,JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.seed_default_chart_of_accounts(p_tenant_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, is_system)
  VALUES
    (p_tenant_id,'1000','Assets','الأصول','asset','debit',true),
    (p_tenant_id,'1100','Cash / Treasury','الخزينة','asset','debit',true),
    (p_tenant_id,'1110','Bank','البنك','asset','debit',true),
    (p_tenant_id,'1200','Accounts Receivable','العملاء (مدينون)','asset','debit',true),
    (p_tenant_id,'1300','Inventory','المخزون','asset','debit',true),
    (p_tenant_id,'1400','Partner Advances Receivable','سلف الشركاء','asset','debit',true),
    (p_tenant_id,'2000','Liabilities','الخصوم','liability','credit',true),
    (p_tenant_id,'2100','Accounts Payable','الموردون (دائنون)','liability','credit',true),
    (p_tenant_id,'2200','VAT Payable','ضريبة القيمة المضافة المستحقة','liability','credit',true),
    (p_tenant_id,'2300','Accrued Expenses','مصروفات مستحقة','liability','credit',true),
    (p_tenant_id,'3000','Equity','حقوق الملكية','equity','credit',true),
    (p_tenant_id,'3100','Partner Capital','رأس مال الشركاء','equity','credit',true),
    (p_tenant_id,'3200','Partner Drawings','مسحوبات الشركاء','equity','debit',true),
    (p_tenant_id,'3300','Retained Earnings','أرباح محتجزة','equity','credit',true),
    (p_tenant_id,'4000','Revenue','الإيرادات','revenue','credit',true),
    (p_tenant_id,'4100','Sales Revenue','إيراد المبيعات','revenue','credit',true),
    (p_tenant_id,'4200','Other Income','إيرادات أخرى','revenue','credit',true),
    (p_tenant_id,'4900','Sales Returns','مردودات المبيعات','revenue','debit',true),
    (p_tenant_id,'5000','Expenses','المصروفات','expense','debit',true),
    (p_tenant_id,'5100','Cost of Goods Sold','تكلفة البضاعة المباعة','expense','debit',true),
    (p_tenant_id,'5200','Salaries Expense','الرواتب','expense','debit',true),
    (p_tenant_id,'5300','Rent Expense','الإيجارات','expense','debit',true),
    (p_tenant_id,'5400','Utilities Expense','المرافق','expense','debit',true),
    (p_tenant_id,'5500','Operating Expenses','مصروفات تشغيلية','expense','debit',true),
    (p_tenant_id,'5900','Other Expenses','مصروفات أخرى','expense','debit',true)
  ON CONFLICT (tenant_id, code) DO NOTHING;
END $$;

GRANT EXECUTE ON FUNCTION public.seed_default_chart_of_accounts(UUID) TO authenticated;

DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_default_chart_of_accounts(t.id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.trg_seed_coa_on_tenant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.seed_default_chart_of_accounts(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tenant_seed_coa ON public.tenants;
CREATE TRIGGER trg_tenant_seed_coa
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.trg_seed_coa_on_tenant();

CREATE OR REPLACE VIEW public.v_account_balances AS
SELECT
  a.id AS account_id, a.tenant_id, a.code, a.name, a.name_ar,
  a.account_type, a.normal_balance,
  COALESCE(SUM(l.debit),0) AS total_debit,
  COALESCE(SUM(l.credit),0) AS total_credit,
  CASE WHEN a.normal_balance = 'debit'
    THEN COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0)
    ELSE COALESCE(SUM(l.credit),0) - COALESCE(SUM(l.debit),0) END AS balance
FROM public.chart_of_accounts a
LEFT JOIN public.journal_entry_lines l ON l.account_id = a.id
LEFT JOIN public.journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
GROUP BY a.id;

GRANT SELECT ON public.v_account_balances TO authenticated;
