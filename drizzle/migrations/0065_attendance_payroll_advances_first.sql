-- 0065 — Attendance kinds + payroll with advances deducted first.
-- 1) attendance: half day and hourly attendance (hours worked), on top of present / late / absent / leave.
-- 2) pay_employee_salary:
--    * strict rule: the advance instalments due this month are deducted BEFORE net pay
--      (due = Σ min(remaining, monthly instalment) over open advances, capped at the gross pay);
--      paying with a smaller advance deduction is refused;
--    * the owner may pay more or less than the attendance figure — the UI sends the difference
--      as bonus / deduction, stored on the salary row;
--    * accounting fix: the salary voucher already posts Dr 5200 / Cr 1100 for the cash part,
--      so the function no longer posts a second cash entry (it was doubling salary expense);
--      the advance part is posted Dr 5200 Salaries / Cr 1450 Employee advances.
-- Same signature as before, so the screens keep working.

ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS hours numeric(5,2);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_status_kind_chk') THEN
    ALTER TABLE public.attendance ADD CONSTRAINT attendance_status_kind_chk
      CHECK (status IN ('present','late','absent','leave','half_day','hourly')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_hours_chk') THEN
    ALTER TABLE public.attendance ADD CONSTRAINT attendance_hours_chk
      CHECK (hours IS NULL OR (hours >= 0 AND hours <= 24)) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.salaries ADD COLUMN IF NOT EXISTS attendance_amount numeric(14,2);
ALTER TABLE public.salaries ADD COLUMN IF NOT EXISTS notes text;

/** Advance instalments due for an employee (what must be deducted before paying a salary). */
CREATE OR REPLACE FUNCTION public.employee_advance_due(p_employee_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'remaining', coalesce(sum(a.remaining), 0),
    'due',       coalesce(sum(least(a.remaining, coalesce(nullif(a.monthly_deduct, 0), a.remaining))), 0),
    'count',     count(*))
  FROM public.advances a
  JOIN public.employees e ON e.id = a.employee_id
  WHERE a.employee_id = p_employee_id AND a.remaining > 0
    AND (e.tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.employee_advance_due(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_advance_due(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pay_employee_salary(
  p_employee_id uuid, p_month text, p_bonuses numeric DEFAULT 0, p_deductions numeric DEFAULT 0,
  p_advance_deduct numeric DEFAULT 0, p_payment_method text DEFAULT 'cash', p_reference_number text DEFAULT NULL,
  p_transfer_to_account text DEFAULT NULL, p_transfer_from_account text DEFAULT NULL, p_fee_amount numeric DEFAULT 0,
  p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_emp record;
  v_base numeric; v_gross numeric; v_net numeric;
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
  IF EXISTS (SELECT 1 FROM public.salaries WHERE employee_id = p_employee_id AND month = p_month) THEN
    RAISE EXCEPTION 'راتب هذا الشهر مدفوع بالفعل';
  END IF;

  v_base  := coalesce(v_emp.base_salary, 0);
  v_gross := v_base + v_bonuses - v_ded;
  IF v_gross <= 0 THEN RAISE EXCEPTION 'إجمالي الراتب لازم يكون أكبر من صفر'; END IF;

  -- advances first (strict rule)
  PERFORM 1 FROM public.advances WHERE employee_id = p_employee_id AND remaining > 0 FOR UPDATE;
  SELECT coalesce(sum(remaining), 0),
         coalesce(sum(least(remaining, coalesce(nullif(monthly_deduct, 0), remaining))), 0)
    INTO v_remaining, v_due
    FROM public.advances WHERE employee_id = p_employee_id AND remaining > 0;
  v_required := round(least(v_due, v_gross), 2);
  IF v_advded + 0.009 < v_required THEN
    RAISE EXCEPTION 'لازم تخصم قسط السلف المستحق الأول: % ج.م (المخصوم %)', v_required, v_advded;
  END IF;
  IF v_advded > v_remaining + 0.009 THEN RAISE EXCEPTION 'خصم السلف أكبر من الرصيد المتبقي (%)', v_remaining; END IF;
  IF v_advded > v_gross + 0.009 THEN RAISE EXCEPTION 'خصم السلف أكبر من إجمالي الراتب'; END IF;
  v_net := round(v_gross - v_advded, 2);

  INSERT INTO public.salaries(employee_id, month, base_salary, bonuses, deductions, advance_deduct, net_salary, paid_by, tenant_id, notes)
  VALUES (p_employee_id, p_month, v_base, v_bonuses, v_ded, v_advded, v_net, v_user, v_emp.tenant_id, nullif(p_notes, ''))
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
    -- the advance part of the salary: expense recognised, receivable cleared (no cash moves)
    v_acc_salary := public.ensure_account(v_emp.tenant_id, '5200', 'Salaries Expense', 'expense'::account_type);
    v_acc_adv    := public.ensure_account(v_emp.tenant_id, '1450', 'Employee Advances', 'asset'::account_type);
    PERFORM public.post_journal_lines(v_emp.tenant_id, CURRENT_DATE,
      'خصم سلف من راتب ' || p_month || ' - ' || v_emp.name, 'salary', v_salary_id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_acc_salary, 'debit', v_advded, 'credit', 0, 'description', 'مصروف رواتب (الجزء المخصوم من السلف)'),
        jsonb_build_object('account_id', v_acc_adv, 'debit', 0, 'credit', v_advded, 'description', 'سداد سلف موظف')),
      v_emp.branch_id);
  END IF;

  -- cash part: the treasury row creates the salary voucher, which posts Dr 5200 / Cr 1100 itself
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
END $$;
REVOKE ALL ON FUNCTION public.pay_employee_salary(uuid, text, numeric, numeric, numeric, text, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_employee_salary(uuid, text, numeric, numeric, numeric, text, text, text, text, numeric, text) TO authenticated, service_role;

INSERT INTO public.security_rpc_allowlist(function_name, added_in, note)
VALUES ('employee_advance_due', '0065', 'read-only: open advances and the instalment due for one employee of the caller''s company')
ON CONFLICT DO NOTHING;
