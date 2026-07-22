
-- ============================================================
-- Profit Distribution v2: auto-deduct outstanding partner advances
-- + Fiscal period closure guard on journal_entries
-- ============================================================

-- 1) Rewrite distribute_profits to offset outstanding advances against each partner's share
CREATE OR REPLACE FUNCTION public.distribute_profits(
  p_tenant_id uuid, p_fiscal_period_id uuid, p_total_amount numeric,
  p_distribution_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_dist_id UUID; v_entry_id UUID; v_entry_number TEXT;
  v_retained UUID; v_payable UUID; v_advance_asset UUID;
  v_total_share NUMERIC := 0; v_line_order INT := 0;
  v_ptx_id UUID; v_month_year TEXT;
  v_gross NUMERIC; v_offset NUMERIC; v_net_payable NUMERIC;
  v_adv_remaining NUMERIC;
  r RECORD; a RECORD;
BEGIN
  IF p_total_amount <= 0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;

  SELECT COALESCE(SUM(capital_share),0) INTO v_total_share
  FROM public.equity_partners WHERE tenant_id=p_tenant_id AND is_active=true;
  IF v_total_share <= 0 THEN RAISE EXCEPTION 'لا يوجد شركاء نشطين'; END IF;

  SELECT id INTO v_retained FROM public.chart_of_accounts WHERE tenant_id=p_tenant_id AND code='3800' LIMIT 1;
  SELECT id INTO v_payable  FROM public.chart_of_accounts WHERE tenant_id=p_tenant_id AND code='3850' LIMIT 1;
  SELECT id INTO v_advance_asset FROM public.chart_of_accounts WHERE tenant_id=p_tenant_id AND code='1250' LIMIT 1;
  IF v_retained IS NULL OR v_payable IS NULL THEN RAISE EXCEPTION 'حسابات التوزيع غير موجودة'; END IF;

  v_month_year := to_char(p_distribution_date,'YYYY-MM');

  INSERT INTO public.profit_distributions (tenant_id, fiscal_period_id, distribution_date, total_amount, status, notes, created_by)
  VALUES (p_tenant_id, p_fiscal_period_id, p_distribution_date, p_total_amount, 'posted', p_notes, auth.uid())
  RETURNING id INTO v_dist_id;

  v_entry_number := 'DIST-'||to_char(p_distribution_date,'YYYYMMDD')||'-'||substring(v_dist_id::text,1,4);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit, created_by)
  VALUES (p_tenant_id, v_entry_number, p_distribution_date, 'توزيع أرباح على الشركاء', 'profit_distribution', v_dist_id, 'posted', p_total_amount, p_total_amount, auth.uid())
  RETURNING id INTO v_entry_id;

  -- Dr Retained Earnings (total)
  INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
  VALUES (p_tenant_id, v_entry_id, v_retained, p_total_amount, 0, 'توزيع أرباح', 1);
  v_line_order := 1;

  FOR r IN
    SELECT id, name, capital_share FROM public.equity_partners
    WHERE tenant_id=p_tenant_id AND is_active=true
  LOOP
    v_gross := round((p_total_amount * r.capital_share / v_total_share)::numeric, 2);

    -- Auto-offset outstanding advances (FIFO by advance_date)
    v_offset := 0;
    FOR a IN
      SELECT id, remaining_amount FROM public.partner_advances
      WHERE partner_id=r.id AND status IN ('active','partially_paid') AND remaining_amount > 0
      ORDER BY advance_date, created_at
    LOOP
      EXIT WHEN v_offset >= v_gross;
      v_adv_remaining := LEAST(a.remaining_amount, v_gross - v_offset);
      UPDATE public.partner_advances
        SET remaining_amount = remaining_amount - v_adv_remaining,
            status = CASE WHEN remaining_amount - v_adv_remaining <= 0 THEN 'fully_paid' ELSE 'partially_paid' END,
            updated_at = now()
      WHERE id = a.id;

      INSERT INTO public.partner_advance_payments (advance_id, partner_id, amount, payment_date, payment_method, notes, created_by)
      VALUES (a.id, r.id, v_adv_remaining, p_distribution_date, 'profit_offset', 'خصم من نصيب الأرباح', auth.uid());

      v_offset := v_offset + v_adv_remaining;
    END LOOP;

    v_net_payable := v_gross - v_offset;

    -- Partner transaction for the gross profit share (rollup)
    INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by)
    VALUES (p_tenant_id, r.id, 'profit_share', v_gross,
            'نصيب أرباح - '||r.name||CASE WHEN v_offset>0 THEN ' (خصم سلف: '||v_offset::text||')' ELSE '' END,
            v_month_year, auth.uid())
    RETURNING id INTO v_ptx_id;

    UPDATE public.equity_partners
      SET total_profit_share = COALESCE(total_profit_share,0) + v_gross,
          current_balance    = COALESCE(current_balance,0) + v_net_payable
    WHERE id = r.id;

    INSERT INTO public.profit_distribution_lines (distribution_id, partner_id, share_percentage, amount, partner_transaction_id)
    VALUES (v_dist_id, r.id, (r.capital_share/v_total_share)*100, v_gross, v_ptx_id);

    -- Journal: credit advance-asset for offset (settling receivable), credit payable for net
    IF v_offset > 0 AND v_advance_asset IS NOT NULL THEN
      v_line_order := v_line_order + 1;
      INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
      VALUES (p_tenant_id, v_entry_id, v_advance_asset, 0, v_offset, 'تسوية سلفة الشريك '||r.name, v_line_order);
    END IF;
    IF v_net_payable > 0 THEN
      v_line_order := v_line_order + 1;
      INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
      VALUES (p_tenant_id, v_entry_id, v_payable, 0, v_net_payable, 'مستحق للشريك '||r.name, v_line_order);
    END IF;
  END LOOP;

  UPDATE public.profit_distributions SET journal_entry_id = v_entry_id WHERE id = v_dist_id;

  RETURN jsonb_build_object('distribution_id', v_dist_id, 'journal_entry_id', v_entry_id, 'total_amount', p_total_amount);
END;
$function$;

-- 2) Fiscal-period closure guard: block journal entries dated inside a closed period
CREATE OR REPLACE FUNCTION public.enforce_closed_period_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_closed BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM public.fiscal_periods
    WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
      AND status = 'closed'
      AND COALESCE(NEW.entry_date, OLD.entry_date) BETWEEN period_start AND period_end
  ) INTO v_closed;

  -- Allow the closing entry itself and profit-distribution entries created by RPCs
  IF v_closed AND COALESCE(NEW.source_type, OLD.source_type) NOT IN ('fiscal_close','profit_distribution') THEN
    RAISE EXCEPTION 'لا يمكن تعديل قيود يومية داخل فترة محاسبية مغلقة (%)', COALESCE(NEW.entry_date, OLD.entry_date);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_je_closed_period_guard ON public.journal_entries;
CREATE TRIGGER trg_je_closed_period_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_closed_period_guard();

-- Also lock the lines themselves
CREATE OR REPLACE FUNCTION public.enforce_closed_period_lines_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_closed BOOLEAN; v_entry public.journal_entries%ROWTYPE;
BEGIN
  SELECT * INTO v_entry FROM public.journal_entries WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF v_entry.id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.fiscal_periods
    WHERE tenant_id = v_entry.tenant_id AND status='closed'
      AND v_entry.entry_date BETWEEN period_start AND period_end
  ) INTO v_closed;

  IF v_closed AND v_entry.source_type NOT IN ('fiscal_close','profit_distribution') THEN
    RAISE EXCEPTION 'لا يمكن تعديل بنود قيود داخل فترة مغلقة';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_jel_closed_period_guard ON public.journal_entry_lines;
CREATE TRIGGER trg_jel_closed_period_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION public.enforce_closed_period_lines_guard();
