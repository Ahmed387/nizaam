CREATE OR REPLACE FUNCTION public.shift_cash_movement(p_shift_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH s AS (
    SELECT branch_id, cashier_id, opened_at, COALESCE(closed_at, now()) AS closed_at
    FROM public.cashier_shifts WHERE id = p_shift_id
  )
  SELECT COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END),0)::NUMERIC
  FROM public.treasury t JOIN s ON true
  WHERE t.branch_id = s.branch_id
    AND COALESCE(t.payment_method,'cash') = 'cash'
    AND t.created_at >= s.opened_at
    AND t.created_at <  s.closed_at;
$function$;
REVOKE ALL ON FUNCTION public.shift_cash_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_cash_movement(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.close_cashier_shift(p_shift_id uuid, p_closing_cash numeric, p_notes text DEFAULT NULL::text, p_auto boolean DEFAULT false)
RETURNS cashier_shifts LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_row public.cashier_shifts;
  v_cash NUMERIC;
  v_move NUMERIC;
  v_expected NUMERIC;
BEGIN
  SELECT * INTO v_row FROM public.cashier_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية غير موجودة'; END IF;
  IF v_row.status <> 'open' THEN RAISE EXCEPTION 'الوردية مغلقة بالفعل'; END IF;
  IF v_row.tenant_id <> public.current_tenant_id() THEN
    RAISE EXCEPTION 'غير مسموح';
  END IF;
  IF NOT p_auto
     AND v_row.cashier_id <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'مسموح فقط لصاحب الوردية أو الأدمن';
  END IF;

  v_cash := public.shift_cash_sales(p_shift_id);
  v_move := public.shift_cash_movement(p_shift_id);
  v_expected := COALESCE(v_row.opening_cash,0) + COALESCE(v_move, COALESCE(v_cash,0));

  UPDATE public.cashier_shifts SET
    closed_at     = now(),
    closing_cash  = COALESCE(p_closing_cash,0),
    cash_sales    = v_cash,
    expected_cash = v_expected,
    variance      = COALESCE(p_closing_cash,0) - v_expected,
    close_notes   = p_notes,
    closed_by     = auth.uid(),
    status        = CASE WHEN p_auto THEN 'auto_closed' ELSE 'closed' END
  WHERE id = p_shift_id
  RETURNING * INTO v_row;

  RETURN v_row;
END $function$;