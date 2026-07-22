
-- Recompute partner totals & balance from partner_transactions (source of truth)
UPDATE public.equity_partners p
SET
  total_contributions = COALESCE(agg.contrib, 0),
  total_drawings      = COALESCE(agg.drawing, 0),
  total_profit_share  = COALESCE(agg.profit, 0),
  current_balance     = COALESCE(agg.contrib,0) - COALESCE(agg.drawing,0) + COALESCE(agg.profit,0) + COALESCE(agg.adjust,0)
FROM (
  SELECT
    partner_id,
    SUM(CASE WHEN transaction_type = 'contribution'      THEN amount ELSE 0 END) AS contrib,
    SUM(CASE WHEN transaction_type = 'drawing'           THEN amount ELSE 0 END) AS drawing,
    SUM(CASE WHEN transaction_type = 'profit_share'      THEN amount ELSE 0 END) AS profit,
    SUM(CASE WHEN transaction_type = 'capital_adjustment' THEN amount ELSE 0 END) AS adjust
  FROM public.partner_transactions
  GROUP BY partner_id
) agg
WHERE p.id = agg.partner_id;

-- Partners with zero transactions => zero out aggregates
UPDATE public.equity_partners p
SET total_contributions = 0, total_drawings = 0, total_profit_share = 0, current_balance = 0
WHERE NOT EXISTS (SELECT 1 FROM public.partner_transactions t WHERE t.partner_id = p.id);
