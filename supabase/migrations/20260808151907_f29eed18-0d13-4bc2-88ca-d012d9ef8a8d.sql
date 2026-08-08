CREATE OR REPLACE FUNCTION public.map_treasury_to_category_key(_t treasury)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  cat TEXT := COALESCE(_t.category, '');
BEGIN
  IF _t.is_fee THEN RETURN 'transfer_fee'; END IF;
  IF cat ILIKE '%capital_allocation%' THEN
    RETURN CASE WHEN _t.type='expense' THEN 'branch_transfer_out' ELSE 'branch_transfer_in' END;
  END IF;
  IF cat ILIKE '%partner_contribution%' OR cat ILIKE '%partner_capital%' OR cat ILIKE '%رأس مال%' OR cat ILIKE '%راس مال%' THEN
    RETURN CASE WHEN _t.type='expense' THEN 'partner_withdrawal' ELSE 'partner_capital' END;
  END IF;
  IF cat ILIKE '%partner_withdraw%' OR cat ILIKE '%سحب شريك%' OR cat ILIKE '%سحب شركاء%' THEN RETURN 'partner_withdrawal'; END IF;
  IF cat ILIKE '%مورد%' OR cat ILIKE '%shipment%' OR cat ILIKE '%supplier%' THEN RETURN CASE WHEN _t.type='expense' THEN 'supplier_payment' ELSE 'other_receipt' END; END IF;
  IF cat ILIKE '%راتب%' OR cat ILIKE '%salary%' THEN RETURN 'salary'; END IF;
  IF cat ILIKE '%سلف%' OR cat ILIKE '%advance%' THEN RETURN 'advance'; END IF;
  IF cat ILIKE '%إيجار%' OR cat ILIKE '%ايجار%' OR cat ILIKE '%rent%' THEN RETURN 'rent'; END IF;
  IF cat ILIKE '%كهرب%' OR cat ILIKE '%مياه%' OR cat ILIKE '%utilit%' THEN RETURN 'utilities'; END IF;
  IF cat ILIKE '%صيان%' OR cat ILIKE '%maintenance%' THEN RETURN 'maintenance'; END IF;
  IF cat ILIKE '%شحن%' OR cat ILIKE '%shipping%' THEN RETURN 'shipping'; END IF;
  IF cat ILIKE '%مرتجع%' OR cat ILIKE '%return%' THEN RETURN CASE WHEN _t.type='expense' THEN 'customer_return' ELSE 'other_receipt' END; END IF;
  IF cat ILIKE '%تحويل%' OR cat ILIKE '%transfer%' THEN RETURN CASE WHEN _t.type='expense' THEN 'branch_transfer_out' ELSE 'branch_transfer_in' END; END IF;
  IF cat ILIKE '%قسط%' OR cat ILIKE '%installment%' THEN RETURN 'installment'; END IF;
  IF cat ILIKE '%مبيع%' OR cat ILIKE '%sale%' OR cat ILIKE '%invoice%' THEN RETURN 'cash_sale'; END IF;
  RETURN CASE WHEN _t.type='expense' THEN 'other_payment' ELSE 'other_receipt' END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_partner_transaction(_partner_id uuid, _transaction_type text, _amount numeric, _description text DEFAULT NULL::text, _month_year text DEFAULT NULL::text, _treasury_id uuid DEFAULT NULL::uuid, _voucher_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
  v_tx_id UUID;
  v_current_balance NUMERIC;
  v_partner_branch UUID;
  v_cash NUMERIC;
  v_treasury UUID := _treasury_id;
BEGIN
  IF NOT is_admin(auth.uid()) AND NOT is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can record partner transactions';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.equity_partners WHERE id = _partner_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Partner not found'; END IF;

  SELECT id INTO v_partner_branch FROM public.branches
   WHERE tenant_id = v_tenant AND is_system AND code = 'PARTNER-CASH' LIMIT 1;

  IF _transaction_type ILIKE 'drawing%' OR _transaction_type ILIKE 'withdraw%' THEN
    SELECT COALESCE(current_balance,0) INTO v_current_balance
      FROM public.v_partner_balances WHERE partner_id = _partner_id;
    IF _amount > COALESCE(v_current_balance, 0) THEN
      RAISE EXCEPTION 'لا يمكن تنفيذ السحب. الرصيد المتاح: % ج. لطلب سلفة، تواصل مع المالك عبر /admin/partner-advances',
        to_char(COALESCE(v_current_balance, 0), 'FM999,999,990.00');
    END IF;
    IF v_partner_branch IS NOT NULL THEN
      SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) INTO v_cash
        FROM public.treasury WHERE branch_id = v_partner_branch AND payment_method='cash';
      IF v_cash < _amount THEN
        RAISE EXCEPTION 'كاش خزينة الشركاء غير كافٍ — المتاح: % ج.م', ROUND(COALESCE(v_cash,0),2);
      END IF;
    END IF;
  END IF;

  -- حركة الكاش الفعلية في خزينة الشركاء (مساهمة = دخول، مسحوبة = خروج)
  IF v_treasury IS NULL AND v_partner_branch IS NOT NULL THEN
    IF _transaction_type ILIKE 'contribution%' THEN
      INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method)
      VALUES (v_partner_branch, 'income', 'partner_contribution', _amount,
              COALESCE(_description, 'مساهمة رأس مال شريك'), auth.uid(), v_tenant, 'cash')
      RETURNING id INTO v_treasury;
    ELSIF _transaction_type ILIKE 'drawing%' OR _transaction_type ILIKE 'withdraw%' THEN
      INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method)
      VALUES (v_partner_branch, 'expense', 'partner_withdrawal', _amount,
              COALESCE(_description, 'سحب شريك'), auth.uid(), v_tenant, 'cash')
      RETURNING id INTO v_treasury;
    END IF;
  END IF;

  INSERT INTO public.partner_transactions
    (tenant_id, partner_id, transaction_type, amount, description, month_year,
     related_treasury_id, related_voucher_id, created_by)
  VALUES (v_tenant, _partner_id, _transaction_type, _amount, _description,
          COALESCE(_month_year, to_char(CURRENT_DATE, 'YYYY-MM')),
          v_treasury, _voucher_id, auth.uid())
  RETURNING id INTO v_tx_id;

  RETURN v_tx_id;
END; $function$;