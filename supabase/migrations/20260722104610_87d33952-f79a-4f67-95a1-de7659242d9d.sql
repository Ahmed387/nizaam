
-- 1) Skip auto-journal for profit_share (distribute_profits already creates the GL entry)
CREATE OR REPLACE FUNCTION public.trg_partner_tx_journal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_lines JSONB;
BEGIN
  IF TG_OP <> 'INSERT' OR COALESCE(NEW.amount,0) = 0 THEN RETURN NEW; END IF;

  IF NEW.transaction_type ILIKE 'contribution%' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','1100','debit',NEW.amount,'credit',0,'description','Partner contribution'),
      jsonb_build_object('account_code','3100','debit',0,'credit',NEW.amount,'description',COALESCE(NEW.description,'Contribution'))
    );
  ELSIF NEW.transaction_type ILIKE 'drawing%' OR NEW.transaction_type ILIKE 'withdraw%' THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code','3200','debit',NEW.amount,'credit',0,'description',COALESCE(NEW.description,'Drawing')),
      jsonb_build_object('account_code','1100','debit',0,'credit',NEW.amount,'description','Partner drawing')
    );
  ELSE
    -- profit_share and everything else: distribute_profits / other flows create their own GL entries
    RETURN NEW;
  END IF;

  PERFORM public.post_journal(NEW.tenant_id, CURRENT_DATE,
    'Partner '||NEW.transaction_type, 'partner_transaction', NEW.id, v_lines);
  RETURN NEW;
END $function$;

-- 2) Remove manual balance updates in distribute_profits (trigger sync_partner_balance handles them)
CREATE OR REPLACE FUNCTION public.distribute_profits(p_tenant_id uuid, p_fiscal_period_id uuid, p_total_amount numeric, p_distribution_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  SELECT id INTO v_advance_asset FROM public.chart_of_accounts WHERE tenant_id=p_tenant_id AND code='1400' LIMIT 1;
  IF v_retained IS NULL OR v_payable IS NULL THEN RAISE EXCEPTION 'حسابات التوزيع (3800/3850) غير موجودة'; END IF;

  v_month_year := to_char(p_distribution_date,'YYYY-MM');

  INSERT INTO public.profit_distributions (tenant_id, fiscal_period_id, distribution_date, total_amount, status, notes, created_by)
  VALUES (p_tenant_id, p_fiscal_period_id, p_distribution_date, p_total_amount, 'posted', p_notes, auth.uid())
  RETURNING id INTO v_dist_id;

  v_entry_number := 'DIST-'||to_char(p_distribution_date,'YYYYMMDD')||'-'||substring(v_dist_id::text,1,4);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit, created_by)
  VALUES (p_tenant_id, v_entry_number, p_distribution_date, 'توزيع أرباح على الشركاء', 'profit_distribution', v_dist_id, 'draft', 0, 0, auth.uid())
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
  VALUES (p_tenant_id, v_entry_id, v_retained, p_total_amount, 0, 'توزيع أرباح', 1);
  v_line_order := 1;

  FOR r IN
    SELECT id, name, capital_share FROM public.equity_partners
    WHERE tenant_id=p_tenant_id AND is_active=true
  LOOP
    v_gross := round((p_total_amount * r.capital_share / v_total_share)::numeric, 2);
    v_offset := 0;
    FOR a IN
      SELECT id, remaining_amount FROM public.partner_advances
      WHERE partner_id=r.id AND status IN ('active','partially_paid') AND remaining_amount > 0
      ORDER BY advance_date ASC, created_at ASC
    LOOP
      EXIT WHEN v_offset >= v_gross;
      v_adv_remaining := LEAST(a.remaining_amount, v_gross - v_offset);
      IF v_adv_remaining > 0 THEN
        INSERT INTO public.partner_advance_payments (tenant_id, advance_id, partner_id, payment_date, amount, notes, created_by)
        VALUES (p_tenant_id, a.id, r.id, p_distribution_date, v_adv_remaining, 'خصم من توزيع الأرباح', auth.uid());
        UPDATE public.partner_advances
        SET remaining_amount = remaining_amount - v_adv_remaining,
            status = CASE WHEN remaining_amount - v_adv_remaining <= 0 THEN 'fully_paid'
                          ELSE 'partially_paid' END
        WHERE id = a.id;
        v_offset := v_offset + v_adv_remaining;
      END IF;
    END LOOP;
    v_net_payable := v_gross - v_offset;

    -- partner_transactions insert; sync_partner_balance trigger will update current_balance + total_profit_share
    INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by)
    VALUES (p_tenant_id, r.id, 'profit_share', v_net_payable,
            'نصيب من التوزيع'||CASE WHEN v_offset > 0 THEN ' (خصم سلفة: '||v_offset||')' ELSE '' END,
            v_month_year, auth.uid())
    RETURNING id INTO v_ptx_id;

    -- Track gross profit share separately (not affecting balance since trigger uses NEW.amount)
    UPDATE public.equity_partners
    SET total_profit_share = COALESCE(total_profit_share,0) + (v_gross - v_net_payable)
    WHERE id = r.id;

    INSERT INTO public.profit_distribution_lines (distribution_id, partner_id, share_percentage, amount, partner_transaction_id)
    VALUES (v_dist_id, r.id, (r.capital_share/v_total_share)*100, v_gross, v_ptx_id);

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

  UPDATE public.journal_entries SET status = 'posted' WHERE id = v_entry_id;
  UPDATE public.profit_distributions SET journal_entry_id = v_entry_id WHERE id = v_dist_id;
  RETURN jsonb_build_object('distribution_id', v_dist_id, 'journal_entry_id', v_entry_id, 'total_amount', p_total_amount);
END $function$;
