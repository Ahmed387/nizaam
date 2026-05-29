
-- Stage 1: Manual attendance + simplified worker/driver profiles

-- 1) Add has_system_access flag to employees (workers/drivers won't log in)
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS has_system_access boolean NOT NULL DEFAULT true;

-- Default workers/drivers to no system access
UPDATE public.employees SET has_system_access = false WHERE role IN ('worker','driver');

-- 2) Helper: can current user manage attendance for a target employee?
CREATE OR REPLACE FUNCTION public.can_manage_attendance_for(_target_employee_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t_role app_role;
  t_branch uuid;
  t_tenant uuid;
BEGIN
  SELECT role, branch_id, tenant_id INTO t_role, t_branch, t_tenant
  FROM public.employees WHERE id = _target_employee_id;

  IF t_role IS NULL THEN RETURN false; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN true; END IF;
  IF t_tenant <> current_tenant_id() THEN RETURN false; END IF;

  -- Admin and Supervisor can manage everyone in tenant
  IF is_admin(auth.uid()) OR has_role(auth.uid(),'supervisor') THEN
    RETURN true;
  END IF;

  -- Workers & Drivers: managed by accountant or warehouse in same branch
  IF t_role IN ('worker','driver') THEN
    RETURN user_in_branch(auth.uid(), t_branch)
      AND (has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'warehouse'));
  END IF;

  -- Cashier: managed by branch_manager in same branch
  IF t_role = 'cashier' THEN
    RETURN user_in_branch(auth.uid(), t_branch)
      AND has_role(auth.uid(),'branch_manager');
  END IF;

  -- Other roles (branch_manager, accountant, warehouse): only admin/supervisor
  RETURN false;
END;
$$;

-- 3) Rewrite attendance write policy to use the helper (blocks self check-in for cashier/worker/driver)
DROP POLICY IF EXISTS att_write ON public.attendance;
CREATE POLICY att_write ON public.attendance
  FOR ALL
  USING (public.can_manage_attendance_for(employee_id))
  WITH CHECK (public.can_manage_attendance_for(employee_id));
