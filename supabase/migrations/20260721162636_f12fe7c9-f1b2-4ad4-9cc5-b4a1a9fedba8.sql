
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  fiscal_period_id UUID NOT NULL REFERENCES public.fiscal_periods(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  planned_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, fiscal_period_id, account_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO authenticated;
GRANT ALL ON public.budgets TO service_role;

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tenant budgets"
ON public.budgets FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_budgets_updated_at
BEFORE UPDATE ON public.budgets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_budgets_period ON public.budgets(fiscal_period_id);
CREATE INDEX idx_budgets_account ON public.budgets(account_id);

CREATE OR REPLACE FUNCTION public.get_budget_variance(_fiscal_period_id UUID)
RETURNS TABLE (
  account_id UUID,
  account_code TEXT,
  account_name TEXT,
  account_type TEXT,
  planned_amount NUMERIC,
  actual_amount NUMERIC,
  variance NUMERIC,
  variance_pct NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start DATE;
  _end DATE;
BEGIN
  SELECT start_date, end_date INTO _start, _end
  FROM public.fiscal_periods WHERE id = _fiscal_period_id;

  RETURN QUERY
  WITH actuals AS (
    SELECT
      jel.account_id,
      SUM(
        CASE
          WHEN coa.account_type IN ('revenue','liability','equity')
            THEN jel.credit_amount - jel.debit_amount
          ELSE jel.debit_amount - jel.credit_amount
        END
      ) AS actual
    FROM public.journal_entry_lines jel
    JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
    WHERE je.entry_date BETWEEN _start AND _end
      AND je.status = 'posted'
    GROUP BY jel.account_id
  )
  SELECT
    coa.id,
    coa.code,
    COALESCE(coa.name_ar, coa.name),
    coa.account_type,
    COALESCE(b.planned_amount, 0)::NUMERIC,
    COALESCE(a.actual, 0)::NUMERIC,
    (COALESCE(a.actual, 0) - COALESCE(b.planned_amount, 0))::NUMERIC AS variance,
    CASE
      WHEN COALESCE(b.planned_amount, 0) = 0 THEN NULL
      ELSE ROUND(((COALESCE(a.actual, 0) - b.planned_amount) / b.planned_amount) * 100, 2)
    END AS variance_pct
  FROM public.chart_of_accounts coa
  LEFT JOIN public.budgets b
    ON b.account_id = coa.id AND b.fiscal_period_id = _fiscal_period_id
  LEFT JOIN actuals a ON a.account_id = coa.id
  WHERE (b.id IS NOT NULL OR a.actual IS NOT NULL)
  ORDER BY coa.code;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_financial_kpis(_start_date DATE, _end_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _revenue NUMERIC := 0;
  _cogs NUMERIC := 0;
  _expenses NUMERIC := 0;
  _net_profit NUMERIC := 0;
  _gross_profit NUMERIC := 0;
  _assets NUMERIC := 0;
  _liabilities NUMERIC := 0;
  _equity NUMERIC := 0;
  _cash NUMERIC := 0;
  _ar NUMERIC := 0;
  _ap NUMERIC := 0;
  _inventory NUMERIC := 0;
BEGIN
  SELECT COALESCE(SUM(jel.credit_amount - jel.debit_amount), 0) INTO _revenue
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type = 'revenue'
    AND je.entry_date BETWEEN _start_date AND _end_date
    AND je.status = 'posted';

  SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) INTO _cogs
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '5%'
    AND je.entry_date BETWEEN _start_date AND _end_date
    AND je.status = 'posted';

  SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) INTO _expenses
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type = 'expense'
    AND je.entry_date BETWEEN _start_date AND _end_date
    AND je.status = 'posted';

  _gross_profit := _revenue - _cogs;
  _net_profit := _revenue - _expenses;

  SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) INTO _assets
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type = 'asset' AND je.entry_date <= _end_date AND je.status = 'posted';

  SELECT COALESCE(SUM(jel.credit_amount - jel.debit_amount), 0) INTO _liabilities
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type = 'liability' AND je.entry_date <= _end_date AND je.status = 'posted';

  SELECT COALESCE(SUM(jel.credit_amount - jel.debit_amount), 0) INTO _equity
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type = 'equity' AND je.entry_date <= _end_date AND je.status = 'posted';

  SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) INTO _cash
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE (coa.code LIKE '1100%' OR coa.code LIKE '1110%')
    AND je.entry_date <= _end_date AND je.status = 'posted';

  SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) INTO _ar
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '1200%' AND je.entry_date <= _end_date AND je.status = 'posted';

  SELECT COALESCE(SUM(jel.credit_amount - jel.debit_amount), 0) INTO _ap
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '2100%' AND je.entry_date <= _end_date AND je.status = 'posted';

  SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) INTO _inventory
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '1300%' AND je.entry_date <= _end_date AND je.status = 'posted';

  RETURN jsonb_build_object(
    'revenue', _revenue,
    'cogs', _cogs,
    'gross_profit', _gross_profit,
    'gross_margin_pct', CASE WHEN _revenue = 0 THEN 0 ELSE ROUND((_gross_profit / _revenue) * 100, 2) END,
    'expenses', _expenses,
    'net_profit', _net_profit,
    'net_margin_pct', CASE WHEN _revenue = 0 THEN 0 ELSE ROUND((_net_profit / _revenue) * 100, 2) END,
    'total_assets', _assets,
    'total_liabilities', _liabilities,
    'total_equity', _equity,
    'cash_balance', _cash,
    'accounts_receivable', _ar,
    'accounts_payable', _ap,
    'inventory_value', _inventory,
    'current_ratio', CASE WHEN _ap = 0 THEN NULL ELSE ROUND((_cash + _ar + _inventory) / _ap, 2) END,
    'debt_to_equity', CASE WHEN _equity = 0 THEN NULL ELSE ROUND(_liabilities / _equity, 2) END,
    'roa_pct', CASE WHEN _assets = 0 THEN 0 ELSE ROUND((_net_profit / _assets) * 100, 2) END,
    'roe_pct', CASE WHEN _equity = 0 THEN 0 ELSE ROUND((_net_profit / _equity) * 100, 2) END,
    'inventory_turnover', CASE WHEN _inventory = 0 THEN NULL ELSE ROUND(_cogs / _inventory, 2) END,
    'break_even_revenue', CASE
      WHEN _revenue = 0 OR (_revenue - _cogs) = 0 THEN NULL
      ELSE ROUND(_expenses / ((_revenue - _cogs) / _revenue), 2)
    END
  );
END;
$$;
