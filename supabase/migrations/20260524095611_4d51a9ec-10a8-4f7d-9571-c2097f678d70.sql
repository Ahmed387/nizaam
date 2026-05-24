-- EMPLOYEES: extend read to supervisor (tenant-wide) + accountant/warehouse (in branch)
DROP POLICY IF EXISTS emp_read ON public.employees;
CREATE POLICY emp_read ON public.employees FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR (user_in_branch(auth.uid(), branch_id) AND (
      has_role(auth.uid(), 'branch_manager'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
      OR has_role(auth.uid(), 'warehouse'::app_role)
    ))
    OR user_id = auth.uid()
  ))
);

DROP POLICY IF EXISTS emp_write ON public.employees;
CREATE POLICY emp_write ON public.employees FOR ALL
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR (user_in_branch(auth.uid(), branch_id) AND (
      has_role(auth.uid(), 'branch_manager'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
      OR has_role(auth.uid(), 'warehouse'::app_role)
    ))
  ))
)
WITH CHECK (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR (user_in_branch(auth.uid(), branch_id) AND (
      has_role(auth.uid(), 'branch_manager'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
      OR has_role(auth.uid(), 'warehouse'::app_role)
    ))
  ))
);

-- ATTENDANCE: write — add supervisor (tenant-wide), accountant, warehouse (in branch)
DROP POLICY IF EXISTS att_write ON public.attendance;
CREATE POLICY att_write ON public.attendance FOR ALL
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR (user_in_branch(auth.uid(), branch_id) AND (
      has_role(auth.uid(), 'branch_manager'::app_role)
      OR has_role(auth.uid(), 'cashier'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
      OR has_role(auth.uid(), 'warehouse'::app_role)
    ))
  ))
)
WITH CHECK (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR (user_in_branch(auth.uid(), branch_id) AND (
      has_role(auth.uid(), 'branch_manager'::app_role)
      OR has_role(auth.uid(), 'cashier'::app_role)
      OR has_role(auth.uid(), 'accountant'::app_role)
      OR has_role(auth.uid(), 'warehouse'::app_role)
    ))
  ))
);

-- ADVANCES: write — add accountant, warehouse (in branch of employee)
DROP POLICY IF EXISTS adv_write ON public.advances;
CREATE POLICY adv_write ON public.advances FOR ALL
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'branch_manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = advances.employee_id
        AND user_in_branch(auth.uid(), e.branch_id)
        AND (has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))
    )
  ))
)
WITH CHECK (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'branch_manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = advances.employee_id
        AND user_in_branch(auth.uid(), e.branch_id)
        AND (has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))
    )
  ))
);

-- ADVANCE_PAYMENTS: same widening
DROP POLICY IF EXISTS advp_write ON public.advance_payments;
CREATE POLICY advp_write ON public.advance_payments FOR ALL
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'branch_manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM advances a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.id = advance_payments.advance_id
        AND user_in_branch(auth.uid(), e.branch_id)
        AND (has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))
    )
  ))
)
WITH CHECK (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'branch_manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM advances a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.id = advance_payments.advance_id
        AND user_in_branch(auth.uid(), e.branch_id)
        AND (has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))
    )
  ))
);

-- SALARIES: write — add accountant + warehouse (in employee branch)
DROP POLICY IF EXISTS sal_write ON public.salaries;
CREATE POLICY sal_write ON public.salaries FOR ALL
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'branch_manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = salaries.employee_id
        AND user_in_branch(auth.uid(), e.branch_id)
        AND (has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))
    )
  ))
)
WITH CHECK (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'branch_manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = salaries.employee_id
        AND user_in_branch(auth.uid(), e.branch_id)
        AND (has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role))
    )
  ))
);

-- SALARIES: read — add accountant + warehouse in branch
DROP POLICY IF EXISTS sal_read ON public.salaries;
CREATE POLICY sal_read ON public.salaries FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = salaries.employee_id AND (
        (has_role(auth.uid(), 'branch_manager'::app_role) AND user_in_branch(auth.uid(), e.branch_id))
        OR ((has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role)) AND user_in_branch(auth.uid(), e.branch_id))
        OR e.user_id = auth.uid()
      )
    )
  ))
);

-- ADVANCES read: also let accountant/warehouse in branch read
DROP POLICY IF EXISTS adv_read ON public.advances;
CREATE POLICY adv_read ON public.advances FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = advances.employee_id AND (
        (has_role(auth.uid(), 'branch_manager'::app_role) AND user_in_branch(auth.uid(), e.branch_id))
        OR ((has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role)) AND user_in_branch(auth.uid(), e.branch_id))
        OR e.user_id = auth.uid()
      )
    )
  ))
);

DROP POLICY IF EXISTS advp_read ON public.advance_payments;
CREATE POLICY advp_read ON public.advance_payments FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
    is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM advances a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.id = advance_payments.advance_id AND (
        (has_role(auth.uid(), 'branch_manager'::app_role) AND user_in_branch(auth.uid(), e.branch_id))
        OR ((has_role(auth.uid(), 'accountant'::app_role) OR has_role(auth.uid(), 'warehouse'::app_role)) AND user_in_branch(auth.uid(), e.branch_id))
        OR e.user_id = auth.uid()
      )
    )
  ))
);