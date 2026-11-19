-- 0270 daily workers («يومية», owner 2026-11-19):
--  * employees.pay_type 'monthly' | 'daily' + daily_wage; daily_since = the day he became daily (pending starts there).
--  * A daily worker is paid at the end of EACH day: present 1, half day ½, hourly hours ÷ shift hours, late = present.
--    «إجازة» / «غياب» / a day off = nothing; a day off he worked and the owner marked «يتحسب يوم شغل زيادة» (0269
--    attendance.paid_extra) = paid. A working day with NO attendance record = «مستني» (pending) and the owner / admins
--    get a notification (cron «daily-wage-pending» 21:30 Cairo) — it is never paid until its attendance is recorded.
--  * pay_daily_wage: switch «صرف المرتبات», bonus / penalty of that day (employee_adjustments.entry_date = day) + extra,
--    optional advance deduction, till row category 'salary' → voucher → Dr 5200 / Cr cash on the pay day; a past day
--    puts the expense on ITS day (Dr 5200 / Cr 2300 there, Dr 2300 / Cr 5200 on the pay day — same as 0269).
--  * cancel_daily_wage (owner / admin): vouchers cancelled, advance back, entries reversed on their own day.
--  * pay_employee_salary refuses a daily worker (his pay is the daily wage).

CREATE OR REPLACE FUNCTION pg_temp.rep(p_fn regprocedure, p_old text, p_new text) RETURNS void LANGUAGE plpgsql AS $r$
DECLARE d text := pg_get_functiondef(p_fn);
BEGIN
  IF position(p_old IN d) = 0 THEN RAISE EXCEPTION 'anchor not found in %: %', p_fn, left(p_old, 80); END IF;
  EXECUTE replace(d, p_old, p_new);
END $r$;

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS pay_type text NOT NULL DEFAULT 'monthly';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS daily_wage numeric(12,2);
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS daily_since date;
DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_pay_type_chk') THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_pay_type_chk CHECK (pay_type IN ('monthly', 'daily'));
    ALTER TABLE public.employees ADD CONSTRAINT employees_daily_wage_chk CHECK (daily_wage IS NULL OR daily_wage >= 0);
  END IF;
END $c$;

CREATE OR REPLACE FUNCTION public.employees_daily_since_trg() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.pay_type = 'daily' AND (TG_OP = 'INSERT' OR OLD.pay_type IS DISTINCT FROM 'daily') THEN
    NEW.daily_since := coalesce(NEW.daily_since, public.cairo_today());
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER a0_employees_daily_since BEFORE INSERT OR UPDATE OF pay_type ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.employees_daily_since_trg();

-- one wage per employee per day
CREATE TABLE IF NOT EXISTS public.daily_wages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  day date NOT NULL,
  units numeric(6,3) NOT NULL,
  wage numeric(12,2) NOT NULL,
  amount numeric(12,2) NOT NULL,
  bonuses numeric(12,2) NOT NULL DEFAULT 0,
  deductions numeric(12,2) NOT NULL DEFAULT 0,
  advance_deduct numeric(12,2) NOT NULL DEFAULT 0,
  net numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  notes text,
  paid_by uuid, paid_at timestamptz NOT NULL DEFAULT now(),
  cancelled_by uuid, cancelled_at timestamptz, cancel_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_wages_one_active ON public.daily_wages (employee_id, day) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS daily_wages_branch_day ON public.daily_wages (branch_id, day DESC);
ALTER TABLE public.daily_wages ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.daily_wages FROM anon, authenticated;
GRANT SELECT ON public.daily_wages TO authenticated;
CREATE POLICY dw_read ON public.daily_wages FOR SELECT TO authenticated USING (
  (SELECT is_super_admin((SELECT auth.uid())))
  OR (tenant_id = (SELECT current_tenant_id()) AND (
        (SELECT is_admin((SELECT auth.uid())) OR is_owner((SELECT auth.uid())))
        OR (SELECT has_role((SELECT auth.uid()), 'viewer'::app_role))
        OR branch_id = ANY ((SELECT my_branch_ids())::uuid[])
        OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = daily_wages.employee_id AND e.user_id = (SELECT auth.uid())))));
CREATE POLICY suspended_block_write ON public.daily_wages AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT is_super_admin((SELECT auth.uid()))) OR NOT (SELECT current_tenant_is_suspended()))
  WITH CHECK ((SELECT is_super_admin((SELECT auth.uid()))) OR NOT (SELECT current_tenant_is_suspended()));
CREATE POLICY branch_paused_read ON public.daily_wages AS RESTRICTIVE FOR SELECT TO authenticated
  USING (branch_id IS NULL OR NOT (branch_id = ANY ((SELECT paused_branch_ids())::uuid[]))
         OR (SELECT is_super_admin((SELECT auth.uid()))) OR (SELECT (is_admin((SELECT auth.uid())) OR is_owner((SELECT auth.uid())))));
CREATE POLICY branch_paused_insert ON public.daily_wages AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (branch_id IS NULL OR NOT (branch_id = ANY ((SELECT paused_branch_ids())::uuid[])) OR (SELECT is_super_admin((SELECT auth.uid()))));
CREATE POLICY branch_paused_update ON public.daily_wages AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (branch_id IS NULL OR NOT (branch_id = ANY ((SELECT paused_branch_ids())::uuid[])) OR (SELECT is_super_admin((SELECT auth.uid()))))
  WITH CHECK (branch_id IS NULL OR NOT (branch_id = ANY ((SELECT paused_branch_ids())::uuid[])) OR (SELECT is_super_admin((SELECT auth.uid()))));
CREATE POLICY branch_paused_delete ON public.daily_wages AS RESTRICTIVE FOR DELETE TO authenticated
  USING (branch_id IS NULL OR NOT (branch_id = ANY ((SELECT paused_branch_ids())::uuid[])) OR (SELECT is_super_admin((SELECT auth.uid()))));
CREATE TRIGGER zz_block_hard_delete BEFORE DELETE ON public.daily_wages FOR EACH ROW EXECUTE FUNCTION public.block_hard_delete();

ALTER TABLE public.employee_adjustments ADD COLUMN IF NOT EXISTS daily_wage_id uuid REFERENCES public.daily_wages(id);
ALTER TABLE public.advance_payments ADD COLUMN IF NOT EXISTS daily_wage_id uuid REFERENCES public.daily_wages(id);
DROP INDEX IF EXISTS public.uq_advance_payments_advance_month_old;
CREATE UNIQUE INDEX IF NOT EXISTS uq_advance_payments_month_legacy
  ON public.advance_payments (advance_id, month) WHERE salary_id IS NULL AND daily_wage_id IS NULL AND amount > 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_advance_payments_daily
  ON public.advance_payments (advance_id, daily_wage_id, (amount > 0)) WHERE daily_wage_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.daily_pending_alerts (
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  day date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, day)
);
ALTER TABLE public.daily_pending_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_pending_alerts FROM anon, authenticated;

-- the day of a daily worker: what it pays (or why not)
CREATE OR REPLACE FUNCTION public.daily_wage_day(p_emp public.employees, p_day date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_working boolean; v_status text; v_hours numeric; v_flag boolean; v_hrs numeric := 8; v_units numeric := 0; v_state text;
BEGIN
  IF p_emp.work_start IS NOT NULL AND p_emp.work_end IS NOT NULL THEN
    v_hrs := extract(epoch FROM (p_emp.work_end - p_emp.work_start)) / 3600.0;
    IF v_hrs <= 0 THEN v_hrs := v_hrs + 24; END IF;
    v_hrs := greatest(1, round(v_hrs, 2));
  END IF;
  v_working := p_emp.work_days IS NULL OR jsonb_typeof(p_emp.work_days) <> 'array' OR jsonb_array_length(p_emp.work_days) = 0
               OR p_emp.work_days @> to_jsonb(extract(dow FROM p_day)::int);
  SELECT a.status, a.hours, a.paid_extra INTO v_status, v_hours, v_flag FROM public.attendance a
   WHERE a.employee_id = p_emp.id AND a.date = p_day ORDER BY a.created_at DESC LIMIT 1;
  IF v_status = 'late' THEN v_status := 'present'; END IF;
  v_units := CASE v_status WHEN 'present' THEN 1 WHEN 'half_day' THEN 0.5
                           WHEN 'hourly' THEN least(1, coalesce(v_hours, 0) / v_hrs) ELSE 0 END;
  IF NOT v_working AND NOT (coalesce(v_flag, false) AND v_units > 0) THEN v_units := 0; END IF;
  v_state := CASE WHEN v_status IS NULL AND v_working THEN 'no_attendance'
                  WHEN v_status IS NULL THEN 'day_off'
                  WHEN v_units > 0 THEN 'payable'
                  ELSE 'nothing' END;
  RETURN jsonb_build_object('day', p_day, 'working', v_working, 'status', v_status, 'hours', v_hours,
    'paid_extra', coalesce(v_flag, false), 'units', round(v_units, 3), 'state', v_state);
END $f$;
REVOKE ALL ON FUNCTION public.daily_wage_day(public.employees, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.daily_wage_preview(p_employee_id uuid, p_day date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_emp public.employees; d jsonb; v_wage numeric; v_amt numeric; v_paid jsonb; v_adv jsonb;
BEGIN
  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
  IF v_emp.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  PERFORM public.assert_read_access(v_emp.branch_id, 'employees.view');
  d := public.daily_wage_day(v_emp, p_day);
  v_wage := coalesce(v_emp.daily_wage, 0);
  v_amt := round(v_wage * (d->>'units')::numeric, 2);
  v_adv := public.employee_advance_due(p_employee_id);
  SELECT to_jsonb(w) INTO v_paid FROM public.daily_wages w WHERE w.employee_id = p_employee_id AND w.day = p_day AND w.status = 'active';
  RETURN d || jsonb_build_object('employee_id', p_employee_id, 'name', v_emp.name, 'pay_type', v_emp.pay_type,
    'daily_wage', v_wage, 'amount', v_amt, 'paid', v_paid,
    'advance_remaining', coalesce((v_adv->>'remaining')::numeric, 0),
    'adjustments', (SELECT jsonb_build_object(
        'bonus', coalesce(sum(a.amount) FILTER (WHERE a.kind = 'bonus'), 0),
        'penalty', coalesce(sum(a.amount) FILTER (WHERE a.kind = 'penalty'), 0),
        'items', coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'date', a.entry_date, 'kind', a.kind, 'amount', a.amount, 'reason', a.reason) ORDER BY a.created_at), '[]'::jsonb))
      FROM public.employee_adjustments a
     WHERE a.employee_id = p_employee_id AND a.entry_date = p_day AND a.status = 'active'
       AND a.salary_id IS NULL AND (a.daily_wage_id IS NULL OR a.daily_wage_id = (v_paid->>'id')::uuid)));
END $f$;

CREATE OR REPLACE FUNCTION public.pay_daily_wage(p_employee_id uuid, p_day date, p_bonuses numeric DEFAULT 0, p_deductions numeric DEFAULT 0,
  p_advance_deduct numeric DEFAULT 0, p_payment_method text DEFAULT 'cash', p_reference_number text DEFAULT NULL,
  p_transfer_to_account text DEFAULT NULL, p_transfer_from_account text DEFAULT NULL, p_notes text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE
  v_user uuid := auth.uid(); v_emp public.employees; d jsonb; v_id uuid; v_today date := public.cairo_today(); v_book date;
  v_wage numeric; v_amt numeric; v_b numeric; v_p numeric; v_gross numeric; v_net numeric; v_fee numeric;
  v_adv numeric := round(coalesce(p_advance_deduct, 0), 2); v_rem numeric; v_take numeric; r record;
  v_acc_sal uuid; v_acc_adv uuid; v_acc_accr uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF coalesce(p_bonuses, 0) < 0 OR coalesce(p_deductions, 0) < 0 OR v_adv < 0 THEN RAISE EXCEPTION 'قيم سالبة غير مسموحة'; END IF;
  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
  IF v_emp.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(v_user) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT (public.is_admin(v_user) OR public.is_owner(v_user)
          OR (public.has_role(v_user, 'branch_manager') AND public.user_in_branch(v_user, v_emp.branch_id))
          OR (public.has_role(v_user, 'accountant') AND public.user_in_branch(v_user, v_emp.branch_id))) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  PERFORM public.require_switch('salaries.create', v_emp.branch_id, 'صرف المرتبات');
  IF v_emp.pay_type <> 'daily' THEN RAISE EXCEPTION 'الموظف ده بيقبض شهري — اصرفله من «صرف المرتب»'; END IF;
  IF coalesce(v_emp.daily_wage, 0) <= 0 THEN RAISE EXCEPTION 'اكتب أجر اليوم للموظف ده الأول (صفحة الموظف ← البيانات)'; END IF;
  IF p_day IS NULL OR p_day > v_today THEN RAISE EXCEPTION 'مينفعش تصرف يومية ليوم لسه مجاش'; END IF;
  IF EXISTS (SELECT 1 FROM public.daily_wages WHERE employee_id = p_employee_id AND day = p_day AND status = 'active') THEN
    RAISE EXCEPTION 'يومية اليوم ده اتصرفت بالفعل — لو فيه غلط ألغيها الأول';
  END IF;
  d := public.daily_wage_day(v_emp, p_day);
  IF d->>'state' = 'no_attendance' THEN RAISE EXCEPTION 'سجّل حضور اليوم ده الأول — اليوم مستني'; END IF;
  v_wage := v_emp.daily_wage;
  v_amt := round(v_wage * (d->>'units')::numeric, 2);
  SELECT coalesce(sum(amount) FILTER (WHERE kind = 'bonus'), 0), coalesce(sum(amount) FILTER (WHERE kind = 'penalty'), 0)
    INTO v_b, v_p FROM public.employee_adjustments
   WHERE employee_id = p_employee_id AND entry_date = p_day AND status = 'active' AND salary_id IS NULL AND daily_wage_id IS NULL;
  v_b := round(v_b + coalesce(p_bonuses, 0), 2);
  v_p := round(v_p + coalesce(p_deductions, 0), 2);
  v_gross := round(v_amt + v_b - v_p, 2);
  IF v_gross <= 0 THEN RAISE EXCEPTION 'مفيش أجر لليوم ده (الحالة: %)', coalesce(d->>'status', 'إجازة'); END IF;
  SELECT coalesce(sum(remaining), 0) INTO v_rem FROM public.advances WHERE employee_id = p_employee_id AND remaining > 0;
  IF v_adv > v_rem + 0.009 THEN RAISE EXCEPTION 'خصم السلف أكبر من الرصيد المتبقي (%)', v_rem; END IF;
  IF v_adv > v_gross + 0.009 THEN RAISE EXCEPTION 'خصم السلف أكبر من اليومية'; END IF;
  v_net := round(v_gross - v_adv, 2);
  v_fee := CASE WHEN v_net > 0 THEN public.calculate_payment_fee(p_payment_method, v_net) ELSE 0 END;
  v_book := p_day;
  IF EXISTS (SELECT 1 FROM public.fiscal_periods f WHERE f.tenant_id = v_emp.tenant_id AND f.status = 'closed'
              AND p_day BETWEEN f.period_start AND f.period_end) THEN v_book := v_today; END IF;

  INSERT INTO public.daily_wages(tenant_id, branch_id, employee_id, day, units, wage, amount, bonuses, deductions,
                                 advance_deduct, net, notes, paid_by)
  VALUES (v_emp.tenant_id, v_emp.branch_id, p_employee_id, p_day, (d->>'units')::numeric, v_wage, v_amt, v_b, v_p,
          v_adv, v_net, nullif(trim(p_notes), ''), v_user)
  RETURNING id INTO v_id;
  UPDATE public.employee_adjustments SET daily_wage_id = v_id
   WHERE employee_id = p_employee_id AND entry_date = p_day AND status = 'active' AND salary_id IS NULL AND daily_wage_id IS NULL;

  v_acc_sal := public.ensure_account(v_emp.tenant_id, '5200', 'Salaries Expense', 'expense'::account_type);
  IF v_adv > 0 THEN
    v_take := v_adv;
    FOR r IN SELECT id, remaining FROM public.advances WHERE employee_id = p_employee_id AND remaining > 0 ORDER BY created_at FOR UPDATE LOOP
      EXIT WHEN v_take <= 0;
      UPDATE public.advances SET remaining = remaining - least(v_take, r.remaining) WHERE id = r.id;
      INSERT INTO public.advance_payments(advance_id, amount, month, tenant_id, daily_wage_id)
      VALUES (r.id, least(v_take, r.remaining), to_char(p_day, 'YYYY-MM'), v_emp.tenant_id, v_id);
      v_take := v_take - least(v_take, r.remaining);
    END LOOP;
    v_acc_adv := public.ensure_account(v_emp.tenant_id, '1450', 'Employee Advances', 'asset'::account_type);
    PERFORM public.post_journal_lines(v_emp.tenant_id, v_book, 'خصم سلف من يومية ' || p_day || ' - ' || v_emp.name,
      'daily_wage', v_id, jsonb_build_array(
        jsonb_build_object('account_id', v_acc_sal, 'debit', v_adv, 'credit', 0, 'description', 'يومية (الجزء المخصوم من السلف)'),
        jsonb_build_object('account_id', v_acc_adv, 'debit', 0, 'credit', v_adv, 'description', 'سداد سلف موظف')), v_emp.branch_id);
  END IF;
  IF v_net > 0 AND v_book < v_today THEN
    v_acc_accr := public.ensure_account(v_emp.tenant_id, '2300', 'Accrued Expenses', 'liability'::account_type);
    PERFORM public.post_journal_lines(v_emp.tenant_id, v_book, 'استحقاق يومية ' || p_day || ' - ' || v_emp.name,
      'daily_wage', v_id, jsonb_build_array(
        jsonb_build_object('account_id', v_acc_sal, 'debit', v_net, 'credit', 0, 'description', 'يومية ' || p_day),
        jsonb_build_object('account_id', v_acc_accr, 'debit', 0, 'credit', v_net, 'description', 'رواتب مستحقة')), v_emp.branch_id);
    PERFORM public.post_journal_lines(v_emp.tenant_id, v_today, 'صرف يومية ' || p_day || ' المستحقة - ' || v_emp.name,
      'daily_wage_pay', v_id, jsonb_build_array(
        jsonb_build_object('account_id', v_acc_accr, 'debit', v_net, 'credit', 0, 'description', 'سداد رواتب مستحقة'),
        jsonb_build_object('account_id', v_acc_sal, 'debit', 0, 'credit', v_net, 'description', 'المصروف متسجل يوم ' || p_day)), v_emp.branch_id);
  END IF;
  IF v_net > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id,
                                payment_method, reference_number, transfer_to_account, transfer_from_account)
    VALUES (v_emp.branch_id, 'expense', 'salary', v_net,
            'يومية ' || to_char(p_day, 'DD/MM') || ' - ' || v_emp.name || coalesce(' — ' || nullif(trim(p_notes), ''), ''),
            v_id, v_user, v_emp.tenant_id, p_payment_method, p_reference_number, p_transfer_to_account, p_transfer_from_account);
    IF v_fee > 0 THEN
      INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id, is_fee, payment_method)
      VALUES (v_emp.branch_id, 'expense', 'transfer_fee', v_fee, 'عمولة ' || p_payment_method || ' - يومية ' || v_emp.name,
              v_id, v_user, v_emp.tenant_id, true, p_payment_method);
    END IF;
  END IF;
  DELETE FROM public.daily_pending_alerts WHERE employee_id = p_employee_id AND day = p_day;
  RETURN v_id;
END $f$;

CREATE OR REPLACE FUNCTION public.cancel_daily_wage(p_id uuid, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_user uuid := auth.uid(); w record; r record; n_v int := 0; v_back numeric := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;
  SELECT * INTO w FROM public.daily_wages WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'اليومية مش موجودة'; END IF;
  IF w.status <> 'active' THEN RAISE EXCEPTION 'اليومية ملغية بالفعل'; END IF;
  IF w.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(v_user) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT (public.is_admin(v_user) OR public.is_owner(v_user) OR public.is_super_admin(v_user)) THEN RAISE EXCEPTION 'إلغاء اليومية للمدير بس'; END IF;
  FOR r IN SELECT v.id FROM public.treasury t JOIN public.vouchers v ON v.treasury_id = t.id
            WHERE t.reference_id = p_id AND v.status = 'active' LOOP
    PERFORM public.cancel_voucher(r.id, 'إلغاء يومية ' || w.day || ' — ' || p_reason);
    n_v := n_v + 1;
  END LOOP;
  FOR r IN SELECT advance_id, amount FROM public.advance_payments WHERE daily_wage_id = p_id AND amount > 0 LOOP
    UPDATE public.advances SET remaining = remaining + r.amount WHERE id = r.advance_id;
    INSERT INTO public.advance_payments(advance_id, amount, month, tenant_id, daily_wage_id)
    VALUES (r.advance_id, -r.amount, to_char(w.day, 'YYYY-MM'), w.tenant_id, p_id);
    v_back := v_back + r.amount;
  END LOOP;
  PERFORM set_config('app.reverse_on_original_date', '1', true);
  PERFORM public.reverse_journal_for_source(w.tenant_id, 'daily_wage', p_id, 'إلغاء يومية');
  PERFORM public.reverse_journal_for_source(w.tenant_id, 'daily_wage_pay', p_id, 'إلغاء يومية');
  PERFORM set_config('app.reverse_on_original_date', '', true);
  UPDATE public.employee_adjustments SET daily_wage_id = NULL WHERE daily_wage_id = p_id;
  UPDATE public.daily_wages SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_user, cancel_reason = p_reason WHERE id = p_id;
  INSERT INTO public.audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
  VALUES (v_user, (SELECT name FROM public.profiles WHERE id = v_user), w.branch_id, 'CANCEL', 'daily_wage', p_id::text,
          jsonb_build_object('day', w.day, 'net', w.net, 'advance_returned', v_back, 'reason', p_reason), w.tenant_id);
  RETURN jsonb_build_object('vouchers_cancelled', n_v, 'advance_returned', v_back);
END $f$;

-- days of daily workers still waiting: no attendance on a working day, or payable and not paid
CREATE OR REPLACE FUNCTION public.daily_wage_pending(p_branch uuid DEFAULT NULL, p_employee uuid DEFAULT NULL)
 RETURNS TABLE(employee_id uuid, name text, branch_id uuid, day date, state text, status text, units numeric, amount numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE e public.employees; dd date; d jsonb; v_today date := public.cairo_today();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_branch IS NOT NULL THEN PERFORM public.assert_read_access(p_branch, 'employees.view'); END IF;
  FOR e IN SELECT * FROM public.employees x
            WHERE x.tenant_id = public.current_tenant_id() AND x.is_active AND x.pay_type = 'daily'
              AND (p_branch IS NULL OR x.branch_id = p_branch) AND (p_employee IS NULL OR x.id = p_employee)
              AND (public.is_admin(auth.uid()) OR public.is_owner(auth.uid()) OR public.user_reads_branch(auth.uid(), x.branch_id))
            ORDER BY x.name LOOP
    dd := greatest(coalesce(e.daily_since, v_today), coalesce(e.hire_date, '2000-01-01'::date), v_today - 60);
    WHILE dd <= v_today LOOP
      IF NOT EXISTS (SELECT 1 FROM public.daily_wages w WHERE w.employee_id = e.id AND w.day = dd AND w.status = 'active') THEN
        d := public.daily_wage_day(e, dd);
        IF d->>'state' IN ('no_attendance', 'payable') THEN
          employee_id := e.id; name := e.name; branch_id := e.branch_id; day := dd; state := d->>'state';
          status := d->>'status'; units := (d->>'units')::numeric; amount := round(coalesce(e.daily_wage, 0) * units, 2);
          RETURN NEXT;
        END IF;
      END IF;
      dd := dd + 1;
    END LOOP;
  END LOOP;
END $f$;

-- 21:30 Cairo: a daily worker with no attendance on a working day → one notification per employee / day to owner + admins
CREATE OR REPLACE FUNCTION public.notify_daily_pending()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE e public.employees; dd date; d jsonb; n int := 0; v_today date := public.cairo_today();
BEGIN
  FOR e IN SELECT * FROM public.employees WHERE is_active AND pay_type = 'daily' LOOP
    FOR dd IN SELECT g::date FROM generate_series(greatest(v_today - 2, coalesce(e.daily_since, v_today)), v_today, interval '1 day') g LOOP
      d := public.daily_wage_day(e, dd);
      IF d->>'state' = 'no_attendance'
         AND NOT EXISTS (SELECT 1 FROM public.daily_pending_alerts a WHERE a.employee_id = e.id AND a.day = dd) THEN
        INSERT INTO public.daily_pending_alerts(employee_id, day) VALUES (e.id, dd);
        INSERT INTO public.notifications (tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
        SELECT e.tenant_id, u.user_id, '⏳ يومية مستنية: ' || e.name,
               'حضور يوم ' || to_char(dd, 'DD/MM') || ' مش متسجل — سجّله عشان تصرف اليومية',
               'daily_pending', '/admin/employees/' || e.id, 'employees', e.id
          FROM (SELECT DISTINCT ur.user_id FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
                 WHERE p.tenant_id = e.tenant_id AND ur.role::text IN ('owner', 'admin')) u;
        n := n + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN n;
END $f$;
REVOKE ALL ON FUNCTION public.notify_daily_pending() FROM PUBLIC, anon, authenticated;

-- a daily worker is not paid by month
SELECT pg_temp.rep('public.pay_employee_salary(uuid,text,numeric,numeric,numeric,text,text,text,text,numeric,text)'::regprocedure,
  $$PERFORM public.require_switch('salaries.create', v_emp.branch_id, 'صرف المرتبات');$$,
  $$PERFORM public.require_switch('salaries.create', v_emp.branch_id, 'صرف المرتبات');
  IF v_emp.pay_type = 'daily' THEN RAISE EXCEPTION 'الموظف ده بيقبض يومي — اصرفله «اليومية» من صفحته أو من الحضور'; END IF;$$);

SELECT pg_temp.rep('public.background_jobs_status__all(uuid)'::regprocedure,
  $$('job-failure-alerts',         'تنبيهات المهام الأوتوماتيك',         'هتتعاد لوحدها بعد ربع ساعة')$$,
  $$('job-failure-alerts',         'تنبيهات المهام الأوتوماتيك',         'هتتعاد لوحدها بعد ربع ساعة'),
    ('daily-wage-pending',         'تنبيه اليوميات المستنية',              'هيتعاد لوحده بكره بالليل')$$);

REVOKE ALL ON FUNCTION public.daily_wage_preview(uuid, date), public.pay_daily_wage(uuid, date, numeric, numeric, numeric, text, text, text, text, text),
  public.cancel_daily_wage(uuid, text), public.daily_wage_pending(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_wage_preview(uuid, date), public.pay_daily_wage(uuid, date, numeric, numeric, numeric, text, text, text, text, text),
  public.cancel_daily_wage(uuid, text), public.daily_wage_pending(uuid, uuid) TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('daily_wage_preview', '0270', 'يومية: حساب اليوم'), ('pay_daily_wage', '0270', 'صرف يومية'),
  ('cancel_daily_wage', '0270', 'إلغاء يومية'), ('daily_wage_pending', '0270', 'اليوميات المستنية')
ON CONFLICT DO NOTHING;

SELECT cron.schedule('daily-wage-pending', '30 19 * * *', $$SELECT public.notify_daily_pending()$$);
