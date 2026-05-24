
-- ADVANCES: restrict read
DROP POLICY IF EXISTS adv_read ON public.advances;
CREATE POLICY adv_read ON public.advances FOR SELECT USING (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id() AND (
      is_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = advances.employee_id
          AND (
            (has_role(auth.uid(), 'branch_manager'::app_role) AND user_in_branch(auth.uid(), e.branch_id))
            OR e.user_id = auth.uid()
          )
      )
    )
  )
);

-- ADVANCE_PAYMENTS: restrict read
DROP POLICY IF EXISTS advp_read ON public.advance_payments;
CREATE POLICY advp_read ON public.advance_payments FOR SELECT USING (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id() AND (
      is_admin(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.advances a
        JOIN public.employees e ON e.id = a.employee_id
        WHERE a.id = advance_payments.advance_id
          AND (
            (has_role(auth.uid(), 'branch_manager'::app_role) AND user_in_branch(auth.uid(), e.branch_id))
            OR e.user_id = auth.uid()
          )
      )
    )
  )
);

-- SALARIES: restrict read
DROP POLICY IF EXISTS sal_read ON public.salaries;
CREATE POLICY sal_read ON public.salaries FOR SELECT USING (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id() AND (
      is_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = salaries.employee_id
          AND (
            (has_role(auth.uid(), 'branch_manager'::app_role) AND user_in_branch(auth.uid(), e.branch_id))
            OR e.user_id = auth.uid()
          )
      )
    )
  )
);

-- EMPLOYEES: tighten read to admin / branch_manager-in-branch / self
DROP POLICY IF EXISTS emp_read ON public.employees;
CREATE POLICY emp_read ON public.employees FOR SELECT USING (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id() AND (
      is_admin(auth.uid())
      OR (has_role(auth.uid(), 'branch_manager'::app_role) AND user_in_branch(auth.uid(), branch_id))
      OR user_id = auth.uid()
    )
  )
);

-- PRE_ORDER_TRANSACTIONS: add write policy
DROP POLICY IF EXISTS pot_write ON public.pre_order_transactions;
CREATE POLICY pot_write ON public.pre_order_transactions FOR ALL USING (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id() AND (
      is_admin(auth.uid())
      OR user_in_branch(auth.uid(), branch_id)
    )
  )
) WITH CHECK (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id() AND (
      is_admin(auth.uid())
      OR user_in_branch(auth.uid(), branch_id)
    )
  )
);

-- STORAGE: product-images — restrict update/delete to admins, branch managers, cashiers
DROP POLICY IF EXISTS "Authenticated can delete product images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update product images" ON storage.objects;

CREATE POLICY "Staff can delete product images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'product-images'
  AND (
    is_super_admin(auth.uid())
    OR is_admin(auth.uid())
    OR has_role(auth.uid(), 'branch_manager'::app_role)
    OR has_role(auth.uid(), 'cashier'::app_role)
  )
);

CREATE POLICY "Staff can update product images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'product-images'
  AND (
    is_super_admin(auth.uid())
    OR is_admin(auth.uid())
    OR has_role(auth.uid(), 'branch_manager'::app_role)
    OR has_role(auth.uid(), 'cashier'::app_role)
  )
);

-- STORAGE: employee-ids — tenant-scoped via path (first folder = tenant_id)
DROP POLICY IF EXISTS emp_ids_read ON storage.objects;
DROP POLICY IF EXISTS emp_ids_write ON storage.objects;
DROP POLICY IF EXISTS emp_ids_update ON storage.objects;
DROP POLICY IF EXISTS emp_ids_delete ON storage.objects;

CREATE POLICY emp_ids_read ON storage.objects FOR SELECT
USING (
  bucket_id = 'employee-ids'
  AND (
    is_super_admin(auth.uid())
    OR (
      (storage.foldername(name))[1] = current_tenant_id()::text
      AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'branch_manager'::app_role))
    )
  )
);

CREATE POLICY emp_ids_write ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'employee-ids'
  AND (
    is_super_admin(auth.uid())
    OR (
      (storage.foldername(name))[1] = current_tenant_id()::text
      AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'branch_manager'::app_role))
    )
  )
);

CREATE POLICY emp_ids_update ON storage.objects FOR UPDATE
USING (
  bucket_id = 'employee-ids'
  AND (
    is_super_admin(auth.uid())
    OR (
      (storage.foldername(name))[1] = current_tenant_id()::text
      AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'branch_manager'::app_role))
    )
  )
);

CREATE POLICY emp_ids_delete ON storage.objects FOR DELETE
USING (
  bucket_id = 'employee-ids'
  AND (
    is_super_admin(auth.uid())
    OR (
      (storage.foldername(name))[1] = current_tenant_id()::text
      AND (is_admin(auth.uid()) OR has_role(auth.uid(), 'branch_manager'::app_role))
    )
  )
);
