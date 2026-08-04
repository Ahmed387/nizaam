-- ============ 1) employees: tighten PII exposure ============
DROP POLICY IF EXISTS emp_read ON public.employees;
DROP POLICY IF EXISTS emp_write ON public.employees;

CREATE POLICY emp_read ON public.employees
FOR SELECT TO authenticated
USING (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id()
    AND (
      is_admin(auth.uid())
      OR has_role(auth.uid(), 'supervisor'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
      OR (user_in_branch(auth.uid(), branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role))
      OR user_id = auth.uid()
    )
  )
);

CREATE POLICY emp_write ON public.employees
FOR ALL TO authenticated
USING (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id()
    AND (
      is_admin(auth.uid())
      OR (user_in_branch(auth.uid(), branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role))
    )
  )
)
WITH CHECK (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id()
    AND (
      is_admin(auth.uid())
      OR (user_in_branch(auth.uid(), branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role))
    )
  )
);

-- ============ 2) employee-ids storage: per-employee branch ownership ============
-- object path = <tenant_id>/<employee_id>/<side>-<ts>.<ext>
CREATE OR REPLACE FUNCTION public.can_access_employee_file(_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_super_admin(auth.uid())
     OR (
       (storage.foldername(_object_name))[1] = current_tenant_id()::text
       AND (
         is_admin(auth.uid())
         OR EXISTS (
           SELECT 1 FROM public.employees e
           WHERE e.id::text = (storage.foldername(_object_name))[2]
             AND e.tenant_id = current_tenant_id()
             AND has_role(auth.uid(), 'branch_manager'::app_role)
             AND user_in_branch(auth.uid(), e.branch_id)
         )
       )
     );
$$;

REVOKE ALL ON FUNCTION public.can_access_employee_file(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_employee_file(text) TO authenticated, service_role;

DROP POLICY IF EXISTS emp_ids_read ON storage.objects;
DROP POLICY IF EXISTS emp_ids_write ON storage.objects;
DROP POLICY IF EXISTS emp_ids_update ON storage.objects;
DROP POLICY IF EXISTS emp_ids_delete ON storage.objects;

CREATE POLICY emp_ids_read ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'employee-ids' AND public.can_access_employee_file(name));

CREATE POLICY emp_ids_write ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'employee-ids' AND public.can_access_employee_file(name));

CREATE POLICY emp_ids_update ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'employee-ids' AND public.can_access_employee_file(name))
WITH CHECK (bucket_id = 'employee-ids' AND public.can_access_employee_file(name));

CREATE POLICY emp_ids_delete ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'employee-ids' AND public.can_access_employee_file(name));