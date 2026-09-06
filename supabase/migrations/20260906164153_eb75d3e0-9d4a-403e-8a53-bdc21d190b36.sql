ALTER TABLE public.equity_partners
  ADD COLUMN IF NOT EXISTS partnership_start_date date,
  ADD COLUMN IF NOT EXISTS notes text;

CREATE OR REPLACE FUNCTION public.create_partner_from_employee(
  _employee_id uuid,
  _partner_type text,
  _capital_share numeric,
  _operating_share numeric,
  _initial_capital numeric,
  _start_date date DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_emp record;
  v_partner_id uuid;
BEGIN
  IF NOT (is_super_admin(auth.uid()) OR is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'غير مصرح لك بإضافة شركاء';
  END IF;

  SELECT id, name, user_id, tenant_id INTO v_emp
  FROM public.employees WHERE id = _employee_id;

  IF v_emp.id IS NULL THEN
    RAISE EXCEPTION 'الموظف غير موجود';
  END IF;
  IF NOT is_super_admin(auth.uid()) AND v_emp.tenant_id IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'الموظف لا ينتمي لنفس الشركة';
  END IF;
  IF v_emp.user_id IS NULL THEN
    RAISE EXCEPTION 'الموظف ليس له حساب دخول — اربط له حساب أولاً';
  END IF;
  IF EXISTS (SELECT 1 FROM public.partner_users WHERE user_id = v_emp.user_id) THEN
    RAISE EXCEPTION 'حساب الموظف مربوط بالفعل بشريك آخر';
  END IF;
  IF _capital_share < 0 OR _capital_share > 1 OR _operating_share < 0 OR _operating_share > 1 THEN
    RAISE EXCEPTION 'النسب يجب أن تكون بين 0 و 100%%';
  END IF;

  INSERT INTO public.equity_partners (
    tenant_id, name, partner_type, capital_share, operating_share,
    initial_capital, partnership_start_date, notes
  ) VALUES (
    COALESCE(v_emp.tenant_id, v_tenant), v_emp.name, _partner_type,
    COALESCE(_capital_share, 0), COALESCE(_operating_share, 0),
    COALESCE(_initial_capital, 0), COALESCE(_start_date, CURRENT_DATE), _notes
  ) RETURNING id INTO v_partner_id;

  INSERT INTO public.partner_users (tenant_id, user_id, partner_id, created_by)
  VALUES (COALESCE(v_emp.tenant_id, v_tenant), v_emp.user_id, v_partner_id, auth.uid());

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (v_emp.user_id, 'partner', COALESCE(v_emp.tenant_id, v_tenant))
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN v_partner_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_partner_from_employee(uuid, text, numeric, numeric, numeric, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_partner_from_employee(uuid, text, numeric, numeric, numeric, date, text) TO authenticated;