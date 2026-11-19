-- 0269 checks (rollback-only): payroll fixes, run on محمد ياسر (سكة) September 2026.
--  P2  only working days count (a Friday «إجازة» is not a paid day, a Friday «غياب» is not a deduction)
--  P2b a day-off worked and marked «يتحسب يوم شغل» is paid as one extra day at the daily rate
--  P3  the salary expense lands on the last day of its own month (30/9), the cash leaves on the pay day
--  P1  a salary with an advance installment can be cancelled, paid again, and cancelled again
--  P4  paying needs the «صرف المرتبات» switch
DO $t$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; OWNER uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  NOUR uuid := '598491e8-589f-4ad1-88a6-62d6e9114bde'; AB uuid := '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213';
  EMP uuid := '42f0b831-a5e0-4f56-a857-7b2a56fb871b'; EMP_NOUR uuid := 'b5dd1aa2-0371-4ddf-9d5f-64b4efc472ad';
  out text := ''; fails int := 0; ok boolean; err text; p jsonb; p2 jsonb; adv uuid; sal uuid; sal2 uuid;
  v_sep numeric; v_pay numeric; v_2300 numeric; rem numeric; gross numeric; net numeric; today date := public.cairo_today();
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', OWNER::text, true);

  -- P2: Sept has absences on Thu 10 (work), Fri 11 (day off), Sat 12 (work) and «إجازة» on Fri 4 (day off)
  p := public.employee_salary_preview(EMP, '2026-09');
  IF (p->'counts'->>'absent')::int = 2 AND (p->'counts'->>'leave')::int = 0 THEN
    out := out || E'\nPASS P2 Friday statuses ignored: absent 2, leave 0';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL P2 absent %s leave %s', p->'counts'->>'absent', p->'counts'->>'leave'); END IF;

  -- P2b: worked Friday 18/9 and the owner marks it a paid day
  BEGIN
    EXECUTE $q$INSERT INTO attendance(branch_id, tenant_id, employee_id, employee_name, date, status, paid_extra)
               VALUES ('1329f6cc-a4a5-418c-9e91-cccd651b3142', '5316fbfe-b862-4c91-b48b-1d81c8aa5a71',
                       '42f0b831-a5e0-4f56-a857-7b2a56fb871b', 'محمد ياسر', '2026-09-18', 'present', true)$q$;
    p2 := public.employee_salary_preview(EMP, '2026-09');
    ok := (p2->>'extra_days')::numeric = 1
          AND round((p2->>'attendance_amount')::numeric - (p->>'attendance_amount')::numeric, 2) = round((p->>'daily_rate')::numeric, 2);
  EXCEPTION WHEN others THEN ok := false; err := SQLERRM; END;
  IF ok THEN out := out || format(E'\nPASS P2b extra day paid %s', p2->>'daily_rate');
  ELSE fails := fails + 1; out := out || E'\nFAIL P2b extra day ' || coalesce(err, p2::text); err := NULL; END IF;

  -- P4: د/نور with «صرف المرتبات» closed in عبدالمنعم cannot pay
  INSERT INTO user_permissions(tenant_id, user_id, permission_key, allowed, branch_id) VALUES (T, NOUR, 'salaries.create', false, AB);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', NOUR, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', NOUR::text, true);
  BEGIN PERFORM public.pay_employee_salary(EMP_NOUR, '2026-09', 0, 0, 0, 'vodafone'); ok := false;
  EXCEPTION WHEN others THEN ok := SQLERRM LIKE '%صرف المرتبات%'; err := SQLERRM; END;
  IF ok THEN out := out || E'\nPASS P4 switch closed → refused';
  ELSE fails := fails + 1; out := out || E'\nFAIL P4 ' || coalesce(err, 'paid without the switch'); END IF;
  err := NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', OWNER::text, true);

  -- P3 + P1: an advance of 1,000 (500 / month), pay September today by Vodafone
  INSERT INTO advances(employee_id, amount, remaining, monthly_deduct, reason, tenant_id) VALUES (EMP, 1000, 1000, 500, 'تجربة', T) RETURNING id INTO adv;
  BEGIN
    sal := public.pay_employee_salary(EMP, '2026-09', 0, 0, 500, 'vodafone');
  EXCEPTION WHEN others THEN err := SQLERRM; END;
  IF sal IS NULL THEN fails := fails + 1; out := out || E'\nFAIL pay ' || err;
  ELSE
    SELECT net_salary, net_salary + advance_deduct INTO net, gross FROM salaries WHERE id = sal;
    SELECT coalesce(sum(l.debit - l.credit) FILTER (WHERE e.entry_date = '2026-09-30'), 0),
           coalesce(sum(l.debit - l.credit) FILTER (WHERE e.entry_date = today), 0)
      INTO v_sep, v_pay
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.tenant_id = T AND a.code = '5200' AND e.source_id IN (sal, (SELECT v.id FROM vouchers v JOIN treasury tr ON tr.id = v.treasury_id WHERE tr.reference_id = sal AND NOT tr.is_fee));
    IF round(v_sep, 2) = round(gross, 2) AND round(v_pay, 2) = 0 THEN
      out := out || format(E'\nPASS P3 expense %s on 30/9, 0 on pay day %s', v_sep, today);
    ELSE fails := fails + 1; out := out || format(E'\nFAIL P3 30/9=%s pay day=%s gross=%s', v_sep, v_pay, gross); END IF;
    SELECT voucher_date INTO STRICT p2 FROM (SELECT to_jsonb(v.voucher_date) voucher_date FROM vouchers v JOIN treasury tr ON tr.id = v.treasury_id WHERE tr.reference_id = sal AND NOT coalesce(tr.is_fee, false) LIMIT 1) z;
    IF (p2#>>'{}')::date = today THEN out := out || E'\nPASS P3b voucher + cash on the pay day';
    ELSE fails := fails + 1; out := out || E'\nFAIL P3b voucher dated ' || p2::text; END IF;

    -- P1: cancel → advance back to 1,000, Sept expense back to 0
    BEGIN PERFORM public.cancel_salary_payment(sal, 'تجربة'); ok := true; EXCEPTION WHEN others THEN ok := false; err := SQLERRM; END;
    SELECT remaining INTO rem FROM advances WHERE id = adv;
    SELECT coalesce(sum(l.debit - l.credit), 0) INTO v_sep
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.tenant_id = T AND a.code = '5200' AND e.entry_date = '2026-09-30' AND e.source_id = sal;
    IF ok AND rem = 1000 AND round(v_sep, 2) = 0 THEN out := out || E'\nPASS P1 cancel: advance back to 1000, Sept expense 0';
    ELSE fails := fails + 1; out := out || format(E'\nFAIL P1 cancel ok=%s rem=%s sep=%s %s', ok, rem, v_sep, coalesce(err, '')); END IF;
    err := NULL;

    -- P1b: pay again and cancel again
    BEGIN
      sal2 := public.pay_employee_salary(EMP, '2026-09', 0, 0, 500, 'vodafone');
      PERFORM public.cancel_salary_payment(sal2, 'تجربة 2'); ok := true;
    EXCEPTION WHEN others THEN ok := false; err := SQLERRM; END;
    SELECT remaining INTO rem FROM advances WHERE id = adv;
    SELECT coalesce(sum(l.debit - l.credit), 0) INTO v_2300
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
     WHERE e.tenant_id = T AND a.code IN ('2300', '5200') AND e.source_id IN (sal, sal2);
    IF ok AND rem = 1000 AND round(v_2300, 2) = 0 THEN out := out || E'\nPASS P1b pay again + cancel again; 2300 / 5200 back to 0';
    ELSE fails := fails + 1; out := out || format(E'\nFAIL P1b ok=%s rem=%s 2300+5200=%s %s', ok, rem, v_2300, coalesce(err, '')); END IF;
  END IF;

  RAISE EXCEPTION 'ROLLBACK — % failed%', fails, out;
END $t$;
