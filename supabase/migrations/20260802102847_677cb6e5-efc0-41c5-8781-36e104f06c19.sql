DO $$
DECLARE d text;
BEGIN
  -- 1) cancel_invoice_with_refund__impl: تجاهل الدفعات الملغية وعكوسها
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc
   WHERE proname = 'cancel_invoice_with_refund__impl' LIMIT 1;
  IF d IS NULL THEN RAISE EXCEPTION 'cancel_invoice_with_refund__impl not found'; END IF;
  IF position('SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = _invoice_id' in d) = 0 THEN
    RAISE EXCEPTION 'payment sum pattern not found';
  END IF;
  d := replace(d,
    'SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = _invoice_id',
    'SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = _invoice_id AND voided_at IS NULL AND reverses_payment_id IS NULL');
  EXECUTE d;

  -- 2) record_payment_transaction: منع الدفع الزائد + حالة جزئي
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc
   WHERE proname = 'record_payment_transaction' LIMIT 1;
  IF d IS NULL THEN RAISE EXCEPTION 'record_payment_transaction not found'; END IF;
  IF position('v_contact_id := CASE WHEN' in d) = 0 THEN
    RAISE EXCEPTION 'contact pattern not found';
  END IF;
  d := replace(d,
    '  v_contact_id := CASE WHEN',
    '  IF p_direction = ''in'' AND COALESCE(v_plan.remaining_amount, 0) > 0
     AND p_amount > COALESCE(v_plan.remaining_amount, 0) + 0.01 THEN
    RAISE EXCEPTION ''المبلغ (%) أكبر من المتبقي على الخطة (%)'', p_amount, v_plan.remaining_amount;
  END IF;

  v_contact_id := CASE WHEN');
  d := replace(d,
    'status = CASE WHEN COALESCE(paid_amount,0) + p_amount >= amount THEN ''paid'' ELSE ''pending'' END',
    'status = CASE WHEN COALESCE(paid_amount,0) + p_amount >= amount THEN ''paid''
                    WHEN COALESCE(paid_amount,0) + p_amount > 0 THEN ''partial''
                    ELSE ''pending'' END');
  EXECUTE d;

  -- 3) distribute_profits: احسب إجمالي المدين/الدائن للقيد بدل ما يفضل صفر
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc
   WHERE proname = 'distribute_profits' LIMIT 1;
  IF d IS NULL THEN RAISE EXCEPTION 'distribute_profits not found'; END IF;
  IF position('UPDATE public.journal_entries SET status = ''posted'' WHERE id = v_entry_id;' in d) = 0 THEN
    RAISE EXCEPTION 'post pattern not found';
  END IF;
  d := replace(d,
    'UPDATE public.journal_entries SET status = ''posted'' WHERE id = v_entry_id;',
    'UPDATE public.journal_entries je SET status = ''posted'',
       total_debit  = COALESCE((SELECT SUM(debit)  FROM public.journal_entry_lines WHERE entry_id = v_entry_id), 0),
       total_credit = COALESCE((SELECT SUM(credit) FROM public.journal_entry_lines WHERE entry_id = v_entry_id), 0)
     WHERE je.id = v_entry_id;');
  EXECUTE d;
END $$;

-- 4) قفل الوردية التلقائي: مقصور على النظام (service_role) فقط
CREATE OR REPLACE FUNCTION public.close_cashier_shift(p_shift_id uuid, p_closing_cash numeric, p_notes text DEFAULT NULL::text, p_auto boolean DEFAULT false)
 RETURNS cashier_shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.cashier_shifts;
  v_cash NUMERIC;
  v_move NUMERIC;
  v_expected NUMERIC;
  v_is_system BOOLEAN := (p_auto AND COALESCE(auth.role(), '') = 'service_role');
BEGIN
  SELECT * INTO v_row FROM public.cashier_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية غير موجودة'; END IF;
  IF v_row.status <> 'open' THEN RAISE EXCEPTION 'الوردية مغلقة بالفعل'; END IF;
  IF NOT v_is_system AND v_row.tenant_id <> public.current_tenant_id() THEN
    RAISE EXCEPTION 'غير مسموح';
  END IF;
  IF NOT v_is_system
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
    status        = CASE WHEN v_is_system THEN 'auto_closed' ELSE 'closed' END
  WHERE id = p_shift_id
  RETURNING * INTO v_row;

  RETURN v_row;
END $function$;

-- 5) منع التكرار
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_employee_date
  ON public.attendance (employee_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_advance_payments_advance_month
  ON public.advance_payments (advance_id, month);