CREATE OR REPLACE VIEW public.v_treasury_balances
WITH (security_invoker=true) AS
SELECT
  b.id AS branch_id,
  b.tenant_id,
  b.name AS branch_name,
  COALESCE(SUM(jel.debit), 0) AS total_receipts,
  COALESCE(SUM(jel.credit), 0) AS total_payments,
  COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0) AS current_balance,
  MAX(je.created_at) AS last_transaction_date
FROM public.branches b
LEFT JOIN public.journal_entries je
  ON je.branch_id = b.id
  AND je.tenant_id = b.tenant_id
  AND je.status = 'posted'
LEFT JOIN public.journal_entry_lines jel
  ON jel.entry_id = je.id
LEFT JOIN public.chart_of_accounts ca
  ON ca.id = jel.account_id
  AND ca.tenant_id = je.tenant_id
  AND ca.code LIKE '11%'
GROUP BY b.id, b.tenant_id, b.name;

GRANT SELECT ON public.v_treasury_balances TO authenticated, anon;