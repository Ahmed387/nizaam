DROP TRIGGER IF EXISTS trg_partner_advance_payments_journal ON public.partner_advance_payments;

CREATE OR REPLACE FUNCTION public.trg_partner_advance_payment_journal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_partner uuid; v_pname text;
  v_cash uuid; v_adv uuid; v_entry uuid; v_num text;
BEGIN
  IF NEW.payment_method = 'profit_deduction' THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM public.journal_entries
             WHERE source_type='partner_advance_payment' AND source_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT a.tenant_id, a.partner_id, p.name INTO v_tenant, v_partner, v_pname
  FROM public.partner_advances a JOIN public.equity_partners p ON p.id = a.partner_id
  WHERE a.id = NEW.advance_id;
  IF v_tenant IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_cash FROM public.chart_of_accounts WHERE tenant_id=v_tenant AND code='1100' LIMIT 1;
  SELECT id INTO v_adv  FROM public.chart_of_accounts WHERE tenant_id=v_tenant AND code='1400' LIMIT 1;
  IF v_cash IS NULL OR v_adv IS NULL THEN RETURN NEW; END IF;

  v_num := 'ADVP-'||to_char(NEW.payment_date,'YYYYMMDD')||'-'||substring(replace(NEW.id::text,'-',''),1,10);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit, created_by)
  VALUES (v_tenant, v_num, NEW.payment_date, 'سداد سلفة الشريك '||v_pname, 'partner_advance_payment', NEW.id, 'posted', NEW.amount, NEW.amount, NEW.created_by)
  RETURNING id INTO v_entry;

  INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
  VALUES (v_tenant, v_entry, v_cash, NEW.amount, 0, 'سداد سلفة نقداً', 1),
         (v_tenant, v_entry, v_adv, 0, NEW.amount, 'تخفيض سلفة الشريك '||v_pname, 2);
  RETURN NEW;
END $function$;