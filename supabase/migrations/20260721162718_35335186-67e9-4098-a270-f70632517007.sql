
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
  SELECT period_start, period_end INTO _start, _end
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
