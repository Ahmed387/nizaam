
-- 1. Fiscal periods
CREATE TABLE public.fiscal_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open, closing, closed
  net_profit NUMERIC,
  closing_entry_id UUID REFERENCES public.journal_entries(id),
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fiscal_periods TO authenticated;
GRANT ALL ON public.fiscal_periods TO service_role;
ALTER TABLE public.fiscal_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage fiscal periods" ON public.fiscal_periods FOR ALL
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_fiscal_periods_updated BEFORE UPDATE ON public.fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Profit distributions
CREATE TABLE public.profit_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  fiscal_period_id UUID REFERENCES public.fiscal_periods(id) ON DELETE SET NULL,
  distribution_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft, posted, void
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profit_distributions TO authenticated;
GRANT ALL ON public.profit_distributions TO service_role;
ALTER TABLE public.profit_distributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage distributions" ON public.profit_distributions FOR ALL
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_profit_distributions_updated BEFORE UPDATE ON public.profit_distributions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Distribution lines
CREATE TABLE public.profit_distribution_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id UUID NOT NULL REFERENCES public.profit_distributions(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES public.equity_partners(id),
  share_percentage NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  partner_transaction_id UUID REFERENCES public.partner_transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profit_distribution_lines TO authenticated;
GRANT ALL ON public.profit_distribution_lines TO service_role;
ALTER TABLE public.profit_distribution_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage distribution lines" ON public.profit_distribution_lines FOR ALL
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. Seed missing accounts per tenant (Income Summary 3900, Retained Earnings 3800)
INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, is_system)
SELECT t.id, '3800', 'Retained Earnings', 'الأرباح المحتجزة', 'equity', 'credit', true
FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id = t.id AND c.code = '3800');

INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, is_system)
SELECT t.id, '3900', 'Income Summary', 'ملخص الدخل', 'equity', 'credit', true
FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id = t.id AND c.code = '3900');

INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, is_system)
SELECT t.id, '3850', 'Partners Distributions Payable', 'مستحقات توزيع أرباح', 'liability', 'credit', true
FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id = t.id AND c.code = '3850');

-- 5. close_fiscal_period RPC
CREATE OR REPLACE FUNCTION public.close_fiscal_period(p_period_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_period public.fiscal_periods%ROWTYPE;
  v_tenant UUID;
  v_retained UUID;
  v_entry_id UUID;
  v_entry_number TEXT;
  v_total_revenue NUMERIC := 0;
  v_total_expense NUMERIC := 0;
  v_net_profit NUMERIC := 0;
  v_line_order INT := 0;
  r RECORD;
BEGIN
  SELECT * INTO v_period FROM public.fiscal_periods WHERE id = p_period_id FOR UPDATE;
  IF v_period.id IS NULL THEN RAISE EXCEPTION 'الفترة غير موجودة'; END IF;
  IF v_period.status = 'closed' THEN RAISE EXCEPTION 'الفترة مغلقة بالفعل'; END IF;
  v_tenant := v_period.tenant_id;

  SELECT id INTO v_retained FROM public.chart_of_accounts
   WHERE tenant_id = v_tenant AND code = '3800' LIMIT 1;
  IF v_retained IS NULL THEN RAISE EXCEPTION 'حساب الأرباح المحتجزة غير موجود'; END IF;

  -- Create journal entry
  v_entry_number := 'CLOSE-' || to_char(v_period.period_end, 'YYYYMMDD');
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit, created_by)
  VALUES (v_tenant, v_entry_number, v_period.period_end,
          'قيد إقفال الفترة ' || v_period.name, 'fiscal_close', p_period_id, 'posted', 0, 0, auth.uid())
  RETURNING id INTO v_entry_id;

  -- Close revenue accounts (normal credit) — debit revenue, credit retained
  FOR r IN
    SELECT c.id AS account_id, COALESCE(SUM(l.credit - l.debit), 0) AS balance
    FROM public.chart_of_accounts c
    LEFT JOIN public.journal_entry_lines l ON l.account_id = c.id
    LEFT JOIN public.journal_entries j ON j.id = l.entry_id AND j.status = 'posted'
                                       AND j.entry_date BETWEEN v_period.period_start AND v_period.period_end
    WHERE c.tenant_id = v_tenant AND c.account_type = 'revenue'
    GROUP BY c.id
    HAVING COALESCE(SUM(l.credit - l.debit), 0) <> 0
  LOOP
    v_line_order := v_line_order + 1;
    INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
    VALUES (v_tenant, v_entry_id, r.account_id, r.balance, 0, 'إقفال إيرادات', v_line_order);
    v_total_revenue := v_total_revenue + r.balance;
  END LOOP;

  -- Close expense accounts (normal debit) — credit expense, debit retained (net effect)
  FOR r IN
    SELECT c.id AS account_id, COALESCE(SUM(l.debit - l.credit), 0) AS balance
    FROM public.chart_of_accounts c
    LEFT JOIN public.journal_entry_lines l ON l.account_id = c.id
    LEFT JOIN public.journal_entries j ON j.id = l.entry_id AND j.status = 'posted'
                                       AND j.entry_date BETWEEN v_period.period_start AND v_period.period_end
    WHERE c.tenant_id = v_tenant AND c.account_type = 'expense'
    GROUP BY c.id
    HAVING COALESCE(SUM(l.debit - l.credit), 0) <> 0
  LOOP
    v_line_order := v_line_order + 1;
    INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
    VALUES (v_tenant, v_entry_id, r.account_id, 0, r.balance, 'إقفال مصروفات', v_line_order);
    v_total_expense := v_total_expense + r.balance;
  END LOOP;

  v_net_profit := v_total_revenue - v_total_expense;

  -- Balancing line to Retained Earnings
  v_line_order := v_line_order + 1;
  IF v_net_profit >= 0 THEN
    INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
    VALUES (v_tenant, v_entry_id, v_retained, 0, v_net_profit, 'صافي الربح للأرباح المحتجزة', v_line_order);
  ELSE
    INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
    VALUES (v_tenant, v_entry_id, v_retained, -v_net_profit, 0, 'صافي الخسارة من الأرباح المحتجزة', v_line_order);
  END IF;

  -- Update entry totals
  UPDATE public.journal_entries SET
    total_debit = v_total_revenue + GREATEST(-v_net_profit, 0),
    total_credit = v_total_expense + GREATEST(v_net_profit, 0)
  WHERE id = v_entry_id;

  UPDATE public.fiscal_periods SET
    status = 'closed', net_profit = v_net_profit, closing_entry_id = v_entry_id,
    closed_at = now(), closed_by = auth.uid()
  WHERE id = p_period_id;

  RETURN jsonb_build_object(
    'entry_id', v_entry_id, 'entry_number', v_entry_number,
    'total_revenue', v_total_revenue, 'total_expense', v_total_expense,
    'net_profit', v_net_profit
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.close_fiscal_period(UUID) TO authenticated;

-- 6. distribute_profits RPC
CREATE OR REPLACE FUNCTION public.distribute_profits(
  p_tenant_id UUID,
  p_fiscal_period_id UUID,
  p_total_amount NUMERIC,
  p_distribution_date DATE DEFAULT CURRENT_DATE,
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_dist_id UUID;
  v_entry_id UUID;
  v_entry_number TEXT;
  v_retained UUID;
  v_payable UUID;
  v_total_share NUMERIC := 0;
  v_line_order INT := 0;
  v_ptx_id UUID;
  v_month_year TEXT;
  r RECORD;
BEGIN
  IF p_total_amount <= 0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;

  SELECT COALESCE(SUM(capital_share), 0) INTO v_total_share
  FROM public.equity_partners
  WHERE tenant_id = p_tenant_id AND is_active = true;
  IF v_total_share <= 0 THEN RAISE EXCEPTION 'لا يوجد شركاء نشطين أو مجموع الحصص = صفر'; END IF;

  SELECT id INTO v_retained FROM public.chart_of_accounts
    WHERE tenant_id = p_tenant_id AND code = '3800' LIMIT 1;
  SELECT id INTO v_payable FROM public.chart_of_accounts
    WHERE tenant_id = p_tenant_id AND code = '3850' LIMIT 1;
  IF v_retained IS NULL OR v_payable IS NULL THEN RAISE EXCEPTION 'حسابات التوزيع غير موجودة'; END IF;

  v_month_year := to_char(p_distribution_date, 'YYYY-MM');

  -- Create distribution
  INSERT INTO public.profit_distributions (tenant_id, fiscal_period_id, distribution_date, total_amount, status, notes, created_by)
  VALUES (p_tenant_id, p_fiscal_period_id, p_distribution_date, p_total_amount, 'posted', p_notes, auth.uid())
  RETURNING id INTO v_dist_id;

  -- Create journal entry
  v_entry_number := 'DIST-' || to_char(p_distribution_date, 'YYYYMMDD') || '-' || substring(v_dist_id::text, 1, 4);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit, created_by)
  VALUES (p_tenant_id, v_entry_number, p_distribution_date, 'توزيع أرباح على الشركاء', 'profit_distribution', v_dist_id, 'posted', p_total_amount, p_total_amount, auth.uid())
  RETURNING id INTO v_entry_id;

  -- Debit retained earnings for total
  INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
  VALUES (p_tenant_id, v_entry_id, v_retained, p_total_amount, 0, 'توزيع أرباح', 1);

  -- For each partner: allocate share, create partner_transaction, credit payable
  FOR r IN
    SELECT id, name, capital_share
    FROM public.equity_partners
    WHERE tenant_id = p_tenant_id AND is_active = true
  LOOP
    DECLARE
      v_pct NUMERIC := (r.capital_share / v_total_share) * 100;
      v_amt NUMERIC := round((p_total_amount * r.capital_share / v_total_share)::numeric, 2);
    BEGIN
      -- Partner transaction
      INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by)
      VALUES (p_tenant_id, r.id, 'profit_share', v_amt, 'توزيع أرباح - ' || r.name, v_month_year, auth.uid())
      RETURNING id INTO v_ptx_id;

      -- Update partner rollup
      UPDATE public.equity_partners
        SET total_profit_share = COALESCE(total_profit_share, 0) + v_amt,
            current_balance = COALESCE(current_balance, 0) + v_amt
      WHERE id = r.id;

      -- Distribution line
      INSERT INTO public.profit_distribution_lines (distribution_id, partner_id, share_percentage, amount, partner_transaction_id)
      VALUES (v_dist_id, r.id, v_pct, v_amt, v_ptx_id);

      -- Journal line
      v_line_order := v_line_order + 1;
      INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
      VALUES (p_tenant_id, v_entry_id, v_payable, 0, v_amt, 'مستحق للشريك ' || r.name, v_line_order + 1);
    END;
  END LOOP;

  UPDATE public.profit_distributions SET journal_entry_id = v_entry_id WHERE id = v_dist_id;

  RETURN jsonb_build_object('distribution_id', v_dist_id, 'journal_entry_id', v_entry_id, 'total_amount', p_total_amount);
END;
$$;
GRANT EXECUTE ON FUNCTION public.distribute_profits(UUID, UUID, NUMERIC, DATE, TEXT) TO authenticated;
