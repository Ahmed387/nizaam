-- 0270 checks (rollback-only): محمد ياسر (سكة) made a daily worker at 200 a day from 10/11/2026.
DO $t$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; OWNER uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  SK uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142'; EMP uuid := '42f0b831-a5e0-4f56-a857-7b2a56fb871b';
  out text := ''; fails int := 0; ok boolean; err text; w uuid; w2 uuid; v numeric; v2 numeric; n int; pend text;
  today date := public.cairo_today();
BEGIN
  UPDATE employees SET pay_type = 'daily', daily_wage = 200, daily_since = '2026-11-10' WHERE id = EMP;
  DELETE FROM attendance WHERE employee_id = EMP AND date >= '2026-11-10';
  INSERT INTO attendance(branch_id, tenant_id, employee_id, employee_name, date, status, paid_extra) VALUES
    (SK, T, EMP, 'محمد ياسر', '2026-11-13', 'present', true),    -- Friday off, worked, counted
    (SK, T, EMP, 'محمد ياسر', '2026-11-16', 'present', false),
    (SK, T, EMP, 'محمد ياسر', '2026-11-17', 'half_day', false),
    (SK, T, EMP, 'محمد ياسر', '2026-11-12', 'leave', false);     -- leave = no wage
  INSERT INTO employee_adjustments(tenant_id, branch_id, employee_id, month, entry_date, kind, amount, reason, status)
  VALUES (T, SK, EMP, '2026-11', '2026-11-16', 'penalty', 50, 'تأخير', 'active');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', OWNER::text, true);

  -- 1 pending list
  SELECT string_agg(to_char(day, 'DD') || ':' || state || ':' || amount, ' ' ORDER BY day) INTO pend FROM public.daily_wage_pending(NULL, EMP);
  IF pend LIKE '%13:payable:200%' AND pend LIKE '%14:no_attendance%' AND pend LIKE '%16:payable:200%' AND pend LIKE '%17:payable:100%'
     AND pend NOT LIKE '%12:%' THEN out := out || E'\nPASS 1 pending ' || pend;
  ELSE fails := fails + 1; out := out || E'\nFAIL 1 pending ' || coalesce(pend, '∅'); END IF;

  -- 2 a day with no attendance cannot be paid
  BEGIN PERFORM public.pay_daily_wage(EMP, '2026-11-14', 0, 0, 0, 'vodafone'); ok := false;
  EXCEPTION WHEN others THEN ok := SQLERRM LIKE '%مستني%'; err := SQLERRM; END;
  IF ok THEN out := out || E'\nPASS 2 no attendance → refused'; ELSE fails := fails + 1; out := out || E'\nFAIL 2 ' || coalesce(err, 'paid'); END IF;

  -- 3 pay 16/11 (200 − penalty 50 = 150): expense on 16/11, nothing on the pay day, voucher today
  w := public.pay_daily_wage(EMP, '2026-11-16', 0, 0, 0, 'vodafone');
  SELECT coalesce(sum(l.debit - l.credit) FILTER (WHERE e.entry_date = '2026-11-16'), 0),
         coalesce(sum(l.debit - l.credit) FILTER (WHERE e.entry_date = today), 0) INTO v, v2
    FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
   WHERE a.code = '5200' AND e.source_id IN (w, (SELECT vo.id FROM vouchers vo JOIN treasury tr ON tr.id = vo.treasury_id WHERE tr.reference_id = w AND NOT coalesce(tr.is_fee, false)));
  IF (SELECT net FROM daily_wages WHERE id = w) = 150 AND v = 150 AND v2 = 0 THEN out := out || E'\nPASS 3 paid 150 on 16/11';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 3 net %s 16/11 %s today %s', (SELECT net FROM daily_wages WHERE id = w), v, v2); END IF;

  -- 4 no monthly salary for a daily worker
  BEGIN PERFORM public.pay_employee_salary(EMP, '2026-11', 0, 0, 0, 'vodafone'); ok := false;
  EXCEPTION WHEN others THEN ok := SQLERRM LIKE '%يومي%'; err := SQLERRM; END;
  IF ok THEN out := out || E'\nPASS 4 monthly refused'; ELSE fails := fails + 1; out := out || E'\nFAIL 4 ' || coalesce(err, 'paid'); END IF;

  -- 5 cancel → expense 0, penalty free again; pay again
  PERFORM public.cancel_daily_wage(w, 'تجربة');
  SELECT coalesce(sum(l.debit - l.credit), 0) INTO v
    FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id JOIN chart_of_accounts a ON a.id = l.account_id
   WHERE a.code IN ('5200', '2300') AND e.source_id = w;
  w2 := public.pay_daily_wage(EMP, '2026-11-16', 0, 0, 0, 'vodafone');
  IF v = 0 AND (SELECT net FROM daily_wages WHERE id = w2) = 150 THEN out := out || E'\nPASS 5 cancel + pay again';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 5 after cancel %s', v); END IF;

  -- 6 the Friday he worked (marked) is paid 200
  w := public.pay_daily_wage(EMP, '2026-11-13', 0, 0, 0, 'vodafone');
  IF (SELECT net FROM daily_wages WHERE id = w) = 200 THEN out := out || E'\nPASS 6 day off worked paid 200';
  ELSE fails := fails + 1; out := out || E'\nFAIL 6'; END IF;

  -- 7 notifications for the last days with no attendance
  n := public.notify_daily_pending();
  IF n >= 1 AND public.notify_daily_pending() = 0 THEN out := out || format(E'\nPASS 7 %s notifications, not repeated', n);
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 7 n=%s', n); END IF;

  RAISE EXCEPTION 'ROLLBACK — % failed%', fails, out;
END $t$;
