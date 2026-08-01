CREATE OR REPLACE FUNCTION public.can_manage_attendance_for(_target_employee_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  t_role app_role;
  t_branch uuid;
  t_tenant uuid;
  t_found boolean;
BEGIN
  SELECT role, branch_id, tenant_id, true INTO t_role, t_branch, t_tenant, t_found
  FROM public.employees WHERE id = _target_employee_id;

  IF NOT COALESCE(t_found, false) THEN RETURN false; END IF;
  IF is_super_admin(auth.uid()) THEN RETURN true; END IF;
  IF t_tenant IS DISTINCT FROM current_tenant_id() THEN RETURN false; END IF;

  IF is_admin(auth.uid()) OR has_role(auth.uid(),'owner') OR has_role(auth.uid(),'supervisor') THEN
    RETURN true;
  END IF;

  IF t_role IS NULL THEN
    RETURN user_in_branch(auth.uid(), t_branch)
      AND (has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'warehouse') OR has_role(auth.uid(),'branch_manager'));
  END IF;

  IF t_role IN ('worker','driver') THEN
    RETURN user_in_branch(auth.uid(), t_branch)
      AND (has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'warehouse') OR has_role(auth.uid(),'branch_manager'));
  END IF;

  IF t_role = 'cashier' THEN
    RETURN user_in_branch(auth.uid(), t_branch)
      AND has_role(auth.uid(),'branch_manager');
  END IF;

  RETURN false;
END;
$function$;