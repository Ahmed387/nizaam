
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
  v_current_balance NUMERIC;
BEGIN
  IF NOT is_admin(auth.uid()) AND NOT is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can record partner transactions';
  END IF;

  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر';
  END IF;

  SELECT tenant_id, current_balance
    INTO v_tenant, v_current_balance
  FROM public.equity_partners
  WHERE id = _partner_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Partner not found'; END IF;

  -- Hard-block overdraft on withdrawals/drawings
  IF _transaction_type ILIKE 'drawing%' OR _transaction_type ILIKE 'withdraw%' THEN
    IF _amount > COALESCE(v_current_balance, 0) THEN
      RAISE EXCEPTION 'لا يمكن تنفيذ السحب. الرصيد المتاح: % ج. لطلب سلفة، تواصل مع المالك عبر /admin/partner-advances',
        to_char(COALESCE(v_current_balance, 0), 'FM999,999,990.00');
    END IF;
  END IF;

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
