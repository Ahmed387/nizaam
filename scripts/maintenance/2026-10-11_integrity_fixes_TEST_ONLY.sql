-- =============================================================================================
-- Nizam ERP — Step 9 data corrections (TEST database uzqiwxxmzjdgkfbskmzg). Owner request 2026-10-11:
-- fix the 4 integrity errors and the till ↔ books differences of سكة تلة (43,500) and عبدالمنعم (−7,481.78).
-- Nothing is deleted. Each fix restores what the money really did; an audit_log row is written for each.
--
--  1) Payment edits IN03539 / IN03547 / IN04275 (T1 errors RV-0227, RV-0234, RV-2270):
--     an older version of edit_invoice_payment overwrote the ORIGINAL till row with the new amount and
--     wrote the reversal of the old amount, but never wrote the "new amount" row. Till = new − old (wrong).
--     → the original till row goes back to the original amount (= its receipt voucher), and the missing
--       «payment_edit_new» row is added on the edit date. Till = old − old + new = the payment. ✔
--  2) Cash payments of IN03200 (400) and IN03814 (1,880) have no till row at all (the books have them).
--     → the missing «sales» till rows are added on the invoice date.
--  3) IN04081 / IN04082 (سكة تلة): the «تصحيح قيد عكسي» vouchers PV-2669 / PV-2670 correctly cancel phantom
--     cash in the till, but their journal took 45,800 out of cash a second time and booked it as an expense.
--     → those two journal entries are reversed on their own date (2026-08-01).
--  4) IN03887 (D1): header subtotal 92,160.84 vs its lines 92,158.84 → subtotal set to the lines. Total,
--     discount, payments and journal are unchanged (total 90,499.50 was already right).
-- =============================================================================================
CREATE OR REPLACE FUNCTION pg_temp.nizam_step9_fix(p_dry_run boolean) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
  v_owner uuid := (SELECT user_id FROM user_roles WHERE role = 'owner' AND tenant_id = v_t LIMIT 1);
  r record; v_new uuid; v_lines jsonb; v_out jsonb := '[]'::jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  -- 1) payment edits
  FOR r IN
    SELECT * FROM (VALUES
      ('IN03539', '38d22b26-65be-4910-8b31-57c69bcc793a'::uuid, 2150.00, 4300.00, '2026-10-03'::date, '2026-10-03 18:05:10+00'::timestamptz),
      ('IN03547', '95ade1d3-7283-4806-a9f7-185f20baa084'::uuid, 3051.78, 3051.00, '2026-10-03'::date, '2026-10-03 17:59:25+00'::timestamptz),
      ('IN04275', 'c47d5608-4f10-4afe-9aa9-27ba19ba1c8c'::uuid, 2300.00, 6900.00, '2026-09-29'::date, '2026-09-29 17:46:20+00'::timestamptz)
    ) x(inv, till_id, old_amt, new_amt, edit_day, edit_at)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM treasury WHERE id = r.till_id AND amount = r.new_amt) THEN
      RAISE EXCEPTION '% : original till row is not in the expected state', r.inv;
    END IF;
    IF EXISTS (SELECT 1 FROM treasury t JOIN invoices i ON i.id = t.reference_id
                WHERE i.invoice_number = r.inv AND t.category = 'payment_edit_new') THEN
      RAISE EXCEPTION '% : already has a payment_edit_new row', r.inv;
    END IF;
    UPDATE treasury SET amount = r.old_amt WHERE id = r.till_id;
    INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, reference_id,
                         created_by, created_at, transaction_date, tenant_id)
    SELECT t.branch_id, 'income', 'payment_edit_new', r.new_amt,
           'تصحيح دفعة على فاتورة ' || r.inv || ' — القيمة الجديدة (استكمال تعديل قديم)',
           t.payment_method, t.reference_id, v_owner, r.edit_at, r.edit_day, t.tenant_id
      FROM treasury t WHERE t.id = r.till_id;
    INSERT INTO audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
    SELECT v_owner, 'Claude (تصحيح بيانات)', t.branch_id, 'data_fix', 'treasury', r.till_id::text,
           jsonb_build_object('invoice', r.inv, 'original_row_back_to', r.old_amt, 'added_new_amount_row', r.new_amt,
                              'why', 'تعديل دفعة قديم كتب على السطر الأصلي ومسجلش سطر القيمة الجديدة'), v_t
      FROM treasury t WHERE t.id = r.till_id;
    v_out := v_out || jsonb_build_object('fix', 'payment_edit', 'invoice', r.inv);
  END LOOP;

  -- 2) cash payments without a till row
  FOR r IN
    SELECT i.id inv_id, i.invoice_number inv, i.branch_id, p.amount, p.payment_method, p.created_at,
           (i.invoice_date AT TIME ZONE 'Africa/Cairo')::date d
      FROM invoices i JOIN invoice_payments p ON p.invoice_id = i.id
     WHERE i.invoice_number IN ('IN03200', 'IN03814') AND p.voided_at IS NULL AND p.payment_method = 'cash'
  LOOP
    IF EXISTS (SELECT 1 FROM treasury WHERE reference_id = r.inv_id) THEN
      RAISE EXCEPTION '% : already has a till row', r.inv;
    END IF;
    INSERT INTO treasury(branch_id, type, category, amount, description, payment_method, reference_id,
                         created_by, created_at, transaction_date, tenant_id)
    VALUES (r.branch_id, 'income', 'sales', r.amount, 'فاتورة ' || r.inv, 'cash', r.inv_id,
            v_owner, r.created_at, r.d, v_t);
    INSERT INTO audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
    VALUES (v_owner, 'Claude (تصحيح بيانات)', r.branch_id, 'data_fix', 'invoice', r.inv_id::text,
            jsonb_build_object('invoice', r.inv, 'added_till_row', r.amount, 'why', 'دفعة كاش متسجلة على الفاتورة وفي القيود ومش في الخزنة'), v_t);
    v_out := v_out || jsonb_build_object('fix', 'missing_till_row', 'invoice', r.inv, 'amount', r.amount);
  END LOOP;

  -- 3) phantom-cash correction vouchers that took cash out of the books twice
  FOR r IN
    SELECT e.* FROM journal_entries e
     WHERE e.entry_number IN ('JE-202608-0495', 'JE-202608-0496') AND e.status = 'posted' AND e.reversed_by IS NULL
  LOOP
    SELECT jsonb_agg(jsonb_build_object('account_code', a.code, 'debit', l.credit, 'credit', l.debit,
                                        'description', 'عكس: كاش وهمي اتشال من القيود مرتين — ' || coalesce(l.description, '')))
      INTO v_lines
      FROM journal_entry_lines l JOIN chart_of_accounts a ON a.id = l.account_id WHERE l.entry_id = r.id;
    v_new := public.post_journal(v_t, r.entry_date,
               'عكس ' || r.entry_number || ' — سند تصحيح كاش وهمي (الخزنة كانت مظبوطة، القيد خصم الكاش مرتين)',
               'voucher_reversal', r.source_id, v_lines);
    UPDATE journal_entries SET branch_id = r.branch_id WHERE id = v_new;
    UPDATE journal_entries SET reversed_by = v_new WHERE id = r.id;
    INSERT INTO audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
    VALUES (v_owner, 'Claude (تصحيح بيانات)', r.branch_id, 'data_fix', 'journal_entry', r.id::text,
            jsonb_build_object('reversed', r.entry_number, 'by', v_new), v_t);
    v_out := v_out || jsonb_build_object('fix', 'journal_reversed', 'entry', r.entry_number);
  END LOOP;

  -- 4) invoice header subtotal = its lines
  UPDATE invoices i SET subtotal = x.s
    FROM (SELECT invoice_id, sum(total) s FROM invoice_items GROUP BY 1) x
   WHERE i.invoice_number = 'IN03887' AND x.invoice_id = i.id AND i.subtotal <> x.s
     AND round(x.s - i.discount_amount + i.vat_amount, 2) = i.total;
  IF FOUND THEN
    INSERT INTO audit_log(user_id, user_name, branch_id, action, entity, entity_id, details, tenant_id)
    SELECT v_owner, 'Claude (تصحيح بيانات)', branch_id, 'data_fix', 'invoice', id::text,
           jsonb_build_object('invoice', 'IN03887', 'subtotal_from', 92160.84, 'subtotal_to', subtotal, 'total_unchanged', total), v_t
      FROM invoices WHERE invoice_number = 'IN03887';
    v_out := v_out || jsonb_build_object('fix', 'subtotal', 'invoice', 'IN03887');
  END IF;

  v_out := jsonb_build_object('fixes', v_out,
    'audit', (SELECT jsonb_object_agg(check_code, n) FROM (SELECT check_code, count(*) n FROM system_integrity_audit(v_t)
                                                            WHERE severity = 'error' OR check_code LIKE 'T3%' GROUP BY 1) z),
    'gl', (SELECT jsonb_build_object('branches', g->'branches', 'customer_advances', g->'customer_advances')
             FROM ledger_gl_reconciliation(v_t) g));
  IF p_dry_run THEN RAISE EXCEPTION 'DRY-RUN %', v_out; END IF;
  RETURN v_out;
END $f$;
-- SELECT pg_temp.nizam_step9_fix(true);   -- dry run (rolls back, prints the result)
SELECT pg_temp.nizam_step9_fix(false);
