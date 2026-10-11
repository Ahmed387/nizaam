-- 0074 — Payroll worked out on the server (owner request 2026-10-11)
--   * The month is computed by the database, never trusted from the screen (employee_salary_preview):
--       base − absence deduction (only days recorded «غاب», «نص يوم», «بالساعة») + bonus − extra deduction
--       − advance instalment = net.  «إجازة» is a paid status; a day with nothing recorded is a normal paid day.
--   * pay_employee_salary recomputes the absence deduction itself; p_deductions is only the extra deduction.
--   * A paid salary can be cancelled safely (cancel_salary_payment): the till rows are reversed through
--     cancel_voucher, the advance instalments go back to the advances, the advance journal is reversed, and
--     the month can be paid again. Nothing is deleted.

ALTER TABLE public.salaries ADD COLUMN IF NOT EXISTS attendance_deduction numeric NOT NULL DEFAULT 0;
ALTER TABLE public.salaries ADD COLUMN IF NOT EXISTS attendance jsonb;
ALTER TABLE public.salaries ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.salaries ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.salaries ADD COLUMN IF NOT EXISTS cancelled_by uuid;
ALTER TABLE public.salaries ADD COLUMN IF NOT EXISTS cancel_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS salaries_one_active_per_month ON public.salaries(employee_id, month) WHERE status = 'active';

-- ---------------------------------------------------------------- the month of one employee
CREATE OR REPLACE FUNCTION public.employee_salary_preview(p_employee_id uuid, p_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp record; v_start date; v_end date; d date; v_today date := public.cairo_today();
  v_work int := 0; v_paid numeric := 0; v_hrs numeric := 8; v_base numeric; v_rate numeric; v_amount numeric;
  c_present int := 0; c_absent int := 0; c_leave int := 0; c_half int := 0; c_hourly int := 0; c_none int := 0;
  v_status text; v_hours numeric; v_working boolean; v_adv jsonb; v_paid_row jsonb;
BEGIN
  IF p_month !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'الشهر لازم يكون بالشكل YYYY-MM'; END IF;
  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
  IF v_emp.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  v_start := (p_month || '-01')::date;
  v_end := (v_start + interval '1 month - 1 day')::date;
  IF v_emp.work_start IS NOT NULL AND v_emp.work_end IS NOT NULL THEN
    v_hrs := extract(epoch FROM (v_emp.work_end - v_emp.work_start)) / 3600.0;
    IF v_hrs <= 0 THEN v_hrs := v_hrs + 24; END IF;
    v_hrs := greatest(1, round(v_hrs, 2));
  END IF;

  d := v_start;
  WHILE d <= v_end LOOP
    v_working := v_emp.work_days IS NULL OR jsonb_typeof(v_emp.work_days) <> 'array' OR jsonb_array_length(v_emp.work_days) = 0
                 OR v_emp.work_days @> to_jsonb(extract(dow FROM d)::int);
    SELECT a.status, a.hours INTO v_status, v_hours FROM public.attendance a
     WHERE a.employee_id = p_employee_id AND a.date = d ORDER BY a.created_at DESC LIMIT 1;
    IF v_status = 'late' THEN v_status := 'present'; END IF;
    IF v_working THEN v_work := v_work + 1; END IF;
    IF v_working OR v_status IS NOT NULL THEN
      IF v_status IS NULL THEN
        IF v_working THEN c_none := c_none + 1; v_paid := v_paid + 1; END IF;   -- nothing recorded = a normal day
      ELSIF v_status = 'present' THEN c_present := c_present + 1; v_paid := v_paid + 1;
      ELSIF v_status = 'leave' THEN c_leave := c_leave + 1; v_paid := v_paid + 1;  -- paid leave
      ELSIF v_status = 'absent' THEN c_absent := c_absent + 1;
      ELSIF v_status = 'half_day' THEN c_half := c_half + 1; v_paid := v_paid + 0.5;
      ELSIF v_status = 'hourly' THEN c_hourly := c_hourly + 1; v_paid := v_paid + least(1, coalesce(v_hours, 0) / v_hrs);
      END IF;
    END IF;
    v_status := NULL; v_hours := NULL;
    d := d + 1;
  END LOOP;

  v_base := coalesce(v_emp.base_salary, 0);
  v_rate := CASE WHEN v_work > 0 THEN v_base / v_work ELSE 0 END;
  v_amount := greatest(0, least(v_base, round(v_rate * least(v_paid, v_work), 2)));
  v_adv := public.employee_advance_due(p_employee_id);
  SELECT to_jsonb(s) INTO v_paid_row FROM public.salaries s
   WHERE s.employee_id = p_employee_id AND s.month = p_month AND s.status = 'active' LIMIT 1;

  RETURN jsonb_build_object(
    'employee_id', p_employee_id, 'name', v_emp.name, 'month', p_month,
    'base', v_base, 'work_days', v_work, 'paid_days', round(v_paid, 2), 'daily_rate', round(v_rate, 2),
    'counts', jsonb_build_object('present', c_present, 'absent', c_absent, 'leave', c_leave,
                                 'half_day', c_half, 'hourly', c_hourly, 'not_recorded', c_none),
    'attendance_deduction', round(v_base - v_amount, 2), 'attendance_amount', v_amount,
    'advance_due', coalesce((v_adv->>'due')::numeric, 0), 'advance_remaining', coalesce((v_adv->>'remaining')::numeric, 0),
    'paid', v_paid_row);
END $$;

-- ---------------------------------------------------------------- pay: the server decides the absence deduction
CREATE OR REPLACE FUNCTION public.pay_employee_salary(p_employee_id uuid, p_month text, p_bonuses numeric DEFAULT 0, p_deductions numeric DEFAULT 0, p_advance_deduct numeric DEFAULT 0, p_payment_method text DEFAULT 'cash'::text, p_reference_number text DEFAULT NULL::text, p_transfer_to_account text DEFAULT NULL::text, p_transfer_from_account text DEFAULT NULL::text, p_fee_amount numeric DEFAULT 0, p_notes text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_emp record; v_prev jsonb;
  v_base numeric; v_att_ded numeric; v_gross numeric; v_net numeric;
  v_bonuses numeric := round(coalesce(p_bonuses, 0), 2);
  v_ded numeric := round(coalesce(p_deductions, 0), 2);
  v_advded numeric := round(coalesce(p_advance_deduct, 0), 2);
  v_fee numeric := coalesce(p_fee_amount, 0);
  v_remaining numeric; v_due numeric; v_required numeric;
  v_salary_id uuid; v_take numeric; v_adv record;
  v_acc_salary uuid; v_acc_adv uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_month !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'الشهر لازم يكون بالشكل YYYY-MM'; END IF;
  IF v_bonuses < 0 OR v_ded < 0 OR v_advded < 0 THEN RAISE EXCEPTION 'قيم سالبة غير مسموحة'; END IF;

  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
  IF v_emp.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(v_user) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT (public.is_admin(v_user)
          OR (public.has_role(v_user,'branch_manager') AND public.user_in_branch(v_user, v_emp.branch_id))
          OR (public.has_role(v_user,'accountant') AND public.user_in_branch(v_user, v_emp.branch_id))) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF EXISTS (SELECT 1 FROM public.salaries WHERE employee_id = p_employee_id AND month = p_month AND status = 'active') THEN
    RAISE EXCEPTION 'راتب هذا الشهر مدفوع بالفعل — لو فيه غلط ألغِ الصرف الأول';
  END IF;

  v_prev := public.employee_salary_preview(p_employee_id, p_month);
  v_base := coalesce((v_prev->>'base')::numeric, 0);
  v_att_ded := coalesce((v_prev->>'attendance_deduction')::numeric, 0);
  v_gross := round(v_base - v_att_ded + v_bonuses - v_ded, 2);
  IF v_gross <= 0 THEN RAISE EXCEPTION 'إجمالي الراتب لازم يكون أكبر من صفر'; END IF;

  PERFORM 1 FROM public.advances WHERE employee_id = p_employee_id AND remaining > 0 FOR UPDATE;
  SELECT coalesce(sum(remaining), 0), coalesce(sum(least(remaining, coalesce(nullif(monthly_deduct, 0), remaining))), 0)
    INTO v_remaining, v_due FROM public.advances WHERE employee_id = p_employee_id AND remaining > 0;
  v_required := round(least(v_due, v_gross), 2);
  IF v_advded + 0.009 < v_required THEN
    RAISE EXCEPTION 'لازم تخصم قسط السلف المستحق الأول: % ج.م (المخصوم %)', v_required, v_advded;
  END IF;
  IF v_advded > v_remaining + 0.009 THEN RAISE EXCEPTION 'خصم السلف أكبر من الرصيد المتبقي (%)', v_remaining; END IF;
  IF v_advded > v_gross + 0.009 THEN RAISE EXCEPTION 'خصم السلف أكبر من إجمالي الراتب'; END IF;
  v_net := round(v_gross - v_advded, 2);
  -- transfer fee: computed on the server from the company's transfer_fees settings (H-08), never typed in
  v_fee := CASE WHEN v_net > 0 THEN public.calculate_payment_fee(p_payment_method, v_net) ELSE 0 END;

  INSERT INTO public.salaries(employee_id, month, base_salary, bonuses, deductions, attendance_deduction, attendance,
                              attendance_amount, advance_deduct, net_salary, paid_by, tenant_id, notes)
  VALUES (p_employee_id, p_month, v_base, v_bonuses, v_ded, v_att_ded, v_prev->'counts',
          (v_prev->>'attendance_amount')::numeric, v_advded, v_net, v_user, v_emp.tenant_id, nullif(p_notes, ''))
  RETURNING id INTO v_salary_id;

  IF v_advded > 0 THEN
    v_take := v_advded;
    FOR v_adv IN SELECT id, remaining FROM public.advances
                  WHERE employee_id = p_employee_id AND remaining > 0 ORDER BY created_at ASC FOR UPDATE LOOP
      EXIT WHEN v_take <= 0;
      DECLARE v_amt numeric := least(v_take, v_adv.remaining);
      BEGIN
        UPDATE public.advances SET remaining = remaining - v_amt WHERE id = v_adv.id;
        INSERT INTO public.advance_payments(advance_id, amount, month, tenant_id) VALUES (v_adv.id, v_amt, p_month, v_emp.tenant_id);
        v_take := v_take - v_amt;
      END;
    END LOOP;
    v_acc_salary := public.ensure_account(v_emp.tenant_id, '5200', 'Salaries Expense', 'expense'::account_type);
    v_acc_adv    := public.ensure_account(v_emp.tenant_id, '1450', 'Employee Advances', 'asset'::account_type);
    PERFORM public.post_journal_lines(v_emp.tenant_id, CURRENT_DATE,
      'خصم سلف من راتب ' || p_month || ' - ' || v_emp.name, 'salary', v_salary_id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_acc_salary, 'debit', v_advded, 'credit', 0, 'description', 'مصروف رواتب (الجزء المخصوم من السلف)'),
        jsonb_build_object('account_id', v_acc_adv, 'debit', 0, 'credit', v_advded, 'description', 'سداد سلف موظف')),
      v_emp.branch_id);
  END IF;

  IF v_net > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id,
                                payment_method, reference_number, transfer_to_account, transfer_from_account)
    VALUES (v_emp.branch_id, 'expense', 'salary', v_net,
            'راتب ' || p_month || ' - ' || v_emp.name || coalesce(' — ' || nullif(p_notes, ''), ''),
            v_salary_id, v_user, v_emp.tenant_id, p_payment_method, p_reference_number, p_transfer_to_account, p_transfer_from_account);
    IF v_fee > 0 THEN
      INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id, is_fee, payment_method)
      VALUES (v_emp.branch_id, 'expense', 'transfer_fee', v_fee, 'عمولة ' || p_payment_method || ' - راتب ' || v_emp.name,
              v_salary_id, v_user, v_emp.tenant_id, true, p_payment_method);
    END IF;
  END IF;

  RETURN v_salary_id;
END $function$;

-- ---------------------------------------------------------------- undo a salary payment (cancel-only)
CREATE OR REPLACE FUNCTION public.cancel_salary_payment(p_salary_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid(); s record; v_emp record; r record; v_back numeric := 0; v_left numeric; v_amt numeric; n_v int := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;
  SELECT * INTO s FROM public.salaries WHERE id = p_salary_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الصرف غير موجود'; END IF;
  IF s.status <> 'active' THEN RAISE EXCEPTION 'الصرف ملغي بالفعل'; END IF;
  SELECT * INTO v_emp FROM public.employees WHERE id = s.employee_id;
  IF s.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(v_user) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT (public.is_admin(v_user) OR public.is_super_admin(v_user)) THEN RAISE EXCEPTION 'إلغاء صرف المرتب للمدير بس'; END IF;

  -- 1) the money: every till row of this salary is reversed through its voucher
  FOR r IN SELECT v.id FROM public.treasury t JOIN public.vouchers v ON v.treasury_id = t.id
            WHERE t.reference_id = p_salary_id AND v.status = 'active' LOOP
    PERFORM public.cancel_voucher(r.id, 'إلغاء صرف مرتب ' || s.month || ' — ' || p_reason);
    n_v := n_v + 1;
  END LOOP;

  -- 2) the advances: the instalments taken by this salary go back (newest advance first)
  v_left := coalesce(s.advance_deduct, 0);
  FOR r IN SELECT ap.id, ap.advance_id, ap.amount FROM public.advance_payments ap JOIN public.advances a ON a.id = ap.advance_id
            WHERE a.employee_id = s.employee_id AND ap.month = s.month AND ap.amount > 0
            ORDER BY a.created_at DESC LOOP
    EXIT WHEN v_left <= 0;
    v_amt := least(v_left, r.amount);
    UPDATE public.advances SET remaining = remaining + v_amt WHERE id = r.advance_id;
    INSERT INTO public.advance_payments(advance_id, amount, month, tenant_id) VALUES (r.advance_id, -v_amt, s.month, s.tenant_id);
    v_left := v_left - v_amt; v_back := v_back + v_amt;
  END LOOP;
  IF coalesce(s.advance_deduct, 0) > 0 THEN
    PERFORM public.reverse_journal_for_source(s.tenant_id, 'salary', p_salary_id, 'إلغاء صرف مرتب');
  END IF;

  UPDATE public.salaries SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_user, cancel_reason = p_reason
   WHERE id = p_salary_id;
  INSERT INTO public.audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
  VALUES (v_user, (SELECT name FROM public.profiles WHERE id = v_user), v_emp.branch_id, 'CANCEL', 'salary', p_salary_id::text,
          jsonb_build_object('month', s.month, 'net', s.net_salary, 'advance_returned', v_back, 'reason', p_reason), s.tenant_id);
  RETURN jsonb_build_object('vouchers_cancelled', n_v, 'advance_returned', v_back);
END $$;

REVOKE ALL ON FUNCTION public.employee_salary_preview(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_salary_preview(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_salary_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_salary_payment(uuid, text) TO authenticated, service_role;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('employee_salary_preview', '0074', 'read: one employee month — base, absence deduction, advance due'),
  ('cancel_salary_payment', '0074', 'admin: undo a salary payment through cancel_voucher (cancel-only)')
ON CONFLICT DO NOTHING;
