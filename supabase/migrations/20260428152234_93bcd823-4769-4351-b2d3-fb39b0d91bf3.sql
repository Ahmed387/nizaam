-- Track supplier payments separately for full payment history
CREATE TABLE public.supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  supplier_id UUID NOT NULL,
  branch_id UUID NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  notes TEXT,
  treasury_id UUID,
  paid_by UUID NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sp_supplier ON public.supplier_payments(supplier_id);
CREATE INDEX idx_sp_tenant ON public.supplier_payments(tenant_id);

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER sp_set_tenant
BEFORE INSERT ON public.supplier_payments
FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_user();

CREATE POLICY sp_read ON public.supplier_payments
FOR SELECT USING (
  (tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id))
  OR is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND is_admin(auth.uid()))
);

CREATE POLICY sp_insert ON public.supplier_payments
FOR INSERT WITH CHECK (
  (tenant_id = current_tenant_id() AND user_in_branch(auth.uid(), branch_id))
  OR is_super_admin(auth.uid())
);

CREATE POLICY sp_update ON public.supplier_payments
FOR UPDATE USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND is_admin(auth.uid()))
);

CREATE POLICY sp_delete ON public.supplier_payments
FOR DELETE USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND is_admin(auth.uid()))
);