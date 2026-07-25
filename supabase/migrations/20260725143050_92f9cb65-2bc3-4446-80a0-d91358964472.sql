
CREATE OR REPLACE FUNCTION public.partner_withdraw_from_distribution(
  p_tenant_id uuid, p_partner_id uuid, p_amount numeric,
  p_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_partner RECORD; v_balance numeric; v_outstanding numeric; v_net numeric;
  v_cash UUID; v_payable UUID; v_entry_id UUID; v_entry_number TEXT; v_ptx_id UUID;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;
  SELECT * INTO v_partner FROM public.equity_partners
  WHERE id=p_partner_id AND tenant_id=p_tenant_id AND is_active=true;
  IF v_partner IS NULL THEN RAISE EXCEPTION 'الشريك غير موجود أو غير نشط'; END IF;

  SELECT COALESCE(current_balance,0) INTO v_balance
  FROM public.v_partner_balances WHERE partner_id = p_partner_id;
  v_balance := COALESCE(v_balance, 0);

  SELECT COALESCE(SUM(remaining_amount),0) INTO v_outstanding
  FROM public.partner_advances
  WHERE partner_id = p_partner_id AND status IN ('active','partially_paid');

  v_net := v_balance - v_outstanding;

  IF v_net <= 0 THEN
    RAISE EXCEPTION 'لا يوجد صافي متاح للسحب — الرصيد % والسلف القائمة %', v_balance, v_outstanding;
  END IF;
  IF p_amount > v_net THEN
    RAISE EXCEPTION 'المبلغ المطلوب % أكبر من الصافي المتاح % (الرصيد % − السلف %)',
      p_amount, v_net, v_balance, v_outstanding;
  END IF;

  SELECT id INTO v_cash FROM public.chart_of_accounts WHERE tenant_id=p_tenant_id AND code='1100' LIMIT 1;
  SELECT id INTO v_payable FROM public.chart_of_accounts WHERE tenant_id=p_tenant_id AND code='3850' LIMIT 1;
  IF v_cash IS NULL OR v_payable IS NULL THEN RAISE EXCEPTION 'الحسابات (1100/3850) غير موجودة'; END IF;

  INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by)
  VALUES (p_tenant_id, p_partner_id, 'drawing', p_amount,
          COALESCE(p_notes, 'سحب من رصيد توزيع الأرباح'),
          to_char(p_date,'YYYY-MM'), auth.uid())
  RETURNING id INTO v_ptx_id;

  v_entry_number := 'PW-'||to_char(p_date,'YYYYMMDD')||'-'||substring(gen_random_uuid()::text,1,4);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit, created_by)
  VALUES (p_tenant_id, v_entry_number, p_date,
          'سحب من رصيد التوزيع — '||v_partner.name,
          'partner_withdrawal', v_ptx_id, 'posted', p_amount, p_amount, auth.uid())
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
  VALUES (p_tenant_id, v_entry_id, v_payable, p_amount, 0, 'سحب رصيد '||v_partner.name, 1),
         (p_tenant_id, v_entry_id, v_cash,    0, p_amount, 'صرف نقدي للشريك '||v_partner.name, 2);

  RETURN jsonb_build_object(
    'partner_transaction_id', v_ptx_id,
    'journal_entry_id', v_entry_id,
    'amount', p_amount,
    'balance', v_balance,
    'outstanding_advances', v_outstanding,
    'net_available_before', v_net,
    'net_available_after', v_net - p_amount
  );
END $function$;

-- Helper: net-balance snapshot for UI
CREATE OR REPLACE FUNCTION public.get_partner_net_balance(p_partner_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_bal numeric; v_out numeric;
BEGIN
  SELECT COALESCE(current_balance,0) INTO v_bal
  FROM public.v_partner_balances WHERE partner_id = p_partner_id;
  SELECT COALESCE(SUM(remaining_amount),0) INTO v_out
  FROM public.partner_advances
  WHERE partner_id = p_partner_id AND status IN ('active','partially_paid');
  RETURN jsonb_build_object(
    'current_balance', COALESCE(v_bal,0),
    'outstanding_advances', COALESCE(v_out,0),
    'net_available', COALESCE(v_bal,0) - COALESCE(v_out,0)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_partner_net_balance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_withdraw_from_distribution(uuid,uuid,numeric,date,text) TO authenticated, service_role;
