CREATE OR REPLACE FUNCTION public.rebalance_partner_shares(_tenant_id uuid DEFAULT NULL, _pending_capital numeric DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := COALESCE(_tenant_id, public.current_tenant_id());
  v_total numeric; v_sum numeric := 0; v_biggest uuid; r RECORD;
  v_pending numeric := GREATEST(COALESCE(_pending_capital,0), 0);
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_tenant <> public.current_tenant_id() AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Cross-tenant denied';
  END IF;

  SELECT COALESCE(SUM(initial_capital),0) INTO v_total
  FROM public.equity_partners WHERE tenant_id = v_tenant AND is_active = true;
  v_total := v_total + v_pending;
  IF v_total <= 0 THEN RAISE EXCEPTION 'مفيش رؤوس أموال مسجلة للشركاء'; END IF;

  SELECT id INTO v_biggest FROM public.equity_partners
  WHERE tenant_id = v_tenant AND is_active = true
  ORDER BY initial_capital DESC, created_at ASC LIMIT 1;

  IF v_pending > 0 THEN
    -- leave room for the incoming partner: every existing partner gets its plain share
    FOR r IN SELECT id, initial_capital FROM public.equity_partners
             WHERE tenant_id = v_tenant AND is_active = true
    LOOP
      UPDATE public.equity_partners SET capital_share = ROUND(r.initial_capital / v_total, 4) WHERE id = r.id;
    END LOOP;
  ELSE
    FOR r IN SELECT id, initial_capital FROM public.equity_partners
             WHERE tenant_id = v_tenant AND is_active = true AND id <> v_biggest
    LOOP
      UPDATE public.equity_partners SET capital_share = ROUND(r.initial_capital / v_total, 4) WHERE id = r.id;
      v_sum := v_sum + ROUND(r.initial_capital / v_total, 4);
    END LOOP;
    IF v_biggest IS NOT NULL THEN
      UPDATE public.equity_partners SET capital_share = ROUND(1 - v_sum, 4) WHERE id = v_biggest;
    END IF;
  END IF;

  RETURN (SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'capital',initial_capital,'share',capital_share) ORDER BY name)
          FROM public.equity_partners WHERE tenant_id = v_tenant AND is_active = true);
END $$;

GRANT EXECUTE ON FUNCTION public.rebalance_partner_shares(uuid, numeric) TO authenticated;