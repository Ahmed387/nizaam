
CREATE OR REPLACE FUNCTION public.enforce_branch_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_count INT;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  IF public.is_super_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF NEW.code = 'PARTNER-CASH' THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM public.branches
    WHERE tenant_id=NEW.tenant_id AND COALESCE(code,'')<>'PARTNER-CASH';
  IF v_count >= 3 THEN
    RAISE EXCEPTION 'وصلت للحد الأقصى من الفروع (3 فروع لكل شركة)' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END; $function$;

INSERT INTO public.branches (tenant_id, name, code, is_active, address)
SELECT DISTINCT t.tenant_id, 'خزينة الشركاء', 'PARTNER-CASH', true, 'خزينة مركزية للشركاء'
FROM public.branches t
WHERE t.tenant_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.branches b2 WHERE b2.tenant_id=t.tenant_id AND b2.code='PARTNER-CASH');

DO $$
DECLARE
  v_tenant UUID := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
  v_branch UUID; v_ptx UUID; v_pname TEXT; v_creator UUID;
BEGIN
  SELECT id INTO v_branch FROM public.branches WHERE tenant_id=v_tenant AND code='PARTNER-CASH' LIMIT 1;
  IF v_branch IS NULL THEN RETURN; END IF;

  SELECT pt.id, ep.name, pt.created_by INTO v_ptx, v_pname, v_creator
  FROM public.partner_transactions pt
  JOIN public.equity_partners ep ON ep.id=pt.partner_id
  WHERE pt.tenant_id=v_tenant AND pt.transaction_type='drawing' AND pt.amount=20000
  ORDER BY pt.created_at DESC LIMIT 1;
  IF v_ptx IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.treasury WHERE reference_id=v_ptx AND category='partner_withdrawal') THEN RETURN; END IF;

  INSERT INTO public.treasury (tenant_id, branch_id, type, category, amount, description, reference_id, created_by, payment_method, is_fee)
  VALUES (v_tenant, v_branch, 'expense', 'partner_withdrawal', 20000,
          'سحب شريك (تسجيل بأثر رجعي) — '||v_pname, v_ptx, COALESCE(v_creator, gen_random_uuid()), 'cash', false);
END $$;
