-- 0224 — shifts table (owner 2026-11-15 «هل ده منظر منسق ومرتب؟» → «نفذ»): an OPEN shift showed «—» for cash sales and
-- expected cash until it was closed (they are stored by close_cashier_shift only), and the opening difference (what the
-- cashier counted − what the system expected) was nowhere on the row. Read only:
--   * v_shifts_history gets reported_opening_cash / expected_opening_cash (columns added at the end, nothing else changes);
--   * shift_live_figures(ids) — for the shifts the page shows: cash sales and the cash that moved in the drawer up to now,
--     and expected = opening + that movement — the same formula close_cashier_shift stores on closing
--     (opening_cash + coalesce(shift_cash_movement, shift_cash_sales)). Each shift goes through guard_read_shift.
-- Example 2026-11-15: سكة, open since 14/11 15:25 — 11 invoices, cash moved 8,000, opening counted 3,900 vs expected 0.
CREATE OR REPLACE VIEW public.v_shifts_history WITH (security_invoker = true) AS
 SELECT s.id, s.tenant_id, s.branch_id, s.cashier_id, s.opened_at, s.closed_at, s.opening_cash, s.closing_cash,
        s.expected_cash, s.cash_sales, s.variance, s.status, s.open_notes, s.close_notes, s.closed_by, s.created_at,
        s.updated_at, s.reminder_sent_at, s.pre_close_warned_at,
        b.name AS branch_name, p.name AS cashier_name, pc.name AS closed_by_name,
        s.reported_opening_cash, s.expected_opening_cash
   FROM cashier_shifts s
   LEFT JOIN branches b ON b.id = s.branch_id
   LEFT JOIN profiles p ON p.id = s.cashier_id
   LEFT JOIN profiles pc ON pc.id = s.closed_by;

CREATE OR REPLACE FUNCTION public.shift_live_figures(p_ids uuid[])
 RETURNS TABLE(shift_id uuid, cash_sales numeric, cash_movement numeric, expected_cash numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_open numeric; v_sales numeric; v_move numeric;
BEGIN
  FOREACH v_id IN ARRAY coalesce(p_ids[1:200], '{}') LOOP
    PERFORM public.guard_read_shift(v_id);
    SELECT opening_cash INTO v_open FROM cashier_shifts WHERE id = v_id;
    v_sales := public.shift_cash_sales__unguarded(v_id);
    v_move := public.shift_cash_movement(v_id);
    shift_id := v_id; cash_sales := v_sales; cash_movement := v_move;
    expected_cash := coalesce(v_open, 0) + coalesce(v_move, coalesce(v_sales, 0));
    RETURN NEXT;
  END LOOP;
END
$function$;
REVOKE ALL ON FUNCTION public.shift_live_figures(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_live_figures(uuid[]) TO authenticated;
INSERT INTO public.security_rpc_allowlist (function_name, added_in, note)
VALUES ('shift_live_figures', '0224', 'live cash sales / expected of shifts the page shows (guard_read_shift each)')
ON CONFLICT DO NOTHING;
