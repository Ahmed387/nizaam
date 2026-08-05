CREATE OR REPLACE FUNCTION public.trg_partner_advance_payment_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid; v_partner uuid; v_pname text;
  v_cash uuid; v_adv uuid; v_entry uuid; v_num text;
BEGIN
  IF NEW.payment_method = 'profit_deduction' THEN RETURN NEW; END IF;

  SELECT a.tenant_id, a.partner_id, p.name INTO v_tenant, v_partner, v_pname
  FROM public.partner_advances a JOIN public.equity_partners p ON p.id = a.partner_id
  WHERE a.id = NEW.advance_id;
  IF v_tenant IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_cash FROM public.chart_of_accounts WHERE tenant_id=v_tenant AND code='1100' LIMIT 1;
  SELECT id INTO v_adv  FROM public.chart_of_accounts WHERE tenant_id=v_tenant AND code='1400' LIMIT 1;
  IF v_cash IS NULL OR v_adv IS NULL THEN RETURN NEW; END IF;

  v_num := 'ADVP-'||to_char(NEW.payment_date,'YYYYMMDD')||'-'||substring(NEW.id::text,1,4);
  INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit, created_by)
  VALUES (v_tenant, v_num, NEW.payment_date, 'سداد سلفة الشريك '||v_pname, 'partner_advance_payment', NEW.id, 'posted', NEW.amount, NEW.amount, NEW.created_by)
  RETURNING id INTO v_entry;

  INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
  VALUES (v_tenant, v_entry, v_cash, NEW.amount, 0, 'سداد سلفة نقداً', 1),
         (v_tenant, v_entry, v_adv, 0, NEW.amount, 'تخفيض سلفة الشريك '||v_pname, 2);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_partner_advance_payment_journal ON public.partner_advance_payments;
CREATE TRIGGER trg_partner_advance_payment_journal
AFTER INSERT ON public.partner_advance_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_partner_advance_payment_journal();

CREATE OR REPLACE FUNCTION public.cancel_partner_advance(_advance_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid; v_status text; v_partner uuid; v_pname text;
  v_remaining numeric; v_profit_paid numeric; v_other_paid numeric;
  v_adv uuid; v_equity uuid; v_entry uuid; v_num text;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT a.tenant_id, a.status, a.partner_id, a.remaining_amount, p.name
    INTO v_tenant, v_status, v_partner, v_remaining, v_pname
  FROM public.partner_advances a JOIN public.equity_partners p ON p.id=a.partner_id
  WHERE a.id = _advance_id FOR UPDATE OF a;
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

  -- convert the still-outstanding part into a partner drawing (money already left the treasury)
  IF v_remaining > 0 THEN
    INSERT INTO public.partner_transactions (tenant_id, partner_id, transaction_type, amount, description, month_year, created_by)
    VALUES (v_tenant, v_partner, 'drawing', v_remaining,
            'تحويل باقي سلفة ملغاة إلى مسحوبات'||CASE WHEN _reason IS NULL THEN '' ELSE ' — '||_reason END,
            to_char(CURRENT_DATE,'YYYY-MM'), auth.uid());

    SELECT id INTO v_adv    FROM public.chart_of_accounts WHERE tenant_id=v_tenant AND code='1400' LIMIT 1;
    SELECT id INTO v_equity FROM public.chart_of_accounts WHERE tenant_id=v_tenant AND code='3850' LIMIT 1;
    IF v_adv IS NOT NULL AND v_equity IS NOT NULL THEN
      v_num := 'ADVC-'||to_char(CURRENT_DATE,'YYYYMMDD')||'-'||substring(_advance_id::text,1,4);
      INSERT INTO public.journal_entries (tenant_id, entry_number, entry_date, description, source_type, source_id, status, total_debit, total_credit, created_by)
      VALUES (v_tenant, v_num, CURRENT_DATE, 'إلغاء سلفة الشريك '||v_pname||' وتحويلها لمسحوبات', 'partner_advance_cancel', _advance_id, 'posted', v_remaining, v_remaining, auth.uid())
      RETURNING id INTO v_entry;
      INSERT INTO public.journal_entry_lines (tenant_id, entry_id, account_id, debit, credit, description, line_order)
      VALUES (v_tenant, v_entry, v_equity, v_remaining, 0, 'مسحوبات الشريك '||v_pname, 1),
             (v_tenant, v_entry, v_adv, 0, v_remaining, 'إقفال سلفة ملغاة', 2);
    END IF;
  END IF;

  UPDATE public.partner_advance_installments
     SET status = 'cancelled', updated_at = now()
   WHERE advance_id = _advance_id AND status <> 'paid';

  UPDATE public.partner_advances
     SET status = 'cancelled', remaining_amount = 0, updated_at = now(),
         notes = COALESCE(notes,'') || CASE WHEN _reason IS NULL THEN '' ELSE E'\nسبب الإلغاء: ' || _reason END
   WHERE id = _advance_id;

  RETURN jsonb_build_object('cancelled', true, 'repaid_before_cancel', v_other_paid, 'converted_to_drawing', v_remaining);
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_partner_advance(uuid, text) TO authenticated;