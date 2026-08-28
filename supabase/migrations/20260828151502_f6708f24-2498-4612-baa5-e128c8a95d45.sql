-- ============ 1) reverse_profit_distribution: restore partner advances ============
CREATE OR REPLACE FUNCTION public.reverse_profit_distribution(p_tenant_id uuid, p_distribution_id uuid, p_reason text DEFAULT 'Reversal'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dist RECORD; v_line RECORD; v_adv RECORD;
BEGIN
  SELECT * INTO v_dist FROM public.profit_distributions
   WHERE id = p_distribution_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'التوزيع غير موجود'; END IF;
  IF v_dist.status = 'reversed' THEN RAISE EXCEPTION 'التوزيع سبق عكسه'; END IF;

  -- Reverse (not delete) the journal entry -> preserves audit trail
  PERFORM public.reverse_journal_for_source(
    p_tenant_id, 'profit_distribution', p_distribution_id, COALESCE(p_reason, 'Reversal')
  );

  FOR v_line IN
    SELECT * FROM public.profit_distribution_lines WHERE distribution_id = p_distribution_id
  LOOP
    IF v_line.partner_transaction_id IS NOT NULL THEN
      UPDATE public.partner_transactions
        SET is_void = TRUE, description = COALESCE(description,'') || ' [REVERSED]'
      WHERE id = v_line.partner_transaction_id;
    END IF;

    INSERT INTO public.partner_transactions(
      tenant_id, partner_id, transaction_type, amount, description, month_year, created_by
    ) VALUES (
      p_tenant_id, v_line.partner_id, 'capital_adjustment',
      -v_line.amount,
      'عكس توزيع أرباح #' || substr(p_distribution_id::text,1,8) || ' — ' || COALESCE(p_reason,''),
      to_char(CURRENT_DATE,'YYYY-MM'), auth.uid()
    );
  END LOOP;

  -- Restore partner advances that were settled by this distribution
  FOR v_adv IN
    SELECT pap.advance_id AS advance_id, SUM(pap.amount) AS total
      FROM public.partner_advance_payments pap
     WHERE pap.reference_type = 'profit_distribution'
       AND pap.reference_id = p_distribution_id
     GROUP BY pap.advance_id
  LOOP
    UPDATE public.partner_advances pa
       SET remaining_amount = LEAST(pa.amount, COALESCE(pa.remaining_amount,0) + v_adv.total),
           status = CASE WHEN pa.status = 'cancelled' THEN pa.status ELSE 'active' END,
           updated_at = now()
     WHERE pa.id = v_adv.advance_id
       AND pa.tenant_id = p_tenant_id;

    -- reopen any installments settled by this distribution
    UPDATE public.partner_advance_installments pai
       SET status = 'pending'
     WHERE pai.advance_id = v_adv.advance_id
       AND pai.id IN (
         SELECT installment_id FROM public.partner_advance_payments
          WHERE reference_type = 'profit_distribution' AND reference_id = p_distribution_id
            AND installment_id IS NOT NULL
       );
  END LOOP;

  DELETE FROM public.partner_advance_payments
   WHERE reference_type = 'profit_distribution' AND reference_id = p_distribution_id;

  UPDATE public.profit_distributions
    SET status = 'reversed',
        notes = COALESCE(notes,'') || E'\n[REVERSED] ' || COALESCE(p_reason,'')
  WHERE id = p_distribution_id;
END $function$;

-- ============ 2) disburse_pending_advance: row lock + re-check ============
CREATE OR REPLACE FUNCTION public.disburse_pending_advance(p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_req record;
  v_balance numeric;
  v_advance_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  -- Concurrency lock first: prevents double disbursement
  SELECT * INTO v_req FROM public.advance_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الطلب غير موجود'; END IF;

  -- Re-check after acquiring the lock
  IF v_req.status::text <> 'approved_pending_funds' THEN
    RAISE EXCEPTION 'هذا الطلب ليس في انتظار توفر الرصيد';
  END IF;
  IF v_req.resulting_advance_id IS NOT NULL THEN
    RAISE EXCEPTION 'تم صرف هذه السلفة بالفعل';
  END IF;

  IF NOT (public.is_admin(v_user) OR (public.has_role(v_user,'branch_manager') AND public.user_in_branch(v_user, v_req.branch_id))) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
    INTO v_balance FROM public.treasury WHERE branch_id = v_req.branch_id;

  IF v_balance < v_req.amount THEN
    RAISE EXCEPTION 'رصيد الخزنة غير كافٍ — الرصيد الحالي: % جنيه', v_balance;
  END IF;

  INSERT INTO public.advances(employee_id, amount, monthly_deduct, remaining, reason, tenant_id)
  VALUES (v_req.employee_id, v_req.amount, v_req.monthly_deduct, v_req.amount, v_req.reason, v_req.tenant_id)
  RETURNING id INTO v_advance_id;

  INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id)
  VALUES (v_req.branch_id, 'expense', 'advance', v_req.amount,
          'صرف سلفة معتمدة', v_advance_id, v_user, v_req.tenant_id);

  UPDATE public.advance_requests
     SET status = 'approved'::advance_request_status,
         resulting_advance_id = v_advance_id,
         updated_at = now()
   WHERE id = p_request_id;

  RETURN v_advance_id;
END;
$function$;

-- ============ 3) pay_employee_salary: atomic salary payment ============
CREATE OR REPLACE FUNCTION public.pay_employee_salary(
  p_employee_id uuid,
  p_month text,
  p_bonuses numeric DEFAULT 0,
  p_deductions numeric DEFAULT 0,
  p_advance_deduct numeric DEFAULT 0,
  p_payment_method text DEFAULT 'cash',
  p_reference_number text DEFAULT NULL,
  p_transfer_to_account text DEFAULT NULL,
  p_transfer_from_account text DEFAULT NULL,
  p_fee_amount numeric DEFAULT 0,
  p_notes text DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_emp record;
  v_base numeric; v_net numeric;
  v_bonuses numeric := COALESCE(p_bonuses,0);
  v_ded numeric := COALESCE(p_deductions,0);
  v_advded numeric := COALESCE(p_advance_deduct,0);
  v_fee numeric := COALESCE(p_fee_amount,0);
  v_balance numeric;
  v_salary_id uuid;
  v_remaining numeric;
  v_take numeric;
  v_adv record;
  v_acc_salary uuid; v_acc_cash uuid; v_acc_fee uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;

  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الموظف غير موجود'; END IF;

  IF NOT (public.is_admin(v_user)
          OR (public.has_role(v_user,'branch_manager') AND public.user_in_branch(v_user, v_emp.branch_id))
          OR (public.has_role(v_user,'accountant') AND public.user_in_branch(v_user, v_emp.branch_id))) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  IF EXISTS (SELECT 1 FROM public.salaries WHERE employee_id = p_employee_id AND month = p_month) THEN
    RAISE EXCEPTION 'راتب هذا الشهر مدفوع بالفعل';
  END IF;

  v_base := COALESCE(v_emp.base_salary, 0);
  v_net  := v_base + v_bonuses - v_ded - v_advded;
  IF v_net <= 0 THEN RAISE EXCEPTION 'صافي الراتب يجب أن يكون موجباً'; END IF;

  -- Lock advances of this employee, validate deduction amount
  SELECT COALESCE(SUM(remaining),0) INTO v_remaining
    FROM public.advances WHERE employee_id = p_employee_id AND remaining > 0
    FOR UPDATE;
  IF v_advded > v_remaining THEN RAISE EXCEPTION 'خصم السلف أكبر من الرصيد المتبقي'; END IF;

  -- Treasury balance check
  SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END), 0)
    INTO v_balance FROM public.treasury WHERE branch_id = v_emp.branch_id;
  IF v_balance < (v_net + v_fee) THEN
    RAISE EXCEPTION 'رصيد الخزنة غير كافٍ — الرصيد الحالي: % جنيه', v_balance;
  END IF;

  INSERT INTO public.salaries(employee_id, month, base_salary, bonuses, deductions, advance_deduct, net_salary, paid_by, tenant_id)
  VALUES (p_employee_id, p_month, v_base, v_bonuses, v_ded, v_advded, v_net, v_user, v_emp.tenant_id)
  RETURNING id INTO v_salary_id;

  -- Apply advance deductions (oldest first)
  IF v_advded > 0 THEN
    v_take := v_advded;
    FOR v_adv IN
      SELECT id, remaining FROM public.advances
       WHERE employee_id = p_employee_id AND remaining > 0
       ORDER BY created_at ASC FOR UPDATE
    LOOP
      EXIT WHEN v_take <= 0;
      DECLARE v_amt numeric := LEAST(v_take, v_adv.remaining);
      BEGIN
        UPDATE public.advances SET remaining = remaining - v_amt WHERE id = v_adv.id;
        INSERT INTO public.advance_payments(advance_id, amount, month, tenant_id)
        VALUES (v_adv.id, v_amt, p_month, v_emp.tenant_id);
        v_take := v_take - v_amt;
      END;
    END LOOP;
  END IF;

  -- Treasury expense
  INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, tenant_id,
                              payment_method, reference_number, transfer_to_account, transfer_from_account)
  VALUES (v_emp.branch_id, 'expense', 'salary', v_net,
          'راتب ' || p_month || ' - ' || v_emp.name || COALESCE(' — ' || NULLIF(p_notes,''), ''),
          v_salary_id, v_user, v_emp.tenant_id,
          p_payment_method, p_reference_number, p_transfer_to_account, p_transfer_from_account);

  IF v_fee > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, created_by, tenant_id, is_fee, payment_method)
    VALUES (v_emp.branch_id, 'expense', 'transfer_fee', v_fee,
            'عمولة ' || p_payment_method || ' - راتب ' || v_emp.name, v_user, v_emp.tenant_id, true, p_payment_method);
  END IF;

  -- Journal: Dr Salaries Expense (5200) / Cr Cash (1100)
  IF v_emp.tenant_id IS NOT NULL THEN
    v_acc_salary := public.ensure_account(v_emp.tenant_id, '5200', 'Salaries Expense', 'expense'::account_type);
    v_acc_cash   := public.ensure_account(v_emp.tenant_id, '1100', 'Cash / Treasury', 'asset'::account_type);
    PERFORM public.post_journal_lines(
      v_emp.tenant_id, CURRENT_DATE,
      'راتب ' || p_month || ' - ' || v_emp.name,
      'salary', v_salary_id,
      jsonb_build_array(
        jsonb_build_object('account_id', v_acc_salary, 'debit', ROUND(v_net,2), 'credit', 0, 'description', 'مصروف رواتب'),
        jsonb_build_object('account_id', v_acc_cash,   'debit', 0, 'credit', ROUND(v_net,2), 'description', 'صرف من الخزنة')
      ), v_emp.branch_id);

    IF v_fee > 0 THEN
      v_acc_fee := public.ensure_account(v_emp.tenant_id, '5700', 'Bank & Transfer Fees', 'expense'::account_type);
      PERFORM public.post_journal_lines(
        v_emp.tenant_id, CURRENT_DATE,
        'عمولة تحويل راتب - ' || v_emp.name,
        'salary_fee', v_salary_id,
        jsonb_build_array(
          jsonb_build_object('account_id', v_acc_fee,  'debit', ROUND(v_fee,2), 'credit', 0, 'description', 'عمولة تحويل'),
          jsonb_build_object('account_id', v_acc_cash, 'debit', 0, 'credit', ROUND(v_fee,2), 'description', 'صرف من الخزنة')
        ), v_emp.branch_id);
    END IF;
  END IF;

  RETURN v_salary_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.pay_employee_salary(uuid, text, numeric, numeric, numeric, text, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_employee_salary(uuid, text, numeric, numeric, numeric, text, text, text, text, numeric, text) TO authenticated;