-- ============ 0) Helpers ============
CREATE OR REPLACE FUNCTION public.ensure_account(_tenant uuid, _code text, _name text, _type account_type)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.chart_of_accounts WHERE tenant_id=_tenant AND code=_code LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.chart_of_accounts(tenant_id, code, name, account_type, normal_balance, is_active)
    VALUES (_tenant, _code, _name, _type,
      CASE WHEN _type IN ('asset','expense') THEN 'debit'::normal_balance ELSE 'credit'::normal_balance END, true)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

-- Post a balanced journal entry from account IDs (internal; bypasses role checks of create_journal_entry)
CREATE OR REPLACE FUNCTION public.post_journal_lines(
  _tenant uuid, _date date, _description text, _source_type text, _source_id uuid,
  _lines jsonb, _branch_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_entry_id uuid; v_seq int; v_number text; v_line jsonb;
  v_debit numeric := 0; v_credit numeric := 0;
BEGIN
  IF _lines IS NULL OR jsonb_array_length(_lines) < 2 THEN
    RAISE EXCEPTION 'Journal entry requires at least 2 lines';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    v_debit  := v_debit  + COALESCE((v_line->>'debit')::numeric,0);
    v_credit := v_credit + COALESCE((v_line->>'credit')::numeric,0);
    IF (v_line->>'account_id') IS NULL THEN RAISE EXCEPTION 'Journal line without account'; END IF;
  END LOOP;
  IF ROUND(v_debit,2) <> ROUND(v_credit,2) THEN
    RAISE EXCEPTION 'Unbalanced entry: debit=% credit=%', v_debit, v_credit;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_tenant::text || 'JE-'||to_char(_date,'YYYYMM')||'-'));
  SELECT COALESCE(MAX(CAST(SPLIT_PART(entry_number,'-',3) AS INTEGER)),0)+1 INTO v_seq
    FROM public.journal_entries
   WHERE tenant_id=_tenant AND entry_number LIKE 'JE-'||to_char(_date,'YYYYMM')||'-%';
  v_number := 'JE-'||to_char(_date,'YYYYMM')||'-'||LPAD(v_seq::text,4,'0');

  INSERT INTO public.journal_entries(tenant_id, entry_number, entry_date, description, source_type, source_id,
                                     status, created_by, total_debit, total_credit, branch_id)
  VALUES (_tenant, v_number, _date, _description, _source_type, _source_id, 'posted', auth.uid(),
          ROUND(v_debit,2), ROUND(v_credit,2), _branch_id)
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_entry_lines(tenant_id, entry_id, account_id, debit, credit, description)
  SELECT _tenant, v_entry_id, (l->>'account_id')::uuid,
         COALESCE((l->>'debit')::numeric,0), COALESCE((l->>'credit')::numeric,0), l->>'description'
  FROM jsonb_array_elements(_lines) l;

  RETURN v_entry_id;
END $$;

REVOKE ALL ON FUNCTION public.post_journal_lines(uuid,date,text,text,uuid,jsonb,uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_account(uuid,text,text,account_type) FROM anon, authenticated;

-- ============ 1) Item 7: stock adjustments hit cost layers + GL ============
CREATE OR REPLACE FUNCTION public.apply_stock_adjustment_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_adj RECORD; v_diff numeric; v_qty numeric; v_cost numeric := 0; v_unit numeric := 0;
  v_res jsonb; v_inv uuid; v_shrink uuid; v_surplus uuid; v_date date;
BEGIN
  SELECT sa.id, sa.branch_id, sa.tenant_id, sa.adjustment_number, sa.created_at::date AS d
    INTO v_adj FROM public.stock_adjustments sa WHERE sa.id = NEW.adjustment_id;

  v_diff := COALESCE(NEW.actual_quantity,0) - COALESCE(NEW.system_quantity,0);
  v_date := COALESCE(v_adj.d, CURRENT_DATE);

  IF v_diff < 0 THEN
    -- Shortage: drain FIFO layers at real cost
    v_qty := -v_diff;
    v_res := public.consume_product_batches_json(NEW.product_id, v_adj.branch_id, v_qty);
    v_unit := COALESCE((v_res->>'weighted_unit_cost')::numeric, 0);
    IF v_unit <= 0 THEN
      SELECT COALESCE(cost_price,0) INTO v_unit FROM public.products WHERE id = NEW.product_id;
    END IF;
    v_cost := ROUND(v_unit * v_qty, 2);
  ELSIF v_diff > 0 THEN
    -- Surplus: create a new cost layer at current purchase cost
    SELECT COALESCE(NULLIF(NEW.unit_cost,0), p.cost_price, 0) INTO v_unit
      FROM public.products p WHERE p.id = NEW.product_id;
    v_unit := COALESCE(v_unit, 0);
    v_cost := ROUND(v_unit * v_diff, 2);
    INSERT INTO public.product_batches(tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining,
                                       cost_price, base_purchase_price, true_unit_cost, batch_type)
    VALUES (v_adj.tenant_id, v_adj.branch_id, NEW.product_id, v_diff, v_diff, v_unit, v_unit, v_unit, 'adjustment');
  END IF;

  UPDATE public.products SET quantity = NEW.actual_quantity WHERE id = NEW.product_id;

  IF v_adj.tenant_id IS NOT NULL AND v_cost > 0 THEN
    v_inv := public.ensure_account(v_adj.tenant_id, '1300', 'Inventory', 'asset');
    IF v_diff < 0 THEN
      v_shrink := public.ensure_account(v_adj.tenant_id, '5600', 'Inventory Shrinkage', 'expense');
      PERFORM public.post_journal_lines(v_adj.tenant_id, v_date,
        'عجز جرد - ' || COALESCE(v_adj.adjustment_number,'') || ' - ' || COALESCE(NEW.product_name,''),
        'stock_adjustment', v_adj.id,
        jsonb_build_array(
          jsonb_build_object('account_id', v_shrink, 'debit', v_cost, 'credit', 0, 'description','خسائر جرد'),
          jsonb_build_object('account_id', v_inv,    'debit', 0, 'credit', v_cost, 'description','تخفيض المخزون')
        ), v_adj.branch_id);
    ELSE
      v_surplus := public.ensure_account(v_adj.tenant_id, '4300', 'Inventory Count Surplus', 'revenue');
      PERFORM public.post_journal_lines(v_adj.tenant_id, v_date,
        'فائض جرد - ' || COALESCE(v_adj.adjustment_number,'') || ' - ' || COALESCE(NEW.product_name,''),
        'stock_adjustment', v_adj.id,
        jsonb_build_array(
          jsonb_build_object('account_id', v_inv,     'debit', v_cost, 'credit', 0, 'description','زيادة المخزون'),
          jsonb_build_object('account_id', v_surplus, 'debit', 0, 'credit', v_cost, 'description','فائض جرد')
        ), v_adj.branch_id);
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- ============ 2) Item 8: fixed assets GL ============
CREATE OR REPLACE FUNCTION public.trg_fixed_asset_journal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_asset uuid; v_clearing uuid;
BEGIN
  IF COALESCE(NEW.cost,0) <= 0 OR NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  v_asset := COALESCE(NEW.asset_account_id, public.ensure_account(NEW.tenant_id,'1500','Fixed Assets','asset'));
  v_clearing := public.ensure_account(NEW.tenant_id,'2350','Fixed Asset Purchases Clearing','liability');
  PERFORM public.post_journal_lines(NEW.tenant_id, NEW.acquisition_date,
    'اقتناء أصل ثابت - ' || NEW.name, 'fixed_asset', NEW.id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_asset,    'debit', ROUND(NEW.cost,2), 'credit', 0, 'description','تكلفة الأصل'),
      jsonb_build_object('account_id', v_clearing, 'debit', 0, 'credit', ROUND(NEW.cost,2), 'description','مستحقات شراء أصول')
    ));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fixed_asset_journal ON public.fixed_assets;
CREATE TRIGGER trg_fixed_asset_journal
AFTER INSERT ON public.fixed_assets
FOR EACH ROW EXECUTE FUNCTION public.trg_fixed_asset_journal();

CREATE OR REPLACE FUNCTION public.dispose_fixed_asset(_asset_id uuid, _disposal_date date, _disposal_amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _asset RECORD; _accum numeric; _nbv numeric; _gain numeric; _je_id uuid;
  _cash uuid; _gain_acc uuid; _loss_acc uuid; _asset_acc uuid; _accum_acc uuid;
  _lines jsonb := '[]'::jsonb; _proceeds numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'owner'::app_role)) THEN
    RAISE EXCEPTION 'Only admins can dispose assets';
  END IF;
  SELECT * INTO _asset FROM public.fixed_assets WHERE id=_asset_id FOR UPDATE;
  IF _asset.id IS NULL THEN RAISE EXCEPTION 'Asset not found'; END IF;
  IF _asset.status = 'disposed' THEN RAISE EXCEPTION 'Asset already disposed'; END IF;

  SELECT COALESCE(SUM(de.amount),0) INTO _accum FROM public.depreciation_entries de WHERE de.asset_id=_asset_id;
  _proceeds := ROUND(COALESCE(_disposal_amount,0),2);
  _accum := ROUND(_accum,2);
  _nbv  := ROUND(_asset.cost,2) - _accum;
  _gain := ROUND(_proceeds - _nbv, 2);

  _cash      := public.ensure_account(_asset.tenant_id,'1100','Cash / Treasury','asset');
  _gain_acc  := public.ensure_account(_asset.tenant_id,'4950','Gain on Asset Disposal','revenue');
  _loss_acc  := public.ensure_account(_asset.tenant_id,'6900','Loss on Asset Disposal','expense');
  _asset_acc := COALESCE(_asset.asset_account_id, public.ensure_account(_asset.tenant_id,'1500','Fixed Assets','asset'));
  _accum_acc := COALESCE(_asset.accum_depreciation_account_id, public.ensure_account(_asset.tenant_id,'1590','Accumulated Depreciation','asset'));

  -- Balance guard: NBV must equal proceeds + loss - gain
  IF ROUND(_nbv,2) <> ROUND(_proceeds + GREATEST(-_gain,0) - GREATEST(_gain,0), 2) THEN
    RAISE EXCEPTION 'قيد الاستبعاد غير متزن';
  END IF;

  IF _proceeds > 0 THEN
    _lines := _lines || jsonb_build_object('account_id',_cash,'debit',_proceeds,'credit',0,'description','قيمة بيع الأصل');
  END IF;
  IF _accum > 0 THEN
    _lines := _lines || jsonb_build_object('account_id',_accum_acc,'debit',_accum,'credit',0,'description','إغلاق مجمع الإهلاك');
  END IF;
  _lines := _lines || jsonb_build_object('account_id',_asset_acc,'debit',0,'credit',ROUND(_asset.cost,2),'description','إزالة تكلفة الأصل');
  IF _gain > 0 THEN
    _lines := _lines || jsonb_build_object('account_id',_gain_acc,'debit',0,'credit',_gain,'description','ربح بيع الأصل');
  ELSIF _gain < 0 THEN
    _lines := _lines || jsonb_build_object('account_id',_loss_acc,'debit',-_gain,'credit',0,'description','خسارة بيع الأصل');
  END IF;

  _je_id := public.post_journal_lines(_asset.tenant_id, _disposal_date,
    'التخلص من أصل ثابت - ' || _asset.name, 'asset_disposal', _asset_id, _lines);

  UPDATE public.fixed_assets
     SET status='disposed', disposal_date=_disposal_date, disposal_amount=_disposal_amount,
         disposal_journal_entry_id=_je_id, updated_at=now()
   WHERE id=_asset_id;
  RETURN _je_id;
END $$;

-- ============ 3) Item 12: single source of truth for net profit ============
CREATE OR REPLACE FUNCTION public.get_financial_kpis(_start_date date, _end_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _tenant uuid := current_tenant_id();
  _core jsonb;
  _revenue NUMERIC := 0; _expense_total NUMERIC := 0; _cogs NUMERIC := 0; _opex NUMERIC := 0;
  _gross_profit NUMERIC := 0; _net_profit NUMERIC := 0; _gross_margin NUMERIC := 0; _net_margin NUMERIC := 0;
  _assets NUMERIC := 0; _liabilities NUMERIC := 0; _equity_gl NUMERIC := 0; _equity NUMERIC := 0;
  _cash NUMERIC := 0; _ar NUMERIC := 0; _ap NUMERIC := 0; _inventory NUMERIC := 0;
  _current_assets NUMERIC := 0; _current_liab NUMERIC := 0;
  _current_ratio NUMERIC; _quick_ratio NUMERIC; _debt_to_equity NUMERIC;
  _roa NUMERIC := 0; _roe NUMERIC := 0; _inv_turnover NUMERIC; _break_even NUMERIC;
BEGIN
  -- Single source of truth (GL based)
  _core := public.compute_net_profit_for_period(_tenant, _start_date, _end_date);
  _revenue       := COALESCE((_core->>'revenue')::numeric, 0);
  _expense_total := COALESCE((_core->>'expense')::numeric, 0);
  _net_profit    := COALESCE((_core->>'net_profit')::numeric, _revenue - _expense_total);

  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO _cogs
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code = '5100' AND je.status='posted'
    AND je.entry_date BETWEEN _start_date AND _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  _opex := _expense_total - _cogs;
  _gross_profit := _revenue - _cogs;
  _gross_margin := CASE WHEN _revenue > 0 THEN (_gross_profit / _revenue) * 100 ELSE 0 END;
  _net_margin   := CASE WHEN _revenue > 0 THEN (_net_profit / _revenue) * 100 ELSE 0 END;

  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO _assets
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type='asset' AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  SELECT COALESCE(SUM(jel.credit - jel.debit), 0) INTO _liabilities
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type='liability' AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  SELECT COALESCE(SUM(jel.credit - jel.debit), 0) INTO _equity_gl
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.account_type='equity' AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  _equity := _equity_gl + _net_profit;

  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO _cash
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '1100%' AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO _ar
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '1200%' AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  SELECT COALESCE(SUM(jel.credit - jel.debit), 0) INTO _ap
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '2100%' AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO _inventory
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '1300%' AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO _current_assets
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '1%' AND coa.code NOT LIKE '15%' AND coa.code NOT LIKE '16%'
    AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  SELECT COALESCE(SUM(jel.credit - jel.debit), 0) INTO _current_liab
  FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id
  WHERE coa.code LIKE '2%' AND coa.code NOT LIKE '25%' AND coa.code NOT LIKE '26%'
    AND je.status='posted' AND je.entry_date <= _end_date
    AND (je.tenant_id = _tenant OR _tenant IS NULL);

  _current_ratio  := CASE WHEN _current_liab > 0 THEN _current_assets / _current_liab END;
  _quick_ratio    := CASE WHEN _current_liab > 0 THEN (_current_assets - _inventory) / _current_liab END;
  _debt_to_equity := CASE WHEN _equity > 0 THEN _liabilities / _equity END;
  _roa            := CASE WHEN _assets > 0 THEN (_net_profit / _assets) * 100 ELSE 0 END;
  _roe            := CASE WHEN _equity > 0 THEN (_net_profit / _equity) * 100 ELSE 0 END;
  _inv_turnover   := CASE WHEN _inventory > 0 THEN _cogs / _inventory END;
  _break_even     := CASE WHEN _gross_margin > 0 THEN _opex / (_gross_margin/100) END;

  RETURN jsonb_build_object(
    'revenue', _revenue, 'cogs', _cogs, 'expenses', _opex,
    'gross_profit', _gross_profit, 'gross_margin_pct', _gross_margin,
    'net_profit', _net_profit, 'net_margin_pct', _net_margin,
    'total_assets', _assets, 'total_liabilities', _liabilities, 'total_equity', _equity,
    'cash_balance', _cash, 'accounts_receivable', _ar, 'accounts_payable', _ap,
    'inventory_value', _inventory, 'current_ratio', _current_ratio, 'quick_ratio', _quick_ratio,
    'debt_to_equity', _debt_to_equity, 'roa_pct', _roa, 'roe_pct', _roe,
    'inventory_turnover', _inv_turnover, 'break_even_revenue', _break_even
  );
END $$;