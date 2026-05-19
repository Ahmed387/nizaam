
-- 1) Extend treasury
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treasury' AND column_name='payment_method') THEN
    ALTER TABLE public.treasury ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treasury' AND column_name='reference_number') THEN
    ALTER TABLE public.treasury ADD COLUMN reference_number TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treasury' AND column_name='transfer_to_account') THEN
    ALTER TABLE public.treasury ADD COLUMN transfer_to_account TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treasury' AND column_name='is_fee') THEN
    ALTER TABLE public.treasury ADD COLUMN is_fee BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

ALTER TABLE public.treasury DROP CONSTRAINT IF EXISTS treasury_payment_method_check;
ALTER TABLE public.treasury ADD CONSTRAINT treasury_payment_method_check CHECK (payment_method IN ('cash','vodafone','instapay','bank'));
CREATE INDEX IF NOT EXISTS idx_treasury_branch_method ON public.treasury(branch_id, payment_method);
UPDATE public.treasury SET payment_method='cash' WHERE payment_method IS NULL;

-- 2) Extend treasury_transfers
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treasury_transfers' AND column_name='fee_amount') THEN
    ALTER TABLE public.treasury_transfers ADD COLUMN fee_amount NUMERIC NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treasury_transfers' AND column_name='transfer_to_account') THEN
    ALTER TABLE public.treasury_transfers ADD COLUMN transfer_to_account TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treasury_transfers' AND column_name='rejected_at') THEN
    ALTER TABLE public.treasury_transfers ADD COLUMN rejected_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treasury_transfers' AND column_name='rejected_by') THEN
    ALTER TABLE public.treasury_transfers ADD COLUMN rejected_by UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='treasury_transfers' AND column_name='rejection_reason') THEN
    ALTER TABLE public.treasury_transfers ADD COLUMN rejection_reason TEXT;
  END IF;
END $$;

-- 3) transfer_fees
CREATE TABLE IF NOT EXISTS public.transfer_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('vodafone','instapay','bank')),
  fee_type TEXT NOT NULL CHECK (fee_type IN ('percentage','fixed')) DEFAULT 'fixed',
  fee_value NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  UNIQUE (tenant_id, payment_method)
);
ALTER TABLE public.transfer_fees ENABLE ROW LEVEL SECURITY;
CREATE POLICY tf_read ON public.transfer_fees FOR SELECT USING ((tenant_id = current_tenant_id()) OR is_super_admin(auth.uid()));
CREATE POLICY tf_write ON public.transfer_fees FOR ALL USING (((tenant_id = current_tenant_id()) AND is_admin(auth.uid())) OR is_super_admin(auth.uid())) WITH CHECK (((tenant_id = current_tenant_id()) AND is_admin(auth.uid())) OR is_super_admin(auth.uid()));
CREATE POLICY tf_suspended ON public.transfer_fees AS RESTRICTIVE FOR ALL USING (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended()) WITH CHECK (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended());
CREATE TRIGGER trg_tf_tenant BEFORE INSERT ON public.transfer_fees FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_user();
CREATE TRIGGER trg_tf_updated BEFORE UPDATE ON public.transfer_fees FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4) payment_plans
CREATE TABLE IF NOT EXISTS public.payment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  branch_id UUID NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('customer','supplier','employee')),
  entity_id UUID NOT NULL,
  entity_name TEXT NOT NULL,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  remaining_amount NUMERIC NOT NULL DEFAULT 0,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('scheduled','open')) DEFAULT 'open',
  reference_type TEXT CHECK (reference_type IN ('invoice','shipment','salary','advance','manual')),
  reference_id UUID,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','settled','cancelled')) DEFAULT 'active',
  fee_on_customer BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pp_branch ON public.payment_plans(branch_id);
CREATE INDEX IF NOT EXISTS idx_pp_entity ON public.payment_plans(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_pp_ref ON public.payment_plans(reference_type, reference_id);
ALTER TABLE public.payment_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY pp_read ON public.payment_plans FOR SELECT USING (
  is_super_admin(auth.uid()) OR ((tenant_id = current_tenant_id()) AND (is_admin(auth.uid()) OR user_in_branch(auth.uid(), branch_id)))
);
CREATE POLICY pp_viewer_read ON public.payment_plans FOR SELECT USING ((tenant_id = current_tenant_id()) AND has_role(auth.uid(), 'viewer'));
CREATE POLICY pp_write ON public.payment_plans FOR ALL USING (
  is_super_admin(auth.uid()) OR ((tenant_id = current_tenant_id()) AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), branch_id) AND has_role(auth.uid(),'branch_manager'))))
) WITH CHECK (
  is_super_admin(auth.uid()) OR ((tenant_id = current_tenant_id()) AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), branch_id) AND has_role(auth.uid(),'branch_manager'))))
);
CREATE POLICY pp_insert_branch ON public.payment_plans FOR INSERT WITH CHECK ((tenant_id = current_tenant_id()) AND user_in_branch(auth.uid(), branch_id));
CREATE POLICY pp_suspended ON public.payment_plans AS RESTRICTIVE FOR ALL USING (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended()) WITH CHECK (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended());
CREATE TRIGGER trg_pp_tenant BEFORE INSERT ON public.payment_plans FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_user();
CREATE TRIGGER trg_pp_updated BEFORE UPDATE ON public.payment_plans FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5) payment_installments
CREATE TABLE IF NOT EXISTS public.payment_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  payment_plan_id UUID NOT NULL REFERENCES public.payment_plans(id) ON DELETE CASCADE,
  installment_number INT NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC NOT NULL,
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending','paid','overdue','partial')) DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pi_plan ON public.payment_installments(payment_plan_id);
CREATE INDEX IF NOT EXISTS idx_pi_due ON public.payment_installments(due_date) WHERE status IN ('pending','overdue','partial');
ALTER TABLE public.payment_installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY pi_read ON public.payment_installments FOR SELECT USING (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.payment_plans pp WHERE pp.id = payment_plan_id AND pp.tenant_id = current_tenant_id()
      AND (is_admin(auth.uid()) OR has_role(auth.uid(),'viewer') OR user_in_branch(auth.uid(), pp.branch_id))
  )
);
CREATE POLICY pi_write ON public.payment_installments FOR ALL USING (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.payment_plans pp WHERE pp.id = payment_plan_id AND pp.tenant_id = current_tenant_id()
      AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), pp.branch_id) AND has_role(auth.uid(),'branch_manager')))
  )
) WITH CHECK (
  is_super_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.payment_plans pp WHERE pp.id = payment_plan_id AND pp.tenant_id = current_tenant_id()
      AND (is_admin(auth.uid()) OR (user_in_branch(auth.uid(), pp.branch_id) AND has_role(auth.uid(),'branch_manager')))
  )
);
CREATE POLICY pi_suspended ON public.payment_installments AS RESTRICTIVE FOR ALL USING (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended()) WITH CHECK (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended());
CREATE TRIGGER trg_pi_updated BEFORE UPDATE ON public.payment_installments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 6) payment_transactions
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  branch_id UUID NOT NULL,
  payment_plan_id UUID REFERENCES public.payment_plans(id) ON DELETE SET NULL,
  installment_id UUID REFERENCES public.payment_installments(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount NUMERIC NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','vodafone','instapay','bank')),
  fee_amount NUMERIC NOT NULL DEFAULT 0,
  fee_type TEXT CHECK (fee_type IN ('percentage','fixed')),
  total_with_fee NUMERIC NOT NULL,
  reference_number TEXT,
  transfer_to_account TEXT,
  received_by_name TEXT,
  created_by UUID NOT NULL,
  treasury_id UUID,
  fee_treasury_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pt_plan ON public.payment_transactions(payment_plan_id);
CREATE INDEX IF NOT EXISTS idx_pt_branch ON public.payment_transactions(branch_id);
CREATE INDEX IF NOT EXISTS idx_pt_method ON public.payment_transactions(payment_method);
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY pt_read ON public.payment_transactions FOR SELECT USING (
  is_super_admin(auth.uid()) OR ((tenant_id = current_tenant_id()) AND (is_admin(auth.uid()) OR has_role(auth.uid(),'viewer') OR user_in_branch(auth.uid(), branch_id)))
);
CREATE POLICY pt_insert ON public.payment_transactions FOR INSERT WITH CHECK ((tenant_id = current_tenant_id()) AND user_in_branch(auth.uid(), branch_id));
CREATE POLICY pt_suspended ON public.payment_transactions AS RESTRICTIVE FOR ALL USING (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended()) WITH CHECK (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended());
CREATE TRIGGER trg_pt_tenant BEFORE INSERT ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_user();

-- 7) Helper: get_branch_wallet_balances
CREATE OR REPLACE FUNCTION public.get_branch_wallet_balances(p_branch_id UUID)
RETURNS TABLE(cash_balance NUMERIC, vodafone_balance NUMERIC, instapay_balance NUMERIC, bank_balance NUMERIC, total_balance NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(SUM(CASE WHEN payment_method='cash'     THEN (CASE WHEN type='income' THEN amount ELSE -amount END) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_method='vodafone' THEN (CASE WHEN type='income' THEN amount ELSE -amount END) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_method='instapay' THEN (CASE WHEN type='income' THEN amount ELSE -amount END) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN payment_method='bank'     THEN (CASE WHEN type='income' THEN amount ELSE -amount END) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
  FROM public.treasury WHERE branch_id = p_branch_id;
$$;

-- 8) Helper: calculate_payment_fee
CREATE OR REPLACE FUNCTION public.calculate_payment_fee(p_method TEXT, p_amount NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fee_type TEXT; v_fee_value NUMERIC;
BEGIN
  IF p_method = 'cash' OR p_method IS NULL THEN RETURN 0; END IF;
  SELECT fee_type, fee_value INTO v_fee_type, v_fee_value
    FROM public.transfer_fees WHERE tenant_id = current_tenant_id() AND payment_method = p_method LIMIT 1;
  IF v_fee_value IS NULL THEN RETURN 0; END IF;
  IF v_fee_type = 'percentage' THEN RETURN ROUND(p_amount * v_fee_value / 100.0, 2);
  ELSE RETURN v_fee_value; END IF;
END;
$$;

-- 9) Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_plans;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_installments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_transactions;
