ALTER TABLE public.voucher_categories
  ADD COLUMN IF NOT EXISTS is_added_to_profit boolean NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW public.v_treasury_gl_variance
WITH (security_invoker = true) AS
WITH t AS (
  SELECT tr.tenant_id,
         tr.branch_id,
         SUM(CASE WHEN tr.type = 'income' THEN tr.amount ELSE -tr.amount END)::numeric AS treasury_balance
  FROM public.treasury tr
  GROUP BY tr.tenant_id, tr.branch_id
),
g AS (
  SELECT je.tenant_id,
         je.branch_id,
         SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0))::numeric AS gl_balance
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE COALESCE(je.status,'posted') = 'posted'
    AND coa.code LIKE '11%'
  GROUP BY je.tenant_id, je.branch_id
)
SELECT
  COALESCE(t.tenant_id, g.tenant_id)                       AS tenant_id,
  COALESCE(t.branch_id, g.branch_id)                       AS branch_id,
  b.name                                                   AS branch_name,
  COALESCE(t.treasury_balance, 0)                          AS treasury_balance,
  COALESCE(g.gl_balance, 0)                                AS gl_balance,
  ROUND(COALESCE(t.treasury_balance,0) - COALESCE(g.gl_balance,0), 2) AS variance
FROM t
FULL OUTER JOIN g
  ON g.tenant_id = t.tenant_id AND g.branch_id IS NOT DISTINCT FROM t.branch_id
LEFT JOIN public.branches b ON b.id = COALESCE(t.branch_id, g.branch_id);

GRANT SELECT ON public.v_treasury_gl_variance TO authenticated;
GRANT SELECT ON public.v_treasury_gl_variance TO service_role;