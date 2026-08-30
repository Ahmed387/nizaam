CREATE OR REPLACE FUNCTION public.expected_opening_cash(p_branch_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH last_shift AS (
    SELECT COALESCE(s.closing_cash, 0)::numeric AS closing_cash,
           COALESCE(s.closed_at, s.opened_at)    AS closed_at
    FROM public.cashier_shifts s
    WHERE s.branch_id = p_branch_id AND s.status <> 'open'
    ORDER BY s.closed_at DESC NULLS LAST
    LIMIT 1
  ),
  moves AS (
    SELECT COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 0)::numeric AS delta
    FROM public.treasury t
    WHERE t.branch_id = p_branch_id
      AND COALESCE(t.payment_method,'cash') = 'cash'
      AND (SELECT closed_at FROM last_shift) IS NOT NULL
      AND t.created_at >= (SELECT closed_at FROM last_shift)
  ),
  -- تحويلات خزنة مسجّلة رسمياً ولم تنعكس كسطر في جدول الخزنة (حماية من العجز الوهمي)
  transfers_out AS (
    SELECT COALESCE(SUM(tt.amount + COALESCE(tt.fee_amount,0)), 0)::numeric AS amt
    FROM public.treasury_transfers tt
    WHERE tt.from_branch_id = p_branch_id
      AND COALESCE(tt.payment_method,'cash') = 'cash'
      AND tt.rejected_at IS NULL
      AND (SELECT closed_at FROM last_shift) IS NOT NULL
      AND tt.created_at >= (SELECT closed_at FROM last_shift)
      AND NOT EXISTS (
        SELECT 1 FROM public.treasury t
        WHERE t.reference_id = tt.id AND t.branch_id = p_branch_id
      )
  ),
  transfers_in AS (
    SELECT COALESCE(SUM(tt.amount), 0)::numeric AS amt
    FROM public.treasury_transfers tt
    WHERE tt.to_branch_id = p_branch_id
      AND COALESCE(tt.payment_method,'cash') = 'cash'
      AND tt.rejected_at IS NULL
      AND tt.acknowledged_at IS NOT NULL
      AND (SELECT closed_at FROM last_shift) IS NOT NULL
      AND tt.acknowledged_at >= (SELECT closed_at FROM last_shift)
      AND NOT EXISTS (
        SELECT 1 FROM public.treasury t
        WHERE t.reference_id = tt.id AND t.branch_id = p_branch_id
      )
  )
  SELECT ROUND(
      COALESCE((SELECT closing_cash FROM last_shift), 0)
    + COALESCE((SELECT delta FROM moves), 0)
    + COALESCE((SELECT amt FROM transfers_in), 0)
    - COALESCE((SELECT amt FROM transfers_out), 0)
  , 2);
$function$;

GRANT EXECUTE ON FUNCTION public.expected_opening_cash(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_financial_kpis(date, date) TO authenticated, service_role;