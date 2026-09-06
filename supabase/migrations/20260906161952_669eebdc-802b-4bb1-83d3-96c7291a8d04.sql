-- 1) access_level on branch_users (backward compatible: everything existing = manage)
ALTER TABLE public.branch_users
  ADD COLUMN IF NOT EXISTS access_level text NOT NULL DEFAULT 'manage';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'branch_users_access_level_check'
  ) THEN
    ALTER TABLE public.branch_users
      ADD CONSTRAINT branch_users_access_level_check
      CHECK (access_level IN ('manage','read'));
  END IF;
END $$;

UPDATE public.branch_users SET access_level = 'manage' WHERE access_level IS NULL OR access_level NOT IN ('manage','read');

CREATE INDEX IF NOT EXISTS idx_branch_users_user_branch_access
  ON public.branch_users (user_id, branch_id, access_level);

-- 2) security definer helper
CREATE OR REPLACE FUNCTION public.user_can_write_branch(p_user_id uuid, p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN false
    -- owner / admin / super_admin immunity
    WHEN EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p_user_id AND ur.role IN ('owner','admin','super_admin')
    ) THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.tenants t WHERE t.owner_user_id = p_user_id
    ) THEN true
    WHEN p_branch_id IS NULL THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.branch_users bu
      WHERE bu.user_id = p_user_id
        AND bu.branch_id = p_branch_id
        AND COALESCE(bu.access_level,'manage') = 'manage'
    )
  END
$$;

GRANT EXECUTE ON FUNCTION public.user_can_write_branch(uuid, uuid) TO authenticated, service_role;

-- 3) invoices
DROP POLICY IF EXISTS inv_insert ON public.invoices;
CREATE POLICY inv_insert ON public.invoices FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = current_tenant_id()
  AND user_in_branch(auth.uid(), branch_id)
  AND public.user_can_write_branch(auth.uid(), branch_id)
);

DROP POLICY IF EXISTS inv_update ON public.invoices;
CREATE POLICY inv_update ON public.invoices FOR UPDATE TO authenticated
USING (
  (
    tenant_id = current_tenant_id()
    AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), branch_id) AND has_role(auth.uid(), 'branch_manager'::app_role)))
    AND public.user_can_write_branch(auth.uid(), branch_id)
  )
  OR is_super_admin(auth.uid())
);

-- 4) invoice_items (branch resolved through parent invoice)
DROP POLICY IF EXISTS invitm_write ON public.invoice_items;
CREATE POLICY invitm_write ON public.invoice_items FOR INSERT TO authenticated
WITH CHECK (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id()
    AND public.user_can_write_branch(
      auth.uid(), (SELECT i.branch_id FROM public.invoices i WHERE i.id = invoice_items.invoice_id)
    )
  )
);
CREATE POLICY invitm_update ON public.invoice_items FOR UPDATE TO authenticated
USING (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id()
    AND public.user_can_write_branch(
      auth.uid(), (SELECT i.branch_id FROM public.invoices i WHERE i.id = invoice_items.invoice_id)
    )
  )
);
CREATE POLICY invitm_delete ON public.invoice_items FOR DELETE TO authenticated
USING (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id()
    AND public.user_can_write_branch(
      auth.uid(), (SELECT i.branch_id FROM public.invoices i WHERE i.id = invoice_items.invoice_id)
    )
  )
);

-- 5) shipments
DROP POLICY IF EXISTS ship_write ON public.shipments;
CREATE POLICY ship_write ON public.shipments FOR ALL TO authenticated
USING (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id()
    AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), branch_id) AND (has_role(auth.uid(),'branch_manager'::app_role) OR has_role(auth.uid(),'warehouse'::app_role))))
    AND public.user_can_write_branch(auth.uid(), branch_id)
  )
)
WITH CHECK (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id()
    AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), branch_id) AND (has_role(auth.uid(),'branch_manager'::app_role) OR has_role(auth.uid(),'warehouse'::app_role))))
    AND public.user_can_write_branch(auth.uid(), branch_id)
  )
);

-- 6) shipment_items (branch through parent shipment)
DROP POLICY IF EXISTS shipitm_write ON public.shipment_items;
CREATE POLICY shipitm_write ON public.shipment_items FOR INSERT TO authenticated
WITH CHECK (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id()
    AND public.user_can_write_branch(
      auth.uid(), (SELECT s.branch_id FROM public.shipments s WHERE s.id = shipment_items.shipment_id)
    )
  )
);
CREATE POLICY shipitm_update ON public.shipment_items FOR UPDATE TO authenticated
USING (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id()
    AND public.user_can_write_branch(
      auth.uid(), (SELECT s.branch_id FROM public.shipments s WHERE s.id = shipment_items.shipment_id)
    )
  )
);
CREATE POLICY shipitm_delete ON public.shipment_items FOR DELETE TO authenticated
USING (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id()
    AND public.user_can_write_branch(
      auth.uid(), (SELECT s.branch_id FROM public.shipments s WHERE s.id = shipment_items.shipment_id)
    )
  )
);

-- 7) treasury
DROP POLICY IF EXISTS tr_write ON public.treasury;
CREATE POLICY tr_write ON public.treasury FOR ALL TO authenticated
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id) AND public.user_can_write_branch(auth.uid(), branch_id))
)
WITH CHECK (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id) AND public.user_can_write_branch(auth.uid(), branch_id))
);

-- 8) vouchers
DROP POLICY IF EXISTS v_insert_manual ON public.vouchers;
CREATE POLICY v_insert_manual ON public.vouchers FOR INSERT TO authenticated
WITH CHECK (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id()
    AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), branch_id) AND has_role(auth.uid(),'branch_manager'::app_role)))
    AND public.user_can_write_branch(auth.uid(), branch_id)
  )
);

DROP POLICY IF EXISTS v_update ON public.vouchers;
CREATE POLICY v_update ON public.vouchers FOR UPDATE TO authenticated
USING (
  is_super_admin(auth.uid())
  OR (
    tenant_id = current_tenant_id()
    AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), branch_id) AND has_role(auth.uid(),'branch_manager'::app_role)))
    AND public.user_can_write_branch(auth.uid(), branch_id)
  )
);

-- 9) cashier_shifts
DROP POLICY IF EXISTS shifts_insert ON public.cashier_shifts;
CREATE POLICY shifts_insert ON public.cashier_shifts FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = current_tenant_id()
  AND cashier_id = auth.uid()
  AND public.user_can_write_branch(auth.uid(), branch_id)
);

DROP POLICY IF EXISTS shifts_update ON public.cashier_shifts;
CREATE POLICY shifts_update ON public.cashier_shifts FOR UPDATE TO authenticated
USING (
  tenant_id = current_tenant_id()
  AND (cashier_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'super_admin'::app_role))
  AND public.user_can_write_branch(auth.uid(), branch_id)
);

-- 10) inventory_sessions: split read from write
DROP POLICY IF EXISTS inv_sessions_tenant_all ON public.inventory_sessions;
CREATE POLICY inv_sessions_read ON public.inventory_sessions FOR SELECT TO authenticated
USING (tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()));
CREATE POLICY inv_sessions_insert ON public.inventory_sessions FOR INSERT TO authenticated
WITH CHECK (
  tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  AND public.user_can_write_branch(auth.uid(), branch_id)
);
CREATE POLICY inv_sessions_update ON public.inventory_sessions FOR UPDATE TO authenticated
USING (
  tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  AND public.user_can_write_branch(auth.uid(), branch_id)
)
WITH CHECK (
  tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  AND public.user_can_write_branch(auth.uid(), branch_id)
);
CREATE POLICY inv_sessions_delete ON public.inventory_sessions FOR DELETE TO authenticated
USING (
  tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
  AND public.user_can_write_branch(auth.uid(), branch_id)
);