
CREATE TABLE public.fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  acquisition_date DATE NOT NULL,
  cost NUMERIC(14,2) NOT NULL CHECK (cost >= 0),
  salvage_value NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  useful_life_months INTEGER NOT NULL CHECK (useful_life_months > 0),
  depreciation_method TEXT NOT NULL DEFAULT 'straight_line',
  asset_account_id UUID REFERENCES public.chart_of_accounts(id),
  accum_depreciation_account_id UUID REFERENCES public.chart_of_accounts(id),
  depreciation_expense_account_id UUID REFERENCES public.chart_of_accounts(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disposed')),
  disposal_date DATE,
  disposal_amount NUMERIC(14,2),
  disposal_journal_entry_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fixed_assets TO authenticated;
GRANT ALL ON public.fixed_assets TO service_role;
ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tenant fixed assets" ON public.fixed_assets
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER trg_fixed_assets_updated
  BEFORE UPDATE ON public.fixed_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.depreciation_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  asset_id UUID NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  journal_entry_id UUID,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(asset_id, period_month)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.depreciation_entries TO authenticated;
GRANT ALL ON public.depreciation_entries TO service_role;
ALTER TABLE public.depreciation_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tenant depreciation entries" ON public.depreciation_entries
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.chart_of_accounts (tenant_id, code, name, name_ar, account_type, normal_balance, is_active)
SELECT t.id, v.code, v.name, v.name_ar, v.account_type::public.account_type, v.normal_balance::public.normal_balance, true
FROM public.tenants t
CROSS JOIN (VALUES
  ('1500','Fixed Assets','الأصول الثابتة','asset','debit'),
  ('1590','Accumulated Depreciation','مجمع الإهلاك','asset','credit'),
  ('6500','Depreciation Expense','مصروف الإهلاك','expense','debit'),
  ('4900','Gain on Disposal of Assets','أرباح بيع أصول','revenue','credit'),
  ('6900','Loss on Disposal of Assets','خسائر بيع أصول','expense','debit')
) AS v(code,name,name_ar,account_type,normal_balance)
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts c WHERE c.tenant_id = t.id AND c.code = v.code
);

CREATE OR REPLACE FUNCTION public.post_monthly_depreciation(_tenant_id UUID, _period_month DATE)
RETURNS TABLE(asset_id UUID, amount NUMERIC, journal_entry_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _asset RECORD; _monthly NUMERIC; _je_id UUID;
  _period_start DATE; _period_end DATE;
  _accum_so_far NUMERIC; _depreciable NUMERIC;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can post depreciation';
  END IF;
  _period_start := date_trunc('month', _period_month)::date;
  _period_end := (_period_start + INTERVAL '1 month - 1 day')::date;
  FOR _asset IN
    SELECT * FROM public.fixed_assets
    WHERE tenant_id = _tenant_id AND status = 'active'
      AND acquisition_date <= _period_end
      AND accum_depreciation_account_id IS NOT NULL
      AND depreciation_expense_account_id IS NOT NULL
  LOOP
    IF EXISTS (SELECT 1 FROM public.depreciation_entries de WHERE de.asset_id = _asset.id AND de.period_month = _period_start) THEN CONTINUE; END IF;
    _depreciable := GREATEST(_asset.cost - COALESCE(_asset.salvage_value,0), 0);
    _monthly := ROUND(_depreciable / _asset.useful_life_months, 2);
    SELECT COALESCE(SUM(de.amount),0) INTO _accum_so_far FROM public.depreciation_entries de WHERE de.asset_id = _asset.id;
    IF _accum_so_far + _monthly > _depreciable THEN _monthly := GREATEST(_depreciable - _accum_so_far, 0); END IF;
    IF _monthly <= 0 THEN CONTINUE; END IF;
    INSERT INTO public.journal_entries (tenant_id, entry_date, description, source_type, source_id, created_by)
    VALUES (_tenant_id, _period_end, 'إهلاك شهري - ' || _asset.name || ' (' || to_char(_period_start,'YYYY-MM') || ')', 'depreciation', _asset.id, auth.uid())
    RETURNING id INTO _je_id;
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (_je_id, _asset.depreciation_expense_account_id, _monthly, 0, 'مصروف إهلاك ' || _asset.name),
      (_je_id, _asset.accum_depreciation_account_id, 0, _monthly, 'مجمع إهلاك ' || _asset.name);
    INSERT INTO public.depreciation_entries (tenant_id, asset_id, period_month, amount, journal_entry_id)
    VALUES (_tenant_id, _asset.id, _period_start, _monthly, _je_id);
    asset_id := _asset.id; amount := _monthly; journal_entry_id := _je_id;
    RETURN NEXT;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.post_monthly_depreciation(UUID, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.dispose_fixed_asset(_asset_id UUID, _disposal_date DATE, _disposal_amount NUMERIC)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _asset RECORD; _accum NUMERIC; _nbv NUMERIC; _gain NUMERIC; _je_id UUID;
  _cash_account UUID; _gain_account UUID; _loss_account UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can dispose assets';
  END IF;
  SELECT * INTO _asset FROM public.fixed_assets WHERE id = _asset_id;
  IF _asset.status = 'disposed' THEN RAISE EXCEPTION 'Asset already disposed'; END IF;
  SELECT COALESCE(SUM(de.amount),0) INTO _accum FROM public.depreciation_entries de WHERE de.asset_id = _asset_id;
  _nbv := _asset.cost - _accum;
  _gain := COALESCE(_disposal_amount,0) - _nbv;
  SELECT id INTO _cash_account FROM public.chart_of_accounts WHERE tenant_id=_asset.tenant_id AND code='1000' LIMIT 1;
  SELECT id INTO _gain_account FROM public.chart_of_accounts WHERE tenant_id=_asset.tenant_id AND code='4900' LIMIT 1;
  SELECT id INTO _loss_account FROM public.chart_of_accounts WHERE tenant_id=_asset.tenant_id AND code='6900' LIMIT 1;
  INSERT INTO public.journal_entries (tenant_id, entry_date, description, source_type, source_id, created_by)
  VALUES (_asset.tenant_id, _disposal_date, 'التخلص من أصل ثابت - ' || _asset.name, 'asset_disposal', _asset_id, auth.uid())
  RETURNING id INTO _je_id;
  IF COALESCE(_disposal_amount,0) > 0 AND _cash_account IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines(journal_entry_id, account_id, debit, credit, description)
    VALUES (_je_id, _cash_account, _disposal_amount, 0, 'قيمة بيع الأصل');
  END IF;
  IF _accum > 0 AND _asset.accum_depreciation_account_id IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines(journal_entry_id, account_id, debit, credit, description)
    VALUES (_je_id, _asset.accum_depreciation_account_id, _accum, 0, 'إغلاق مجمع الإهلاك');
  END IF;
  IF _asset.asset_account_id IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines(journal_entry_id, account_id, debit, credit, description)
    VALUES (_je_id, _asset.asset_account_id, 0, _asset.cost, 'إزالة تكلفة الأصل');
  END IF;
  IF _gain > 0 AND _gain_account IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines(journal_entry_id, account_id, debit, credit, description)
    VALUES (_je_id, _gain_account, 0, _gain, 'ربح بيع الأصل');
  ELSIF _gain < 0 AND _loss_account IS NOT NULL THEN
    INSERT INTO public.journal_entry_lines(journal_entry_id, account_id, debit, credit, description)
    VALUES (_je_id, _loss_account, -_gain, 0, 'خسارة بيع الأصل');
  END IF;
  UPDATE public.fixed_assets
     SET status='disposed', disposal_date=_disposal_date, disposal_amount=_disposal_amount, disposal_journal_entry_id=_je_id, updated_at=now()
   WHERE id=_asset_id;
  RETURN _je_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.dispose_fixed_asset(UUID, DATE, NUMERIC) TO authenticated;
