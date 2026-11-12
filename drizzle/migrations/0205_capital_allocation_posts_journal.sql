-- 0205: owner 2026-11-12 «تجربة ضخ رأس المال نفذ وصلحه». allocate_capital_to_branch moved 1,000 from «خزينة الشركاء» to the branch
-- till with NO journal entry, so both tills differed from the books by the amount (dry-run 2026-11-12). Now each of the two
-- till rows posts its inter-branch leg (post_treasury_transfer_leg: 1100 ↔ 1910 on its own branch — the same entry a money
-- transfer between branches makes), the rows carry the allocation date, and no automatic voucher is made for them.
-- Nothing else changes (same checks, same allocation row). Dry-run after the fix: every till = its books, difference 0.
CREATE OR REPLACE FUNCTION public.allocate_capital_to_branch(_branch_id uuid, _amount numeric, _allocation_date date DEFAULT CURRENT_DATE, _notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _tenant uuid; _id uuid; _partner_branch uuid; _available numeric; _out uuid; _in uuid; _name text;
BEGIN
  SELECT tenant_id, name INTO _tenant, _name FROM public.branches WHERE id = _branch_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF _tenant <> current_tenant_id() THEN RAISE EXCEPTION 'Branch not in tenant'; END IF;
  IF NOT (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'accountant') OR public.is_owner(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF COALESCE(_amount,0) <= 0 THEN RAISE EXCEPTION 'المبلغ لازم يكون أكبر من صفر'; END IF;
  IF _allocation_date > public.cairo_today() THEN RAISE EXCEPTION 'مينفعش تاريخ في المستقبل'; END IF;

  SELECT id INTO _partner_branch FROM public.branches WHERE tenant_id = _tenant AND is_system AND code = 'PARTNER-CASH' LIMIT 1;
  IF _partner_branch IS NULL THEN RAISE EXCEPTION 'خزينة الشركاء غير موجودة'; END IF;
  IF _partner_branch = _branch_id THEN RAISE EXCEPTION 'مينفعش تضخ رأس مال لخزينة الشركاء نفسها'; END IF;

  SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0) INTO _available
    FROM public.treasury WHERE branch_id = _partner_branch AND payment_method = 'cash';
  IF _available < _amount THEN
    RAISE EXCEPTION 'رصيد خزينة الشركاء غير كافٍ — المتاح: % ج.م. سجّل مساهمة الشريك في خزينة الشركاء الأول', ROUND(_available,2);
  END IF;

  INSERT INTO public.branch_capital_allocations(tenant_id, branch_id, amount, allocation_date, notes, created_by)
  VALUES (_tenant, _branch_id, _amount, _allocation_date, _notes, auth.uid()) RETURNING id INTO _id;

  PERFORM set_config('app.skip_treasury_voucher', '1', true);
  INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_id, transaction_date)
  VALUES (_partner_branch, 'expense', 'capital_allocation', _amount, 'ضخ رأس مال لفرع ' || _name, auth.uid(), _tenant, 'cash', _id, _allocation_date)
  RETURNING id INTO _out;
  INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, payment_method, reference_id, transaction_date)
  VALUES (_branch_id, 'income', 'capital_allocation', _amount, 'رأس مال من الشركاء', auth.uid(), _tenant, 'cash', _id, _allocation_date)
  RETURNING id INTO _in;
  PERFORM set_config('app.skip_treasury_voucher', '0', true);

  PERFORM public.post_treasury_transfer_leg(_out);
  PERFORM public.post_treasury_transfer_leg(_in);
  RETURN _id;
END; $function$;
