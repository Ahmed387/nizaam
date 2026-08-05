CREATE OR REPLACE FUNCTION public.set_partner_capital(_partner_id uuid, _amount numeric, _rebalance boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_tenant uuid; v_old numeric; v_diff numeric;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'المبلغ غير صحيح'; END IF;

  SELECT tenant_id, initial_capital INTO v_tenant, v_old
  FROM public.equity_partners WHERE id = _partner_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Partner not found'; END IF;
  IF v_tenant <> public.current_tenant_id() THEN RAISE EXCEPTION 'Cross-tenant denied'; END IF;

  UPDATE public.equity_partners SET initial_capital = _amount WHERE id = _partner_id;

  v_diff := _amount - COALESCE(v_old,0);
  IF v_diff <> 0 THEN
    INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by)
    VALUES (v_tenant, _partner_id,
            CASE WHEN v_diff > 0 THEN 'contribution' ELSE 'drawing' END,
            abs(v_diff),
            'تعديل رأس المال المدفوع', to_char(CURRENT_DATE,'YYYY-MM'), auth.uid());
  END IF;

  IF _rebalance THEN RETURN public.rebalance_partner_shares(v_tenant, 0); END IF;
  RETURN NULL;
END $$;

DROP FUNCTION IF EXISTS public.rebalance_partner_shares(uuid);