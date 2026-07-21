
-- 1) Extend role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'partner';

-- 2) equity_partners
CREATE TABLE public.equity_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  partner_type TEXT NOT NULL CHECK (partner_type IN ('capital','operating','both')),
  capital_share NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (capital_share >= 0 AND capital_share <= 1),
  operating_share NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (operating_share >= 0 AND operating_share <= 1),
  initial_capital NUMERIC(15,2) NOT NULL DEFAULT 0,
  current_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_contributions NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_drawings NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_profit_share NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.equity_partners TO authenticated;
GRANT ALL ON public.equity_partners TO service_role;
ALTER TABLE public.equity_partners ENABLE ROW LEVEL SECURITY;

-- 3) partner_users
CREATE TABLE public.partner_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES public.equity_partners(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, partner_id),
  UNIQUE (user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_users TO authenticated;
GRANT ALL ON public.partner_users TO service_role;
ALTER TABLE public.partner_users ENABLE ROW LEVEL SECURITY;

-- 4) partner_share_history
CREATE TABLE public.partner_share_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES public.equity_partners(id) ON DELETE CASCADE,
  capital_share NUMERIC(5,4) NOT NULL DEFAULT 0,
  operating_share NUMERIC(5,4) NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  changed_by UUID REFERENCES public.profiles(id),
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_share_history TO authenticated;
GRANT ALL ON public.partner_share_history TO service_role;
ALTER TABLE public.partner_share_history ENABLE ROW LEVEL SECURITY;

-- 5) partner_transactions
CREATE TABLE public.partner_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES public.equity_partners(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('contribution','drawing','profit_share','capital_adjustment')),
  amount NUMERIC(15,2) NOT NULL,
  description TEXT,
  related_voucher_id UUID REFERENCES public.vouchers(id) ON DELETE SET NULL,
  related_treasury_id UUID REFERENCES public.treasury(id) ON DELETE SET NULL,
  month_year TEXT,
  is_void BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_transactions TO authenticated;
GRANT ALL ON public.partner_transactions TO service_role;
ALTER TABLE public.partner_transactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_partner_tx_partner ON public.partner_transactions(partner_id, created_at DESC);
CREATE INDEX idx_partner_tx_tenant ON public.partner_transactions(tenant_id, created_at DESC);

-- 6) Helper: is current user linked to this partner?
CREATE OR REPLACE FUNCTION public.is_partner_owner(_partner_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.partner_users
    WHERE user_id = auth.uid() AND partner_id = _partner_id AND is_active = true
  );
$$;

-- 7) RLS policies
-- equity_partners: admin full, partner reads own
CREATE POLICY "ep_admin_all" ON public.equity_partners FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())))
  WITH CHECK (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())));
CREATE POLICY "ep_partner_read_own" ON public.equity_partners FOR SELECT TO authenticated
  USING (public.is_partner_owner(id));

-- partner_users: admin full, user reads own
CREATE POLICY "pu_admin_all" ON public.partner_users FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())))
  WITH CHECK (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())));
CREATE POLICY "pu_read_own" ON public.partner_users FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- share history: admin full, partner reads own
CREATE POLICY "psh_admin_all" ON public.partner_share_history FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())))
  WITH CHECK (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())));
CREATE POLICY "psh_partner_read_own" ON public.partner_share_history FOR SELECT TO authenticated
  USING (public.is_partner_owner(partner_id));

-- partner_transactions: admin full, partner reads own
CREATE POLICY "pt_admin_all" ON public.partner_transactions FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())))
  WITH CHECK (is_super_admin(auth.uid()) OR (tenant_id = current_tenant_id() AND is_admin(auth.uid())));
CREATE POLICY "pt_partner_read_own" ON public.partner_transactions FOR SELECT TO authenticated
  USING (public.is_partner_owner(partner_id));

-- 8) updated_at trigger reuse
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_ep_updated BEFORE UPDATE ON public.equity_partners
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_pu_updated BEFORE UPDATE ON public.partner_users
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 9) Trigger: sync partner balances on transaction insert
CREATE OR REPLACE FUNCTION public.sync_partner_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sign NUMERIC;
BEGIN
  IF NEW.is_void THEN RETURN NEW; END IF;

  IF NEW.transaction_type = 'contribution' THEN
    v_sign := 1;
    UPDATE public.equity_partners
      SET total_contributions = total_contributions + NEW.amount,
          current_balance = current_balance + NEW.amount
      WHERE id = NEW.partner_id;
  ELSIF NEW.transaction_type = 'drawing' THEN
    v_sign := -1;
    UPDATE public.equity_partners
      SET total_drawings = total_drawings + NEW.amount,
          current_balance = current_balance - NEW.amount
      WHERE id = NEW.partner_id;
  ELSIF NEW.transaction_type = 'profit_share' THEN
    UPDATE public.equity_partners
      SET total_profit_share = total_profit_share + NEW.amount,
          current_balance = current_balance + NEW.amount
      WHERE id = NEW.partner_id;
  ELSIF NEW.transaction_type = 'capital_adjustment' THEN
    UPDATE public.equity_partners
      SET current_balance = current_balance + NEW.amount
      WHERE id = NEW.partner_id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_partner_tx_balance
  AFTER INSERT ON public.partner_transactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_partner_balance();

-- 10) RPC: record_partner_transaction (admin only via RLS on inserts)
CREATE OR REPLACE FUNCTION public.record_partner_transaction(
  _partner_id UUID,
  _transaction_type TEXT,
  _amount NUMERIC,
  _description TEXT DEFAULT NULL,
  _month_year TEXT DEFAULT NULL,
  _treasury_id UUID DEFAULT NULL,
  _voucher_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_tx_id UUID;
BEGIN
  IF NOT is_admin(auth.uid()) AND NOT is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can record partner transactions';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.equity_partners WHERE id = _partner_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Partner not found'; END IF;

  INSERT INTO public.partner_transactions
    (tenant_id, partner_id, transaction_type, amount, description, month_year,
     related_treasury_id, related_voucher_id, created_by)
  VALUES (v_tenant, _partner_id, _transaction_type, _amount, _description,
          COALESCE(_month_year, to_char(CURRENT_DATE, 'YYYY-MM')),
          _treasury_id, _voucher_id, auth.uid())
  RETURNING id INTO v_tx_id;

  RETURN v_tx_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.record_partner_transaction(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_partner_owner(UUID) TO authenticated;
