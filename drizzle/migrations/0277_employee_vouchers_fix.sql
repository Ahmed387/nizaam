-- 0277 (owner answers 2026-11-19, «جرب واتأكد ونفذ»): «سهل» payment vouchers that were salaries / staff advances /
-- expenses but sat on a person's account. Each is cancelled ON ITS OWN DAY (cancel_voucher → reversal on the original
-- day) and recorded again the right way on the same day, same branch and vessel — so every till stays as it was:
--  * محمد قاسم العامل (new employee «محمد قاسم», شلبى): «سلفة / سلف / من المرتب / من الراتب» → employee advance
--    (advances + till row category 'advance' → voucher «سلف موظفين» 1450); no description / «خط رقم 1» → expense
--    voucher «رواتب موظفين» (5200); his two receipts (30/6 1,000, 31/7 1,100) → «رد سلف موظفين» (Cr 1450) paying his
--    oldest open advances (advance_payments). Open advances after = 2,750 + salaries 1,100 = his balance before 3,850.
--  * محمد طه المحاسب (employee «ا/محمد طه» already exists): the same rule from 2026-09-20 on (8 vouchers); 12012 / 12703
--    and everything before 20/9 stay as they are.
--  * PV-6702 (سكة, 50) → advance of the new employee «محمد احمد» (سكة); his other vouchers stay.
--  * PV-7056 / PV-7062 (أكل للعمال, on «التشطيبات») and PV-6305 (عمولة تحويل, on «يسري ابو صالح») → plain expense
--    vouchers in their own category, no account.
--  * 13843 / 13915 / 13928 / 14280 / 14285 stay on «معرض عبد المنعم الغربى (حساب خاص)»: only their category becomes
--    «مدفوعات لعملاء» (display — their books come from the account), logged in voucher_category_changes.
-- Runs in import mode (no Telegram messages, the old negative tills are not re-checked). Proof before the final save:
-- every vessel of the two branches unchanged, tills = books, the five accounts / advances / profit as above.

-- one-off copy of create_manual_voucher without the vessel-account check: the «سهل» vouchers carry the account text «سهل»
-- (vessel accounts were added after the import) and their copies must keep it, so per-account balances do not move.
CREATE OR REPLACE FUNCTION public._mig0277_voucher(p_branch uuid, p_type voucher_type, p_cat uuid, p_amount numeric, p_method text,
  p_ref text, p_to text, p_from text, p_desc text, p_day date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_t uuid; v_id uuid; v_tr uuid; v_num text; v_cat text; v_user text;
BEGIN
  SELECT tenant_id INTO v_t FROM branches WHERE id = p_branch;
  SELECT name INTO v_cat FROM voucher_categories WHERE id = p_cat AND tenant_id = v_t AND type = p_type;
  IF v_cat IS NULL THEN RAISE EXCEPTION 'category'; END IF;
  SELECT name INTO v_user FROM profiles WHERE id = auth.uid();
  v_num := next_voucher_number(v_t, p_type);
  PERFORM set_config('app.skip_treasury_voucher', '1', true);
  INSERT INTO treasury (tenant_id, branch_id, type, category, amount, description, payment_method, reference_number,
                        transfer_to_account, transfer_from_account, is_fee, created_by, transaction_date, created_at)
  VALUES (v_t, p_branch, CASE WHEN p_type = 'receipt' THEN 'income'::treasury_type ELSE 'expense'::treasury_type END, v_cat, p_amount, p_desc,
          p_method, p_ref, p_to, p_from, false, auth.uid(), p_day, (p_day + time '12:00') AT TIME ZONE 'Africa/Cairo') RETURNING id INTO v_tr;
  INSERT INTO vouchers (tenant_id, branch_id, voucher_number, type, source, treasury_id, category_id, amount, payment_method, fee_amount,
                        reference_number, transferred_to, transferred_from, description, voucher_date, created_by, created_by_name)
  VALUES (v_t, p_branch, v_num, p_type, 'manual', v_tr, p_cat, p_amount, p_method, 0, p_ref, p_to, p_from, p_desc, p_day, auth.uid(), v_user)
  RETURNING id INTO v_id;
  PERFORM set_config('app.skip_treasury_voucher', '0', true);
  RETURN v_id;
END $f$;
REVOKE ALL ON FUNCTION public._mig0277_voucher(uuid, voucher_type, uuid, numeric, text, text, text, text, text, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._mig0277(p_dry boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; OWNER uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  SH uuid := 'f2b47364-4837-4e1b-84b0-e39f78940d59'; SK uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142';
  C_QASEM uuid := 'e963d55e-b9e1-4f5e-84e5-cc8c27d6fa79'; C_TAHA uuid := 'b54e9b4c-311b-4617-a037-291ea55488ed';
  C_AHMED uuid := 'a1e7481d-5dab-466f-97f1-d548fec7d837'; C_ABDEL uuid := '24ff305a-d2f1-43ed-aea5-198dc61e32a8';
  E_TAHA uuid := '3bef69d0-67b8-4713-864e-8548098538f9';
  CAT_SALARY uuid := '8091125c-3631-4b96-b005-6cc644e73b6e'; CAT_CUSTPAY uuid := '94ae3d05-f743-4076-9e4a-37d7548f02d4';
  e_qasem uuid; e_ahmed uuid; cat_rep uuid; v record; a record; v_emp uuid; v_name text; v_adv uuid; v_left numeric; v_take numeric;
  seq jsonb; w0 jsonb; w1 jsonb; bal0 jsonb; bal1 jsonb; np0 numeric; np1 numeric; out text := ''; fails int := 0; gl jsonb;
  v_desc text; v_at timestamptz; n int := 0;
BEGIN
  SELECT jsonb_object_agg(sequencename, last_value) INTO seq FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
  PERFORM set_config('app.sahl_import', '1', true);
  SET CONSTRAINTS ALL IMMEDIATE;
  IF EXISTS (SELECT 1 FROM employees WHERE tenant_id = T AND name IN ('محمد قاسم', 'محمد احمد')) THEN RAISE EXCEPTION '0277 ran already'; END IF;

  SELECT jsonb_object_agg(b, w) INTO w0 FROM (SELECT b, to_jsonb(x) w FROM unnest(ARRAY[SH, SK]) b, LATERAL public.get_branch_wallet_balances(b) x) q;
  SELECT jsonb_object_agg(c, jsonb_build_object('c', s.cb, 's', s.sb)) INTO bal0 FROM unnest(ARRAY[C_QASEM, C_TAHA, C_AHMED, C_ABDEL,
      '84c38ae5-a31a-44b0-94dc-9185b924a04c'::uuid, (SELECT party_id FROM vouchers WHERE voucher_number = 'PV-7056' AND tenant_id = T)]) c,
    LATERAL (SELECT sum(customer_balance) cb, sum(supplier_balance) sb FROM public.contact_side_balances(ARRAY[c], NULL)) s;
  np0 := (public.profit_statement_core(T, '2026-01-01', public.cairo_today(), NULL)->'total'->>'net_profit')::numeric;

  INSERT INTO employees (tenant_id, branch_id, name, job_title, base_salary, hire_date, has_system_access)
  VALUES (T, SH, 'محمد قاسم', 'عامل', 0, '2026-01-01', false) RETURNING id INTO e_qasem;
  INSERT INTO employees (tenant_id, branch_id, name, job_title, base_salary, hire_date, has_system_access)
  VALUES (T, SK, 'محمد احمد', 'عامل', 0, '2026-01-01', false) RETURNING id INTO e_ahmed;
  INSERT INTO voucher_categories (tenant_id, name, type, gl_account_code, is_deductible_from_profit, is_added_to_profit, system_key)
  VALUES (T, 'رد سلف موظفين', 'receipt', '1450', false, false, 'advance_repayment') RETURNING id INTO cat_rep;

  FOR v IN
    SELECT vo.*, x.act, x.who FROM vouchers vo JOIN (VALUES
      ('PV-3975','advance','q'),('RV-3972','repay','q'),('PV-4786','advance','q'),('PV-5062','advance','q'),('RV-4438','repay','q'),
      ('PV-6046','advance','q'),('PV-6163','advance','q'),('PV-6223','advance','q'),('PV-6352','advance','q'),('PV-6679','advance','q'),
      ('PV-6765','salary','q'),('PV-6875','salary','q'),('PV-7100','advance','q'),('PV-7269','advance','q'),('PV-7355','salary','q'),
      ('PV-6313','advance','t'),('PV-6375','advance','t'),('PV-6862','salary','t'),('PV-6947','salary','t'),('PV-7115','salary','t'),
      ('PV-7366','salary','t'),('PV-7404','advance','t'),('PV-7428','advance','t'),
      ('PV-6702','advance','a'),
      ('PV-7056','expense','-'),('PV-7062','expense','-'),('PV-6305','expense','-')) x(num, act, who) ON x.num = vo.voucher_number
    WHERE vo.tenant_id = T ORDER BY vo.voucher_date, vo.voucher_number
  LOOP
    IF v.status <> 'active' THEN RAISE EXCEPTION '% is not active', v.voucher_number; END IF;
    IF v.act <> 'expense' AND v.party_id IS DISTINCT FROM (CASE v.who WHEN 'q' THEN C_QASEM WHEN 't' THEN C_TAHA ELSE C_AHMED END) THEN
      RAISE EXCEPTION '% is not on the expected account', v.voucher_number;
    END IF;
    v_emp := CASE v.who WHEN 'q' THEN e_qasem WHEN 't' THEN E_TAHA WHEN 'a' THEN e_ahmed END;
    SELECT name INTO v_name FROM employees WHERE id = v_emp;
    v_desc := coalesce(nullif(v.description, ''), v.voucher_number);
    v_at := (v.voucher_date + time '12:00') AT TIME ZONE 'Africa/Cairo';
    PERFORM public.cancel_voucher(v.id, 'اتصحح (0277): ' || CASE v.act WHEN 'advance' THEN 'سلفة للموظف ' || v_name WHEN 'repay' THEN 'رد سلفة من ' || v_name
                                   WHEN 'salary' THEN 'مرتب ' || v_name ELSE 'مصروف من غير حساب' END);
    IF v.act = 'advance' THEN
      INSERT INTO advances (employee_id, amount, remaining, monthly_deduct, reason, tenant_id, created_at)
      VALUES (v_emp, v.amount, v.amount, v.amount, v_desc, T, v_at) RETURNING id INTO v_adv;
      INSERT INTO treasury (tenant_id, branch_id, type, category, amount, description, reference_id, created_by, payment_method,
                            reference_number, transfer_to_account, transfer_from_account, transaction_date, created_at)
      VALUES (T, v.branch_id, 'expense', 'advance', v.amount, 'سلفة - ' || v_name || ' — ' || v_desc, v_adv, OWNER, v.payment_method,
              v.reference_number, v.transferred_to, v.transferred_from, v.voucher_date, v_at);
    ELSIF v.act = 'repay' THEN
      PERFORM public._mig0277_voucher(v.branch_id, 'receipt', cat_rep, v.amount, v.payment_method, v.reference_number, v.transferred_to,
                v.transferred_from, 'رد سلفة — ' || v_name || ' — ' || v_desc, v.voucher_date);
      v_left := v.amount;
      FOR a IN SELECT * FROM advances WHERE employee_id = v_emp AND status = 'active' AND remaining > 0
                 AND (created_at AT TIME ZONE 'Africa/Cairo')::date <= v.voucher_date ORDER BY created_at LOOP
        EXIT WHEN v_left <= 0;
        v_take := least(v_left, a.remaining);
        INSERT INTO advance_payments (advance_id, amount, month, paid_at, tenant_id) VALUES (a.id, v_take, to_char(v.voucher_date, 'YYYY-MM'), v_at, T);
        UPDATE advances SET remaining = remaining - v_take WHERE id = a.id;
        v_left := v_left - v_take;
      END LOOP;
      IF v_left > 0.005 THEN RAISE EXCEPTION '% repays more than his open advances (% left)', v.voucher_number, v_left; END IF;
    ELSE
      PERFORM public._mig0277_voucher(v.branch_id, 'payment', CASE WHEN v.act = 'salary' THEN CAT_SALARY ELSE v.category_id END, v.amount,
                v.payment_method, v.reference_number, v.transferred_to, v.transferred_from,
                CASE WHEN v.act = 'salary' THEN 'مرتب ' || v_name || ' — ' ELSE '' END || v_desc, v.voucher_date);
    END IF;
    n := n + 1;
  END LOOP;
  IF n <> 27 THEN RAISE EXCEPTION 'expected 27 vouchers, found %', n; END IF;

  -- the five «عبدالمنعم» vouchers: category only
  INSERT INTO voucher_category_changes (tenant_id, voucher_id, old_category_id, new_category_id, old_account, new_account, amount, reason, created_by)
  SELECT T, vo.id, vo.category_id, CAT_CUSTPAY, coalesce(vc.gl_account_code, '5500'), '1200', vo.amount, 'تفضل على حساب عبدالمنعم (0277) — مش مصروف', OWNER
    FROM vouchers vo JOIN voucher_categories vc ON vc.id = vo.category_id
   WHERE vo.tenant_id = T AND vo.voucher_number IN ('PV-5909','PV-6036','PV-6063','PV-6800','PV-6805') AND vo.party_id = C_ABDEL AND vo.status = 'active';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 5 THEN RAISE EXCEPTION 'expected 5 عبدالمنعم vouchers, found %', n; END IF;
  UPDATE vouchers SET category_id = CAT_CUSTPAY WHERE tenant_id = T AND voucher_number IN ('PV-5909','PV-6036','PV-6063','PV-6800','PV-6805');

  -- the ledger guard runs once per account per transaction: reset it before each account
  PERFORM set_config('ledger.done', '', true), public.ledger_sync_safe(c, NULL, '0277')
     FROM unnest(ARRAY[C_QASEM, C_TAHA, C_AHMED, C_ABDEL, '84c38ae5-a31a-44b0-94dc-9185b924a04c'::uuid,
                       (SELECT party_id FROM vouchers WHERE voucher_number = 'PV-7056' AND tenant_id = T)]) c;

  -- ── proof ──
  SELECT jsonb_object_agg(b, w) INTO w1 FROM (SELECT b, to_jsonb(x) w FROM unnest(ARRAY[SH, SK]) b, LATERAL public.get_branch_wallet_balances(b) x) q;
  SELECT jsonb_object_agg(c, jsonb_build_object('c', s.cb, 's', s.sb)) INTO bal1 FROM unnest(ARRAY[C_QASEM, C_TAHA, C_AHMED, C_ABDEL,
      '84c38ae5-a31a-44b0-94dc-9185b924a04c'::uuid, (SELECT party_id FROM vouchers WHERE voucher_number = 'PV-7056' AND tenant_id = T)]) c,
    LATERAL (SELECT sum(customer_balance) cb, sum(supplier_balance) sb FROM public.contact_side_balances(ARRAY[c], NULL)) s;
  np1 := (public.profit_statement_core(T, '2026-01-01', public.cairo_today(), NULL)->'total'->>'net_profit')::numeric;
  gl := public.ledger_gl_reconciliation();

  IF w0 = w1 THEN out := out || E'\nPASS الخزن (كل وعاء في شلبى وسكة) زي ما هي'; ELSE fails := fails + 1; out := out || format(E'\nFAIL wallets %s → %s', w0, w1); END IF;
  IF (bal1->C_QASEM::text->>'c')::numeric = 0 AND (bal1->C_TAHA::text->>'c')::numeric = (bal0->C_TAHA::text->>'c')::numeric - 2850
     AND (bal1->C_AHMED::text->>'c')::numeric = (bal0->C_AHMED::text->>'c')::numeric - 50
     AND bal1->C_ABDEL::text = bal0->C_ABDEL::text
  THEN out := out || format(E'\nPASS الحسابات: محمد قاسم %s→0، محمد طه %s→%s، محمد احمد %s→%s، عبدالمنعم زي ما هو',
         bal0->C_QASEM::text->>'c', bal0->C_TAHA::text->>'c', bal1->C_TAHA::text->>'c', bal0->C_AHMED::text->>'c', bal1->C_AHMED::text->>'c');
  ELSE fails := fails + 1; out := out || format(E'\nFAIL balances %s → %s', bal0, bal1); END IF;
  IF (SELECT sum(remaining) FROM advances WHERE employee_id = e_qasem) = 2750 AND (SELECT sum(remaining) FROM advances WHERE employee_id = E_TAHA) = 800
     AND (SELECT sum(remaining) FROM advances WHERE employee_id = e_ahmed) = 50
  THEN out := out || E'\nPASS السلف المفتوحة: محمد قاسم 2,750 / محمد طه 800 / محمد احمد 50';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL advances q=%s t=%s a=%s', (SELECT sum(remaining) FROM advances WHERE employee_id = e_qasem),
         (SELECT sum(remaining) FROM advances WHERE employee_id = E_TAHA), (SELECT sum(remaining) FROM advances WHERE employee_id = e_ahmed)); END IF;
  IF round(np0 - np1, 2) = 3430 THEN out := out || format(E'\nPASS صافي الربح %s → %s (−3,430 = مرتبات 3,150 + أكل 200 + عمولة 80)', np0, np1);
  ELSE fails := fails + 1; out := out || format(E'\nFAIL profit %s → %s', np0, np1); END IF;
  IF (SELECT bool_and(abs(coalesce((b->>'difference')::numeric, 0)) < 0.01 AND abs(coalesce((b->>'accounts_difference')::numeric, 0)) < 0.01)
        FROM jsonb_array_elements(gl->'branches') b)
  THEN out := out || E'\nPASS كل خزنة = الدفاتر، والحسابات = الدفاتر';
  ELSE fails := fails + 1; out := out || E'\nFAIL gl ' || left((gl->'branches')::text, 600); END IF;
  IF (SELECT coalesce(sum(l.debit - l.credit), 0) FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.tenant_id = T AND e.status = 'posted') = 0
  THEN out := out || E'\nPASS ميزان المراجعة متزن'; ELSE fails := fails + 1; out := out || E'\nFAIL trial balance'; END IF;
  IF (SELECT count(*) FROM vouchers vo JOIN treasury tr ON tr.id = vo.treasury_id JOIN advances ad ON ad.id = tr.reference_id
       WHERE tr.category = 'advance' AND vo.status = 'active' AND vo.voucher_date = (ad.created_at AT TIME ZONE 'Africa/Cairo')::date
         AND vo.category_id = (SELECT id FROM voucher_categories WHERE tenant_id = T AND system_key = 'advance' AND type = 'payment')) = 15
  THEN out := out || E'\nPASS 15 سند «سلف موظفين» كل واحد في يومه'; ELSE fails := fails + 1; out := out || E'\nFAIL advance vouchers ' ||
    (SELECT json_agg(json_build_object('n', vo.voucher_number, 'd', vo.voucher_date, 'c', vo.category_id))::text FROM vouchers vo JOIN treasury tr ON tr.id = vo.treasury_id WHERE tr.category = 'advance'); END IF;
  IF NOT EXISTS (SELECT 1 FROM tg_doc_queue WHERE created_at > now() - interval '1 minute') THEN out := out || E'\nPASS مفيش رسايل تليجرام';
  ELSE fails := fails + 1; out := out || E'\nFAIL telegram queued'; END IF;

  out := format('0277 fails=%s%s', fails, out);
  IF p_dry OR fails > 0 THEN
    PERFORM setval('public.' || k, (seq->>k)::bigint, true) FROM jsonb_object_keys(seq) k;
    RAISE EXCEPTION '%', out;
  END IF;
  RETURN out;
END $f$;

REVOKE ALL ON FUNCTION public._mig0277(boolean) FROM PUBLIC, anon, authenticated;
-- dry-run 2026-11-19: SELECT public._mig0277(true) → fails=0 (tills, accounts, advances 2,750 / 800 / 50, net profit −3,430, tills = books,
-- trial balance, 15 advance vouchers on their day, no Telegram). Real run:
SELECT public._mig0277(false);
DROP FUNCTION public._mig0277(boolean);
DROP FUNCTION public._mig0277_voucher(uuid, voucher_type, uuid, numeric, text, text, text, text, text, date);
