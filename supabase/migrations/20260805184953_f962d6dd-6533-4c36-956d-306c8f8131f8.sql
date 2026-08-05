-- 1) make the shares-total check deferred (checked at end of transaction)
DROP TRIGGER IF EXISTS trg_partner_shares_total ON public.equity_partners;

CREATE OR REPLACE FUNCTION public.enforce_partner_shares_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_total numeric;
BEGIN
  SELECT COALESCE(SUM(capital_share),0) INTO v_total
  FROM public.equity_partners
  WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id) AND is_active = true;

  IF v_total > 1.0001 THEN
    RAISE EXCEPTION 'مجموع نسب الشركاء لا يمكن أن يتجاوز 100%% — المجموع الحالي %%%',
      round(v_total*100, 2)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $function$;

CREATE CONSTRAINT TRIGGER trg_partner_shares_total
AFTER INSERT OR UPDATE OF capital_share, is_active ON public.equity_partners
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_partner_shares_total();

-- 2) rebalance shares from paid capital, remainder to the largest partner
CREATE OR REPLACE FUNCTION public.rebalance_partner_shares(_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := COALESCE(_tenant_id, public.current_tenant_id());
  v_total numeric; v_sum numeric := 0; v_biggest uuid; r RECORD;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_tenant <> public.current_tenant_id() AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Cross-tenant denied';
  END IF;

  SELECT COALESCE(SUM(initial_capital),0) INTO v_total
  FROM public.equity_partners WHERE tenant_id = v_tenant AND is_active = true;
  IF v_total <= 0 THEN RAISE EXCEPTION 'مفيش رؤوس أموال مسجلة للشركاء'; END IF;

  SELECT id INTO v_biggest FROM public.equity_partners
  WHERE tenant_id = v_tenant AND is_active = true
  ORDER BY initial_capital DESC, created_at ASC LIMIT 1;

  FOR r IN
    SELECT id, initial_capital FROM public.equity_partners
    WHERE tenant_id = v_tenant AND is_active = true AND id <> v_biggest
  LOOP
    UPDATE public.equity_partners
      SET capital_share = ROUND(r.initial_capital / v_total, 4)
      WHERE id = r.id;
    v_sum := v_sum + ROUND(r.initial_capital / v_total, 4);
  END LOOP;

  UPDATE public.equity_partners SET capital_share = ROUND(1 - v_sum, 4) WHERE id = v_biggest;

  RETURN (SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'capital',initial_capital,'share',capital_share) ORDER BY name)
          FROM public.equity_partners WHERE tenant_id = v_tenant AND is_active = true);
END $$;

GRANT EXECUTE ON FUNCTION public.rebalance_partner_shares(uuid) TO authenticated;

-- 3) change a partner's paid capital (and optionally rebalance everyone)
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

  -- keep the partner ledger in sync with the declared capital
  v_diff := _amount - COALESCE(v_old,0);
  IF v_diff <> 0 THEN
    IF v_diff > 0 THEN
      INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by)
      VALUES (v_tenant, _partner_id, 'contribution', v_diff, 'تعديل رأس المال المدفوع', to_char(CURRENT_DATE,'YYYY-MM'), auth.uid());
    ELSE
      INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by)
      VALUES (v_tenant, _partner_id, 'drawing', -v_diff, 'تعديل رأس المال المدفوع (تخفيض)', to_char(CURRENT_DATE,'YYYY-MM'), auth.uid());
    END IF;
  END IF;

  IF _rebalance THEN RETURN public.rebalance_partner_shares(v_tenant); END IF;
  RETURN NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.set_partner_capital(uuid, numeric, boolean) TO authenticated;

-- 4) cancel a partner advance
CREATE OR REPLACE FUNCTION public.cancel_partner_advance(_advance_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_tenant uuid; v_status text; v_profit_paid numeric; v_other_paid numeric;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT tenant_id, status INTO v_tenant, v_status FROM public.partner_advances WHERE id = _advance_id FOR UPDATE;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Advance not found'; END IF;
  IF v_tenant <> public.current_tenant_id() THEN RAISE EXCEPTION 'Cross-tenant denied'; END IF;
  IF v_status = 'cancelled' THEN RAISE EXCEPTION 'السلفة ملغاة بالفعل'; END IF;

  SELECT COALESCE(SUM(amount) FILTER (WHERE payment_method='profit_deduction'),0),
         COALESCE(SUM(amount) FILTER (WHERE payment_method<>'profit_deduction'),0)
    INTO v_profit_paid, v_other_paid
  FROM public.partner_advance_payments WHERE advance_id = _advance_id;

  IF v_profit_paid > 0 THEN
    RAISE EXCEPTION 'مينفعش تلغي السلفة: اتخصم منها % ج.م من توزيع أرباح متسجل. لازم تعدل/تلغي التوزيع الأول.',
      to_char(v_profit_paid,'FM999,999,990.00') USING ERRCODE='check_violation';
  END IF;

  UPDATE public.partner_advance_installments
     SET status = 'cancelled', updated_at = now()
   WHERE advance_id = _advance_id AND status <> 'paid';

  UPDATE public.partner_advances
     SET status = 'cancelled', remaining_amount = 0, updated_at = now(),
         notes = COALESCE(notes,'') || CASE WHEN _reason IS NULL THEN '' ELSE E'\nسبب الإلغاء: ' || _reason END
   WHERE id = _advance_id;

  RETURN jsonb_build_object('cancelled', true, 'repaid_before_cancel', v_other_paid);
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_partner_advance(uuid, text) TO authenticated;