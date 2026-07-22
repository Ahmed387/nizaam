
CREATE OR REPLACE FUNCTION public.check_treasury_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_balance numeric; v_code text;
BEGIN
  IF NEW.type = 'expense' THEN
    SELECT code INTO v_code FROM public.branches WHERE id = NEW.branch_id;
    IF v_code = 'PARTNER-CASH' THEN RETURN NEW; END IF;

    SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
      INTO v_balance FROM public.treasury WHERE branch_id = NEW.branch_id;

    IF v_balance < NEW.amount THEN
      RAISE EXCEPTION 'رصيد الخزنة غير كافٍ — الرصيد الحالي: % جنيه', v_balance
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- Reverse duplicate JE-202607-0043
DO $$
DECLARE v_dup UUID := 'aa9969d5-5a86-4d1e-850d-459dee55a8d6';
        v_rev UUID; v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.journal_entries WHERE id=v_dup;
  IF v_tenant IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.journal_entries WHERE description='عكس قيد مكرر — JE-202607-0043') THEN RETURN; END IF;

  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source_type, status, total_debit, total_credit)
  VALUES (v_tenant, 'REV-JE-202607-0043', CURRENT_DATE,
          'عكس قيد مكرر — JE-202607-0043', 'reversal', 'draft', 0, 0)
  RETURNING id INTO v_rev;

  INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
  SELECT tenant_id, v_rev, account_id, credit, debit, 'عكس: '||COALESCE(description,''), line_order
  FROM public.journal_entry_lines WHERE entry_id=v_dup;

  UPDATE public.journal_entries
     SET total_debit=(SELECT COALESCE(SUM(debit),0) FROM public.journal_entry_lines WHERE entry_id=v_rev),
         total_credit=(SELECT COALESCE(SUM(credit),0) FROM public.journal_entry_lines WHERE entry_id=v_rev),
         status='posted'
   WHERE id=v_rev;
END $$;

-- Retro-record the 20,000 withdrawal in partner cash treasury
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
