-- 0269 payroll fixes (owner «نفذ» 2026-11-19).
--  P1  cancelling a salary that deducted an advance installment failed on uq_advance_payments_advance_month
--      → advance_payments.salary_id; one installment row per (advance, salary, direction).
--  P2  a status on a day off (Friday «إجازة» / «غياب») counted → only working days count.
--      A day off worked counts only when the owner marks it «يتحسب يوم شغل» (attendance.paid_extra):
--      one extra paid day at the daily rate, above the base. Otherwise he uses a bonus (owner answer).
--  P3  the salary expense sits on the LAST DAY of its own month (owner answer «أ»); the cash and the voucher
--      stay on the pay day: month end Dr 5200 / Cr 2300 «مصروفات مستحقة», pay day Dr 2300 / Cr 5200
--      (the voucher's own Dr 5200 / Cr cash nets it). A closed month or an early payment → the pay day.
--  P4  paying needs the switch «صرف المرتبات» (salaries.create) in the employee's branch.

CREATE OR REPLACE FUNCTION pg_temp.rep(p_fn regprocedure, p_old text, p_new text) RETURNS void LANGUAGE plpgsql AS $r$
DECLARE d text := pg_get_functiondef(p_fn);
BEGIN
  IF position(p_old IN d) = 0 THEN RAISE EXCEPTION 'anchor not found in %: %', p_fn, left(p_old, 80); END IF;
  EXECUTE replace(d, p_old, p_new);
END $r$;

-- P1
ALTER TABLE public.advance_payments ADD COLUMN IF NOT EXISTS salary_id uuid REFERENCES public.salaries(id);
DROP INDEX IF EXISTS public.uq_advance_payments_advance_month;
CREATE UNIQUE INDEX IF NOT EXISTS uq_advance_payments_salary
  ON public.advance_payments (advance_id, salary_id, (amount > 0)) WHERE salary_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_advance_payments_advance_month_old
  ON public.advance_payments (advance_id, month) WHERE salary_id IS NULL AND amount > 0;

-- P2
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS paid_extra boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.attendance.paid_extra IS
  'Day off worked that the owner counts as one extra paid day (0269). Ignored on a working day.';

-- P4 switch defaults (mirror DEFAULT_ROLE_PERMISSIONS in src/lib/roles.ts)
SELECT pg_temp.rep('public.role_permission_default(text,text)'::regprocedure,
  $$'doc_class.update','vessel_transfers.create','stock_count.create','stock_count.update'])$$,
  $$'doc_class.update','vessel_transfers.create','stock_count.create','stock_count.update','salaries.create'])$$);
SELECT pg_temp.rep('public.role_permission_default(text,text)'::regprocedure,
  $$'attendance.view','attendance.create','attendance.update',
      'reports.view'])
    WHEN 'cashier'$$,
  $$'attendance.view','attendance.create','attendance.update',
      'reports.view','salaries.create'])
    WHEN 'cashier'$$);

CREATE OR REPLACE FUNCTION public.employee_salary_preview(p_employee_id uuid, p_month text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp record; v_start date; v_end date; d date;
  v_work int := 0; v_paid numeric := 0; v_extra numeric := 0; v_hrs numeric := 8; v_base numeric; v_rate numeric;
  v_amount numeric; v_extra_amt numeric;
  c_present int := 0; c_absent int := 0; c_leave int := 0; c_half int := 0; c_hourly int := 0; c_none int := 0; c_off int := 0;
  v_status text; v_hours numeric; v_flag boolean; v_working boolean; v_unit numeric; v_adv jsonb; v_paid_row jsonb;
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
    SELECT a.status, a.hours, a.paid_extra INTO v_status, v_hours, v_flag FROM public.attendance a
     WHERE a.employee_id = p_employee_id AND a.date = d ORDER BY a.created_at DESC LIMIT 1;
    IF v_status = 'late' THEN v_status := 'present'; END IF;
    v_unit := CASE v_status WHEN 'present' THEN 1 WHEN 'leave' THEN 1 WHEN 'half_day' THEN 0.5
                            WHEN 'hourly' THEN least(1, coalesce(v_hours, 0) / v_hrs) ELSE 0 END;
    IF v_working THEN
      v_work := v_work + 1;
      IF v_status IS NULL THEN c_none := c_none + 1; v_paid := v_paid + 1;
      ELSE
        v_paid := v_paid + v_unit;
        IF v_status = 'present' THEN c_present := c_present + 1;
        ELSIF v_status = 'leave' THEN c_leave := c_leave + 1;
        ELSIF v_status = 'absent' THEN c_absent := c_absent + 1;
        ELSIF v_status = 'half_day' THEN c_half := c_half + 1;
        ELSIF v_status = 'hourly' THEN c_hourly := c_hourly + 1;
        END IF;
      END IF;
    ELSIF v_status IN ('present', 'half_day', 'hourly') AND coalesce(v_flag, false) THEN
      -- day off worked, counted by the owner as an extra paid day
      c_off := c_off + 1; v_extra := v_extra + v_unit;
    END IF;
    v_status := NULL; v_hours := NULL; v_flag := NULL;
    d := d + 1;
  END LOOP;

  v_base := coalesce(v_emp.base_salary, 0);
  v_rate := CASE WHEN v_work > 0 THEN v_base / v_work ELSE 0 END;
  v_amount := greatest(0, least(v_base, round(v_rate * least(v_paid, v_work), 2)));
  v_extra_amt := round(v_rate * v_extra, 2);
  v_adv := public.employee_advance_due(p_employee_id);
  SELECT to_jsonb(s) INTO v_paid_row FROM public.salaries s
   WHERE s.employee_id = p_employee_id AND s.month = p_month AND s.status = 'active' LIMIT 1;

  RETURN jsonb_build_object(
    'employee_id', p_employee_id, 'name', v_emp.name, 'month', p_month,
    'base', v_base, 'work_days', v_work, 'paid_days', round(v_paid, 2), 'daily_rate', round(v_rate, 2),
    'extra_days', round(v_extra, 2), 'extra_amount', v_extra_amt,
    'counts', jsonb_build_object('present', c_present, 'absent', c_absent, 'leave', c_leave,
                                 'half_day', c_half, 'hourly', c_hourly, 'not_recorded', c_none, 'day_off_worked', c_off),
    'attendance_deduction', round(v_base - v_amount, 2), 'attendance_amount', v_amount + v_extra_amt,
    'expense_date', CASE WHEN v_end < public.cairo_today() THEN v_end ELSE public.cairo_today() END,
    'advance_due', coalesce((v_adv->>'due')::numeric, 0), 'advance_remaining', coalesce((v_adv->>'remaining')::numeric, 0),
    'paid', v_paid_row,
    'adjustments', (SELECT jsonb_build_object(
        'bonus', coalesce(sum(a.amount) FILTER (WHERE a.kind = 'bonus'), 0),
        'penalty', coalesce(sum(a.amount) FILTER (WHERE a.kind = 'penalty'), 0),
        'items', coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'date', a.entry_date, 'kind', a.kind, 'amount', a.amount, 'reason', a.reason, 'salary_id', a.salary_id) ORDER BY a.entry_date, a.created_at), '[]'::jsonb))
      FROM public.employee_adjustments a
     WHERE a.employee_id = p_employee_id AND a.month = p_month AND a.status = 'active'));
END $function$;

CREATE OR REPLACE FUNCTION public.pay_employee_salary(p_employee_id uuid, p_month text, p_bonuses numeric DEFAULT 0, p_deductions numeric DEFAULT 0, p_advance_deduct numeric DEFAULT 0, p_payment_method text DEFAULT 'cash'::text, p_reference_number text DEFAULT NULL::text, p_transfer_to_account text DEFAULT NULL::text, p_transfer_from_account text DEFAULT NULL::text, p_fee_amount numeric DEFAULT 0, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_emp record; v_prev jsonb;
  v_base numeric; v_att_ded numeric; v_att_amt numeric; v_gross numeric; v_net numeric;
  v_bonuses numeric := round(coalesce(p_bonuses, 0), 2);
  v_ded numeric := round(coalesce(p_deductions, 0), 2);
  v_advded numeric := round(coalesce(p_advance_deduct, 0), 2);
  v_fee numeric := coalesce(p_fee_amount, 0);
  v_remaining numeric; v_due numeric; v_required numeric;
  v_salary_id uuid; v_take numeric; v_adv record;
  v_acc_salary uuid; v_acc_adv uuid; v_acc_accr uuid;
  v_adj_b numeric := 0; v_adj_p numeric := 0;
  v_today date := public.cairo_today(); v_end date; v_book date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_month !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'الشهر لازم يكون بالشكل YYYY-MM'; END IF;
  IF v_bonuses < 0 OR v_ded < 0 OR v_advded < 0 THEN RAISE EXCEPTION 'قيم سالبة غير مسموحة'; END IF;

  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
  IF v_emp.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(v_user) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT (public.is_admin(v_user) OR public.is_owner(v_user)
          OR (public.has_role(v_user,'branch_manager') AND public.user_in_branch(v_user, v_emp.branch_id))
          OR (public.has_role(v_user,'accountant') AND public.user_in_branch(v_user, v_emp.branch_id))) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  PERFORM public.require_switch('salaries.create', v_emp.branch_id, 'صرف المرتبات');
  IF EXISTS (SELECT 1 FROM public.salaries WHERE employee_id = p_employee_id AND month = p_month AND status = 'active') THEN
    RAISE EXCEPTION 'راتب هذا الشهر مدفوع بالفعل — لو فيه غلط ألغِ الصرف الأول';
  END IF;

  v_prev := public.employee_salary_preview(p_employee_id, p_month);
  v_base := coalesce((v_prev->>'base')::numeric, 0);
  v_att_ded := coalesce((v_prev->>'attendance_deduction')::numeric, 0);
  v_att_amt := coalesce((v_prev->>'attendance_amount')::numeric, 0);
  v_adj_b := coalesce((v_prev->'adjustments'->>'bonus')::numeric, 0);
  v_adj_p := coalesce((v_prev->'adjustments'->>'penalty')::numeric, 0);
  v_bonuses := v_bonuses + v_adj_b;
  v_ded := v_ded + v_adj_p;
  v_gross := round(v_att_amt + v_bonuses - v_ded, 2);
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
  v_fee := CASE WHEN v_net > 0 THEN public.calculate_payment_fee(p_payment_method, v_net) ELSE 0 END;

  -- P3: the expense day = last day of the salary month (pay day when paid early or that month is closed)
  v_end := ((p_month || '-01')::date + interval '1 month - 1 day')::date;
  v_book := v_today;
  IF v_end < v_today AND NOT EXISTS (SELECT 1 FROM public.fiscal_periods f WHERE f.tenant_id = v_emp.tenant_id
                                       AND f.status = 'closed' AND v_end BETWEEN f.period_start AND f.period_end) THEN
    v_book := v_end;
  END IF;

  INSERT INTO public.salaries(employee_id, month, base_salary, bonuses, deductions, attendance_deduction, attendance,
                              attendance_amount, advance_deduct, net_salary, paid_by, tenant_id, notes)
  VALUES (p_employee_id, p_month, v_base, v_bonuses, v_ded, v_att_ded,
          v_prev->'counts' || jsonb_build_object('extra_days', v_prev->'extra_days', 'extra_amount', v_prev->'extra_amount'),
          v_att_amt, v_advded, v_net, v_user, v_emp.tenant_id, nullif(p_notes, ''))
  RETURNING id INTO v_salary_id;
  UPDATE public.employee_adjustments SET salary_id = v_salary_id
   WHERE employee_id = p_employee_id AND month = p_month AND status = 'active' AND salary_id IS NULL;

  v_acc_salary := public.ensure_account(v_emp.tenant_id, '5200', 'Salaries Expense', 'expense'::account_type);
  IF v_advded > 0 THEN
    v_take := v_advded;
    FOR v_adv IN SELECT id, remaining FROM public.advances
                  WHERE employee_id = p_employee_id AND remaining > 0 ORDER BY created_at ASC FOR UPDATE LOOP
      EXIT WHEN v_take <= 0;
      DECLARE v_amt numeric := least(v_take, v_adv.remaining);
      BEGIN
        UPDATE public.advances SET remaining = remaining - v_amt WHERE id = v_adv.id;
        INSERT INTO public.advance_payments(advance_id, amount, month, tenant_id, salary_id)
        VALUES (v_adv.id, v_amt, p_month, v_emp.tenant_id, v_salary_id);
        v_take := v_take - v_amt;
      END;
    END LOOP;
    v_acc_adv := public.ensure_account(v_emp.tenant_id, '1450', 'Employee Advances', 'asset'::account_type);
    PERFORM public.post_journal_lines(v_emp.tenant_id, v_book,
      'خصم سلف من راتب ' || p_month || ' - ' || v_emp.name, 'salary', v_salary_id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_acc_salary, 'debit', v_advded, 'credit', 0, 'description', 'مصروف رواتب (الجزء المخصوم من السلف)'),
        jsonb_build_object('account_id', v_acc_adv, 'debit', 0, 'credit', v_advded, 'description', 'سداد سلف موظف')),
      v_emp.branch_id);
  END IF;

  IF v_net > 0 AND v_book < v_today THEN
    v_acc_accr := public.ensure_account(v_emp.tenant_id, '2300', 'Accrued Expenses', 'liability'::account_type);
    PERFORM public.post_journal_lines(v_emp.tenant_id, v_book,
      'استحقاق راتب ' || p_month || ' - ' || v_emp.name, 'salary', v_salary_id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_acc_salary, 'debit', v_net, 'credit', 0, 'description', 'مصروف رواتب ' || p_month),
        jsonb_build_object('account_id', v_acc_accr, 'debit', 0, 'credit', v_net, 'description', 'رواتب مستحقة')),
      v_emp.branch_id);
    PERFORM public.post_journal_lines(v_emp.tenant_id, v_today,
      'صرف راتب ' || p_month || ' المستحق - ' || v_emp.name, 'salary_pay', v_salary_id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_acc_accr, 'debit', v_net, 'credit', 0, 'description', 'سداد رواتب مستحقة'),
        jsonb_build_object('account_id', v_acc_salary, 'debit', 0, 'credit', v_net, 'description', 'المصروف متسجل في شهره ' || p_month)),
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

CREATE OR REPLACE FUNCTION public.cancel_salary_payment(p_salary_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF NOT (public.is_admin(v_user) OR public.is_owner(v_user) OR public.is_super_admin(v_user)) THEN RAISE EXCEPTION 'إلغاء صرف المرتب للمدير بس'; END IF;

  FOR r IN SELECT v.id FROM public.treasury t JOIN public.vouchers v ON v.treasury_id = t.id
            WHERE t.reference_id = p_salary_id AND v.status = 'active' LOOP
    PERFORM public.cancel_voucher(r.id, 'إلغاء صرف مرتب ' || s.month || ' — ' || p_reason);
    n_v := n_v + 1;
  END LOOP;

  v_left := coalesce(s.advance_deduct, 0);
  -- installments of THIS salary (0269); older salaries are found by month
  FOR r IN SELECT ap.id, ap.advance_id, ap.amount FROM public.advance_payments ap JOIN public.advances a ON a.id = ap.advance_id
            WHERE a.employee_id = s.employee_id AND ap.amount > 0
              AND (ap.salary_id = p_salary_id OR (ap.salary_id IS NULL AND ap.month = s.month
                   AND NOT EXISTS (SELECT 1 FROM public.advance_payments x WHERE x.salary_id = p_salary_id)))
            ORDER BY a.created_at DESC LOOP
    EXIT WHEN v_left <= 0;
    v_amt := least(v_left, r.amount);
    UPDATE public.advances SET remaining = remaining + v_amt WHERE id = r.advance_id;
    INSERT INTO public.advance_payments(advance_id, amount, month, tenant_id, salary_id)
    VALUES (r.advance_id, -v_amt, s.month, s.tenant_id, p_salary_id);
    v_left := v_left - v_amt; v_back := v_back + v_amt;
  END LOOP;

  -- the salary's own entries (advance part, month-end accrual, pay-day transfer) are reversed on their own day
  PERFORM set_config('app.reverse_on_original_date', '1', true);
  PERFORM public.reverse_journal_for_source(s.tenant_id, 'salary', p_salary_id, 'إلغاء صرف مرتب');
  PERFORM public.reverse_journal_for_source(s.tenant_id, 'salary_pay', p_salary_id, 'إلغاء صرف مرتب');
  PERFORM set_config('app.reverse_on_original_date', '', true);

  UPDATE public.employee_adjustments SET salary_id = NULL WHERE salary_id = p_salary_id;
  UPDATE public.salaries SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_user, cancel_reason = p_reason
   WHERE id = p_salary_id;
  INSERT INTO public.audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
  VALUES (v_user, (SELECT name FROM public.profiles WHERE id = v_user), v_emp.branch_id, 'CANCEL', 'salary', p_salary_id::text,
          jsonb_build_object('month', s.month, 'net', s.net_salary, 'advance_returned', v_back, 'reason', p_reason), s.tenant_id);
  RETURN jsonb_build_object('vouchers_cancelled', n_v, 'advance_returned', v_back);
END $function$;
