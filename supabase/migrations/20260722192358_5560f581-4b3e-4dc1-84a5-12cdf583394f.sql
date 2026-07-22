
CREATE OR REPLACE FUNCTION public.get_financial_kpis(_start_date date, _end_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tenant uuid := current_tenant_id();
  _revenue NUMERIC := 0;
  _cogs NUMERIC := 0;
  _opex NUMERIC := 0;
  _gross_profit NUMERIC := 0;
  _net_profit NUMERIC := 0;
  _gross_margin NUMERIC := 0;
  _net_margin NUMERIC := 0;
  _assets NUMERIC := 0;
  _liabilities NUMERIC := 0;
  _equity_gl NUMERIC := 0;
  _equity NUMERIC := 0;
  _cash NUMERIC := 0;
  _ar NUMERIC := 0;
  _ap NUMERIC := 0;
  _inventory NUMERIC := 0;
  _current_assets NUMERIC := 0;
  _current_liab NUMERIC := 0;
  _current_ratio NUMERIC;
  _quick_ratio NUMERIC;
  _debt_to_equity NUMERIC;
  _roa NUMERIC := 0;
  _roe NUMERIC := 0;
  _inv_turnover NUMERIC;
  _break_even NUMERIC;
BEGIN
  -- Revenue: 4xxx (net of returns), credit-normal
  SELECT COALESCE(SUM(jel.credit - jel.debit), 0) INTO _revenue
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type = 'revenue'
    AND je.status = 'posted'
    AND je.entry_date BETWEEN _start_date AND _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  -- COGS: strictly 5100
  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO _cogs
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code = '5100'
    AND je.status = 'posted'
    AND je.entry_date BETWEEN _start_date AND _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  -- Operating Expenses: all expense-type EXCEPT 5100
  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO _opex
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type = 'expense' AND coa.code <> '5100'
    AND je.status = 'posted'
    AND je.entry_date BETWEEN _start_date AND _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  _gross_profit := _revenue - _cogs;
  _net_profit := _gross_profit - _opex;
  _gross_margin := CASE WHEN _revenue > 0 THEN (_gross_profit / _revenue) * 100 ELSE 0 END;
  _net_margin := CASE WHEN _revenue > 0 THEN (_net_profit / _revenue) * 100 ELSE 0 END;

  -- Balance-sheet snapshots at _end_date
  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO _assets
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type='asset' AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  SELECT COALESCE(SUM(jel.credit - jel.debit), 0) INTO _liabilities
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type='liability' AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  SELECT COALESCE(SUM(jel.credit - jel.debit), 0) INTO _equity_gl
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type='equity' AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  -- Equity = GL equity + current-period NI (not yet closed)
  _equity := _equity_gl + _net_profit;

  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO _cash
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '1100%' AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO _ar
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '1200%' AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  SELECT COALESCE(SUM(jel.credit - jel.debit), 0) INTO _ap
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '2100%' AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO _inventory
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '1300%' AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  -- Current Assets/Liabilities (1xxx / 2xxx used as proxies)
  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO _current_assets
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '1%' AND coa.code NOT LIKE '15%' AND coa.code NOT LIKE '16%'
    AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  SELECT COALESCE(SUM(jel.credit - jel.debit), 0) INTO _current_liab
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '2%' AND coa.code NOT LIKE '25%' AND coa.code NOT LIKE '26%'
    AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  _current_ratio  := CASE WHEN _current_liab > 0 THEN _current_assets / _current_liab END;
  _quick_ratio    := CASE WHEN _current_liab > 0 THEN (_current_assets - _inventory) / _current_liab END;
  _debt_to_equity := CASE WHEN _equity > 0 THEN _liabilities / _equity END;
  _roa            := CASE WHEN _assets > 0 THEN (_net_profit / _assets) * 100 ELSE 0 END;
  _roe            := CASE WHEN _equity > 0 THEN (_net_profit / _equity) * 100 ELSE 0 END;
  _inv_turnover   := CASE WHEN _inventory > 0 THEN _cogs / _inventory END;
  _break_even     := CASE WHEN _gross_margin > 0 THEN _opex / (_gross_margin/100) END;

  RETURN jsonb_build_object(
    'revenue', _revenue,
    'cogs', _cogs,
    'expenses', _opex,
    'gross_profit', _gross_profit,
    'gross_margin_pct', _gross_margin,
    'net_profit', _net_profit,
    'net_margin_pct', _net_margin,
    'total_assets', _assets,
    'total_liabilities', _liabilities,
    'total_equity', _equity,
    'cash_balance', _cash,
    'accounts_receivable', _ar,
    'accounts_payable', _ap,
    'inventory_value', _inventory,
    'current_ratio', _current_ratio,
    'quick_ratio', _quick_ratio,
    'debt_to_equity', _debt_to_equity,
    'roa_pct', _roa,
    'roe_pct', _roe,
    'inventory_turnover', _inv_turnover,
    'break_even_revenue', _break_even
  );
END;
$function$;
