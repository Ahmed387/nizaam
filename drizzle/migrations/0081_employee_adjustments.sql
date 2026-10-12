-- 0081 — Bonus / penalty during the month (owner request 2026-10-12).
--
-- The owner records a bonus («بونص») or a penalty («جزاء») on an employee any day of the month; nothing moves
-- in the till then. When the month's salary is paid, every active entry of that month is added to (bonus) or
-- taken from (penalty) the salary, inside the same salary payment — so it reaches the salary voucher, the till,
-- the salary expense and every report through the salary, once. Cancelling the salary frees the entries again.
--   * employee_adjustments: one row per entry, cancel-only (status), linked to the salary that used it.
--   * add_employee_adjustment / cancel_employee_adjustment: the only write paths (no client grant).
--   * employee_salary_preview adds 'adjustments' {bonus, penalty, items}; pay_employee_salary adds them to the
--     salary (bonuses / deductions columns hold manual + recorded) and links them; cancel_salary_payment unlinks.

CREATE TABLE IF NOT EXISTS public.employee_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid REFERENCES public.branches(id),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  month text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  entry_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('bonus', 'penalty')),
  amount numeric NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  salary_id uuid REFERENCES public.salaries(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text
);
CREATE INDEX IF NOT EXISTS employee_adjustments_emp_month_idx ON public.employee_adjustments(employee_id, month) WHERE status = 'active';
ALTER TABLE public.employee_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_adjustments FROM anon, authenticated;
GRANT SELECT ON public.employee_adjustments TO authenticated;
DROP POLICY IF EXISTS emp_adj_read ON public.employee_adjustments;
CREATE POLICY emp_adj_read ON public.employee_adjustments FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id() AS t)
         AND ((SELECT public.is_admin((SELECT auth.uid() AS uid)) AS f)
              OR COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) = ANY ((SELECT public.my_branch_ids() AS ub)::uuid[])));

CREATE OR REPLACE FUNCTION public.add_employee_adjustment(p_employee_id uuid, p_kind text, p_amount numeric, p_reason text, p_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_emp record; v_date date := coalesce(p_date, public.cairo_today()); v_month text; v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_kind NOT IN ('bonus', 'penalty') THEN RAISE EXCEPTION 'النوع لازم يكون بونص أو جزاء'; END IF;
  IF coalesce(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر'; END IF;
  IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'اكتب السبب'; END IF;
  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;
  IF v_emp.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(v_user) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT (public.is_admin(v_user)
          OR (public.has_role(v_user, 'branch_manager') AND public.user_in_branch(v_user, v_emp.branch_id))
          OR (public.has_role(v_user, 'accountant') AND public.user_in_branch(v_user, v_emp.branch_id))) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  v_month := to_char(v_date, 'YYYY-MM');
  IF EXISTS (SELECT 1 FROM public.salaries WHERE employee_id = p_employee_id AND month = v_month AND status = 'active') THEN
    RAISE EXCEPTION 'مرتب شهر % اتصرف خلاص — ألغِ الصرف الأول أو سجّلها على الشهر اللي بعده', v_month;
  END IF;
  INSERT INTO public.employee_adjustments(tenant_id, branch_id, employee_id, month, entry_date, kind, amount, reason, created_by)
  VALUES (v_emp.tenant_id, v_emp.branch_id, p_employee_id, v_month, v_date, p_kind, round(p_amount, 2), trim(p_reason), v_user)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
  VALUES (v_user, (SELECT name FROM public.profiles WHERE id = v_user), v_emp.branch_id, 'CREATE', 'employee_adjustment', v_id::text,
          jsonb_build_object('employee', v_emp.name, 'kind', p_kind, 'amount', p_amount, 'month', v_month, 'reason', p_reason), v_emp.tenant_id);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_employee_adjustment(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); a record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT * INTO a FROM public.employee_adjustments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'غير موجود'; END IF;
  IF a.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(v_user) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT (public.is_admin(v_user) OR (public.has_role(v_user, 'branch_manager') AND public.user_in_branch(v_user, a.branch_id))) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  IF a.status <> 'active' THEN RAISE EXCEPTION 'ملغي بالفعل'; END IF;
  IF a.salary_id IS NOT NULL THEN RAISE EXCEPTION 'اتحسب في مرتب اتصرف — ألغِ صرف المرتب الأول'; END IF;
  UPDATE public.employee_adjustments SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_user, cancel_reason = nullif(trim(p_reason), '')
   WHERE id = p_id;
  INSERT INTO public.audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
  VALUES (v_user, (SELECT name FROM public.profiles WHERE id = v_user), a.branch_id, 'CANCEL', 'employee_adjustment', p_id::text,
          jsonb_build_object('kind', a.kind, 'amount', a.amount, 'month', a.month, 'reason', p_reason), a.tenant_id);
END $$;

-- ---------------------------------------------------------------- preview / pay / cancel learn the entries
DO $$
DECLARE d text;
BEGIN
  -- preview: + adjustments of the month
  d := pg_get_functiondef('public.employee_salary_preview(uuid,text)'::regprocedure);
  IF position('''adjustments''' in d) = 0 THEN
    d := replace(d, E'    ''paid'', v_paid_row);',
      E'    ''paid'', v_paid_row,\n'
      '    ''adjustments'', (SELECT jsonb_build_object(\n'
      '        ''bonus'', coalesce(sum(a.amount) FILTER (WHERE a.kind = ''bonus''), 0),\n'
      '        ''penalty'', coalesce(sum(a.amount) FILTER (WHERE a.kind = ''penalty''), 0),\n'
      '        ''items'', coalesce(jsonb_agg(jsonb_build_object(''id'', a.id, ''date'', a.entry_date, ''kind'', a.kind, ''amount'', a.amount, ''reason'', a.reason, ''salary_id'', a.salary_id) ORDER BY a.entry_date, a.created_at), ''[]''::jsonb))\n'
      '      FROM public.employee_adjustments a\n'
      '     WHERE a.employee_id = p_employee_id AND a.month = p_month AND a.status = ''active''));');
    IF position('''adjustments''' in d) = 0 THEN RAISE EXCEPTION '0081: preview patch failed'; END IF;
    EXECUTE d;
  END IF;

  -- pay: recorded bonus / penalty go into the salary and are linked to it
  d := pg_get_functiondef('public.pay_employee_salary(uuid,text,numeric,numeric,numeric,text,text,text,text,numeric,text)'::regprocedure);
  IF position('v_adj_b' in d) = 0 THEN
    d := replace(d, E'  v_acc_salary uuid; v_acc_adv uuid;', E'  v_acc_salary uuid; v_acc_adv uuid;\n  v_adj_b numeric := 0; v_adj_p numeric := 0;');
    d := replace(d, E'  v_gross := round(v_base - v_att_ded + v_bonuses - v_ded, 2);',
      E'  -- bonus / penalty recorded during the month (0081)\n'
      '  v_adj_b := coalesce((v_prev->''adjustments''->>''bonus'')::numeric, 0);\n'
      '  v_adj_p := coalesce((v_prev->''adjustments''->>''penalty'')::numeric, 0);\n'
      '  v_bonuses := v_bonuses + v_adj_b;\n'
      '  v_ded := v_ded + v_adj_p;\n'
      '  v_gross := round(v_base - v_att_ded + v_bonuses - v_ded, 2);');
    d := replace(d, E'  RETURNING id INTO v_salary_id;\n',
      E'  RETURNING id INTO v_salary_id;\n'
      '  UPDATE public.employee_adjustments SET salary_id = v_salary_id\n'
      '   WHERE employee_id = p_employee_id AND month = p_month AND status = ''active'' AND salary_id IS NULL;\n');
    IF position('v_adj_b := ' in d) = 0 OR position('SET salary_id = v_salary_id' in d) = 0 THEN RAISE EXCEPTION '0081: pay patch failed'; END IF;
    EXECUTE d;
  END IF;

  -- cancel salary: the entries are free again
  d := pg_get_functiondef('public.cancel_salary_payment(uuid,text)'::regprocedure);
  IF position('employee_adjustments' in d) = 0 THEN
    d := replace(d, E'  UPDATE public.salaries SET status = ''cancelled''',
      E'  UPDATE public.employee_adjustments SET salary_id = NULL WHERE salary_id = p_salary_id;\n  UPDATE public.salaries SET status = ''cancelled''');
    IF position('employee_adjustments' in d) = 0 THEN RAISE EXCEPTION '0081: cancel patch failed'; END IF;
    EXECUTE d;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.add_employee_adjustment(uuid, text, numeric, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_employee_adjustment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_employee_adjustment(uuid, text, numeric, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_employee_adjustment(uuid, text) TO authenticated;
INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('add_employee_adjustment', '0081', 'record a bonus / penalty for the month (applied when the salary is paid)'),
  ('cancel_employee_adjustment', '0081', 'cancel a bonus / penalty not yet used by a paid salary')
ON CONFLICT DO NOTHING;
