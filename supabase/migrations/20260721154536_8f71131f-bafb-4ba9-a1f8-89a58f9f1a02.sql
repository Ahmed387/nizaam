
CREATE TABLE public.partner_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  partner_id UUID NOT NULL REFERENCES public.equity_partners(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  remaining_amount NUMERIC(14,2) NOT NULL,
  advance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  installments_count INT NOT NULL DEFAULT 1 CHECK (installments_count >= 1),
  monthly_deduction NUMERIC(14,2),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','partially_paid','fully_paid','cancelled')),
  reason TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_advances TO authenticated;
GRANT ALL ON public.partner_advances TO service_role;
ALTER TABLE public.partner_advances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage tenant advances" ON public.partner_advances
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') AND tenant_id = public.current_tenant_id())
  WITH CHECK (public.has_role(auth.uid(),'admin') AND tenant_id = public.current_tenant_id());
CREATE POLICY "partners view own advances" ON public.partner_advances
  FOR SELECT TO authenticated
  USING (partner_id IN (SELECT partner_id FROM public.partner_users WHERE user_id = auth.uid()));

CREATE TABLE public.partner_advance_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_id UUID NOT NULL REFERENCES public.partner_advances(id) ON DELETE CASCADE,
  installment_number INT NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partially_paid','paid','overdue')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(advance_id, installment_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_advance_installments TO authenticated;
GRANT ALL ON public.partner_advance_installments TO service_role;
ALTER TABLE public.partner_advance_installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage installments" ON public.partner_advance_installments
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.partner_advances a WHERE a.id = advance_id
    AND public.has_role(auth.uid(),'admin') AND a.tenant_id = public.current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.partner_advances a WHERE a.id = advance_id
    AND public.has_role(auth.uid(),'admin') AND a.tenant_id = public.current_tenant_id()));
CREATE POLICY "partners view own installments" ON public.partner_advance_installments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.partner_advances a
    JOIN public.partner_users pu ON pu.partner_id = a.partner_id
    WHERE a.id = advance_id AND pu.user_id = auth.uid()));

CREATE TABLE public.partner_advance_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_id UUID NOT NULL REFERENCES public.partner_advances(id) ON DELETE CASCADE,
  installment_id UUID REFERENCES public.partner_advance_installments(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT NOT NULL DEFAULT 'manual' CHECK (payment_method IN ('treasury','profit_deduction','manual')),
  reference_type TEXT,
  reference_id UUID,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_advance_payments TO authenticated;
GRANT ALL ON public.partner_advance_payments TO service_role;
ALTER TABLE public.partner_advance_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage advance payments" ON public.partner_advance_payments
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.partner_advances a WHERE a.id = advance_id
    AND public.has_role(auth.uid(),'admin') AND a.tenant_id = public.current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.partner_advances a WHERE a.id = advance_id
    AND public.has_role(auth.uid(),'admin') AND a.tenant_id = public.current_tenant_id()));
CREATE POLICY "partners view own advance payments" ON public.partner_advance_payments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.partner_advances a
    JOIN public.partner_users pu ON pu.partner_id = a.partner_id
    WHERE a.id = advance_id AND pu.user_id = auth.uid()));

CREATE TRIGGER trg_partner_advances_updated BEFORE UPDATE ON public.partner_advances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_partner_advance_installments_updated BEFORE UPDATE ON public.partner_advance_installments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_partner_advances_partner ON public.partner_advances(partner_id);
CREATE INDEX idx_partner_advances_tenant_status ON public.partner_advances(tenant_id, status);
CREATE INDEX idx_pa_installments_advance ON public.partner_advance_installments(advance_id);
CREATE INDEX idx_pa_installments_due ON public.partner_advance_installments(due_date, status);
CREATE INDEX idx_pa_payments_advance ON public.partner_advance_payments(advance_id);

CREATE OR REPLACE FUNCTION public.create_partner_advance(
  _partner_id UUID, _amount NUMERIC, _advance_date DATE,
  _installments_count INT, _first_due_date DATE,
  _reason TEXT DEFAULT NULL, _notes TEXT DEFAULT NULL,
  _custom_installments JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant UUID; v_advance_id UUID;
  v_base NUMERIC(14,2); v_last NUMERIC(14,2); v_monthly NUMERIC(14,2);
  i INT; v_due DATE; v_item JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.equity_partners WHERE id = _partner_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Partner not found'; END IF;
  IF v_tenant <> public.current_tenant_id() THEN RAISE EXCEPTION 'Cross-tenant denied'; END IF;
  IF _installments_count < 1 THEN _installments_count := 1; END IF;
  v_monthly := ROUND(_amount / _installments_count, 2);

  INSERT INTO public.partner_advances (
    tenant_id, partner_id, amount, remaining_amount, advance_date, due_date,
    installments_count, monthly_deduction, reason, notes, created_by
  ) VALUES (
    v_tenant, _partner_id, _amount, _amount, _advance_date,
    (_first_due_date + ((_installments_count-1) || ' months')::INTERVAL)::DATE,
    _installments_count, v_monthly, _reason, _notes, auth.uid()
  ) RETURNING id INTO v_advance_id;

  IF _custom_installments IS NOT NULL AND jsonb_array_length(_custom_installments) > 0 THEN
    i := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(_custom_installments) LOOP
      i := i + 1;
      INSERT INTO public.partner_advance_installments (advance_id, installment_number, due_date, amount)
      VALUES (v_advance_id, i, (v_item->>'due_date')::DATE, (v_item->>'amount')::NUMERIC);
    END LOOP;
  ELSE
    v_base := ROUND(_amount / _installments_count, 2);
    v_last := _amount - v_base * (_installments_count - 1);
    FOR i IN 1.._installments_count LOOP
      v_due := (_first_due_date + ((i-1) || ' months')::INTERVAL)::DATE;
      INSERT INTO public.partner_advance_installments (advance_id, installment_number, due_date, amount)
      VALUES (v_advance_id, i, v_due, CASE WHEN i = _installments_count THEN v_last ELSE v_base END);
    END LOOP;
  END IF;
  RETURN v_advance_id;
END; $$;

CREATE OR REPLACE FUNCTION public.record_partner_advance_payment(
  _advance_id UUID, _amount NUMERIC,
  _payment_method TEXT DEFAULT 'manual',
  _payment_date DATE DEFAULT CURRENT_DATE,
  _reference_type TEXT DEFAULT NULL,
  _reference_id UUID DEFAULT NULL,
  _notes TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant UUID; v_remaining NUMERIC(14,2); v_amount_total NUMERIC(14,2);
  v_apply NUMERIC(14,2); v_left NUMERIC(14,2) := _amount;
  v_pay_id UUID; r RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT tenant_id, remaining_amount, amount INTO v_tenant, v_remaining, v_amount_total
    FROM public.partner_advances WHERE id = _advance_id FOR UPDATE;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Advance not found'; END IF;
  IF v_tenant <> public.current_tenant_id() THEN RAISE EXCEPTION 'Cross-tenant denied'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be > 0'; END IF;
  IF _amount > v_remaining + 0.01 THEN RAISE EXCEPTION 'Amount exceeds remaining'; END IF;

  INSERT INTO public.partner_advance_payments (
    advance_id, amount, payment_method, payment_date, reference_type, reference_id, notes, created_by
  ) VALUES (
    _advance_id, _amount, _payment_method, _payment_date, _reference_type, _reference_id, _notes, auth.uid()
  ) RETURNING id INTO v_pay_id;

  FOR r IN
    SELECT id, amount, paid_amount FROM public.partner_advance_installments
    WHERE advance_id = _advance_id AND status <> 'paid'
    ORDER BY installment_number
  LOOP
    EXIT WHEN v_left <= 0;
    v_apply := LEAST(r.amount - r.paid_amount, v_left);
    UPDATE public.partner_advance_installments
       SET paid_amount = r.paid_amount + v_apply,
           status = CASE WHEN r.paid_amount + v_apply >= r.amount - 0.001 THEN 'paid' ELSE 'partially_paid' END,
           paid_at = CASE WHEN r.paid_amount + v_apply >= r.amount - 0.001 THEN now() ELSE paid_at END
     WHERE id = r.id;
    v_left := v_left - v_apply;
  END LOOP;

  UPDATE public.partner_advances
     SET remaining_amount = GREATEST(v_remaining - _amount, 0),
         status = CASE
            WHEN v_remaining - _amount <= 0.001 THEN 'fully_paid'
            WHEN v_remaining - _amount < v_amount_total THEN 'partially_paid'
            ELSE status END,
         updated_at = now()
   WHERE id = _advance_id;
  RETURN v_pay_id;
END; $$;

CREATE OR REPLACE FUNCTION public.mark_partner_advance_installments_overdue()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INT;
BEGIN
  UPDATE public.partner_advance_installments
     SET status = 'overdue', updated_at = now()
   WHERE status IN ('pending','partially_paid') AND due_date < CURRENT_DATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;
