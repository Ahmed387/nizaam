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
  IF cat ILIKE '%advance_repayment%' THEN RETURN 'other_receipt'; END IF;
  IF cat ILIKE '%partner_contribution%' OR cat ILIKE '%partner_capital%' OR cat ILIKE '%رأس مال%' OR cat ILIKE '%راس مال%' THEN
    RETURN CASE WHEN _t.type='expense' THEN 'partner_withdrawal' ELSE 'partner_capital' END;
  END IF;
  IF cat ILIKE '%partner_withdraw%' OR cat ILIKE '%سحب شريك%' OR cat ILIKE '%سحب شركاء%' THEN RETURN 'partner_withdrawal'; END IF;
  IF cat ILIKE '%مورد%' OR cat ILIKE '%shipment%' OR cat ILIKE '%supplier%' THEN RETURN CASE WHEN _t.type='expense' THEN 'supplier_payment' ELSE 'other_receipt' END; END IF;
  IF cat ILIKE '%راتب%' OR cat ILIKE '%salary%' THEN RETURN 'salary'; END IF;
  IF cat ILIKE '%سلف%' OR cat ILIKE '%advance%' THEN RETURN CASE WHEN _t.type='expense' THEN 'advance' ELSE 'other_receipt' END; END IF;
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

CREATE OR REPLACE FUNCTION public.record_partner_advance_payment(_advance_id uuid, _amount numeric, _payment_method text DEFAULT 'manual'::text, _payment_date date DEFAULT CURRENT_DATE, _reference_type text DEFAULT NULL::text, _reference_id uuid DEFAULT NULL::uuid, _notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID; v_remaining NUMERIC(14,2); v_amount_total NUMERIC(14,2);
  v_apply NUMERIC(14,2); v_left NUMERIC(14,2) := _amount;
  v_pay_id UUID; r RECORD; v_partner_branch UUID;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT tenant_id, remaining_amount, amount INTO v_tenant, v_remaining, v_amount_total
    FROM public.partner_advances WHERE id = _advance_id FOR UPDATE;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Advance not found'; END IF;
  IF v_tenant <> public.current_tenant_id() THEN RAISE EXCEPTION 'Cross-tenant denied'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be > 0'; END IF;
  IF _amount > v_remaining + 0.01 THEN RAISE EXCEPTION 'Amount exceeds remaining'; END IF;

  INSERT INTO public.partner_advance_payments (
    advance_id, amount, payment_method, payment_date, reference_type, reference_id, notes, created_by
  ) VALUES (
    _advance_id, _amount, _payment_method, _payment_date, _reference_type, _reference_id, _notes, auth.uid()
  ) RETURNING id INTO v_pay_id;

  IF _payment_method = 'treasury' THEN
    SELECT id INTO v_partner_branch FROM public.branches
     WHERE tenant_id = v_tenant AND is_system AND code = 'PARTNER-CASH' LIMIT 1;
    IF v_partner_branch IS NOT NULL THEN
      INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_id)
      VALUES (v_partner_branch, 'income', 'partner_advance_repayment', _amount,
              COALESCE(_notes,'سداد سلفة شريك'), auth.uid(), v_tenant, 'cash', v_pay_id);
    END IF;
  END IF;

  FOR r IN
    SELECT id, amount, paid_amount FROM public.partner_advance_installments
    WHERE advance_id = _advance_id AND status <> 'paid'
    ORDER BY installment_number
  LOOP
    EXIT WHEN v_left <= 0;
    v_apply := LEAST(r.amount - r.paid_amount, v_left);
    UPDATE public.partner_advance_installments
       SET paid_amount = r.paid_amount + v_apply,
           status = CASE WHEN r.paid_amount + v_apply >= r.amount - 0.001 THEN 'paid' ELSE 'partially_paid' END,
           paid_at = CASE WHEN r.paid_amount + v_apply >= r.amount - 0.001 THEN now() ELSE paid_at END
     WHERE id = r.id;
    v_left := v_left - v_apply;
  END LOOP;

  UPDATE public.partner_advances
     SET remaining_amount = GREATEST(v_remaining - _amount, 0),
         status = CASE
            WHEN v_remaining - _amount <= 0.001 THEN 'fully_paid'
            WHEN v_remaining - _amount < v_amount_total THEN 'partially_paid'
            ELSE status END,
         updated_at = now()
   WHERE id = _advance_id;
  RETURN v_pay_id;
END; $function$;