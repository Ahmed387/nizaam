DROP POLICY IF EXISTS invpay_write ON public.invoice_payments;

-- Full-tenant writers: admin, super_admin, accountant
CREATE POLICY invpay_write_full_tenant
ON public.invoice_payments
FOR ALL
TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'accountant'::public.app_role)
  )
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'accountant'::public.app_role)
  )
);

-- Branch-scoped writers: branch_manager, cashier (restricted to their assigned branches)
CREATE POLICY invpay_write_branch_scoped
ON public.invoice_payments
FOR ALL
TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND (
    public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'cashier'::public.app_role)
  )
  AND EXISTS (
    SELECT 1 FROM public.branch_users bu
    WHERE bu.user_id = auth.uid()
      AND bu.branch_id = invoice_payments.branch_id
  )
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND (
    public.has_role(auth.uid(), 'branch_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'cashier'::public.app_role)
  )
  AND EXISTS (
    SELECT 1 FROM public.branch_users bu
    WHERE bu.user_id = auth.uid()
      AND bu.branch_id = invoice_payments.branch_id
  )
);