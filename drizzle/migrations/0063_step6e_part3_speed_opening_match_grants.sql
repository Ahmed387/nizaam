-- Step 6E (0058) part 3: ledger sync speed, opening balances match (preview by default), grants.
DO $idx$ BEGIN
  IF to_regclass('public.ledger_gl_links') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS ledger_gl_links_ref_idx ON public.ledger_gl_links (ref_id, ref_type) WHERE status = 'posted';
  END IF;
END $idx$;

DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ledger_allocate(uuid,uuid,text,uuid)'::regprocedure);
  IF position('_la_debt_ord' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
$a$  TRUNCATE _la_debt, _la_cred, _la_want;$a$,
$b$  TRUNCATE _la_debt, _la_cred, _la_want;
  IF to_regclass('pg_temp._la_debt_key') IS NULL THEN
    CREATE INDEX _la_debt_key ON _la_debt (debt_type, debt_id);
    CREATE INDEX _la_debt_ord ON _la_debt (first_flag, dd, ts, debt_id);
    CREATE INDEX _la_cred_key ON _la_cred (movement_id);
    CREATE INDEX _la_want_key ON _la_want (movement_id, debt_type, debt_id);
  END IF;$b$);
  v_new := replace(v_new,
$a$  CREATE TEMP TABLE IF NOT EXISTS _la_frozen (id uuid) ON COMMIT DROP;$a$,
$b$  ANALYZE _la_debt;
  ANALYZE _la_cred;
  CREATE TEMP TABLE IF NOT EXISTS _la_frozen (id uuid) ON COMMIT DROP;$b$);
  IF v_new = v_def OR position('_la_debt_ord' IN v_new) = 0 OR position('ANALYZE _la_cred' IN v_new) = 0 THEN
    RAISE EXCEPTION 'Step 6E: ledger_allocate patch did not apply';
  END IF;
  EXECUTE v_new;
END
$patch$;

CREATE INDEX IF NOT EXISTS journal_entries_number_seq_idx
  ON public.journal_entries (tenant_id, left(entry_number, 10), length(entry_number), entry_number);
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.post_journal(uuid,date,text,text,uuid,jsonb)'::regprocedure);
  IF position('left(je.entry_number, 10)' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
$a$  SELECT COALESCE(MAX(CAST(SPLIT_PART(entry_number,'-',3) AS INTEGER)),0)+1 INTO v_seq
    FROM public.journal_entries
   WHERE tenant_id = p_tenant_id
     AND entry_number LIKE 'JE-'||to_char(p_entry_date,'YYYYMM')||'-%';$a$,
$b$  SELECT COALESCE((SELECT CAST(SPLIT_PART(je.entry_number,'-',3) AS INTEGER)
                      FROM public.journal_entries je
                     WHERE je.tenant_id = p_tenant_id
                       AND left(je.entry_number, 10) = 'JE-'||to_char(p_entry_date,'YYYYMM')||'-'
                     ORDER BY length(je.entry_number) DESC, je.entry_number DESC
                     LIMIT 1), 0) + 1 INTO v_seq;$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'Step 6E: post_journal numbering patch did not apply'; END IF;
  EXECUTE v_new;
END
$patch$;

CREATE OR REPLACE FUNCTION public.ledger_opening_books(p_tenant uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'books_2025', jsonb_build_object(
        '1200', round(COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.code = '1200' AND NOT x.op), 0), 2),
        '2150', round(COALESCE(sum(l.credit - l.debit) FILTER (WHERE a.code = '2150' AND NOT x.op), 0), 2),
        '2100', round(COALESCE(sum(l.credit - l.debit) FILTER (WHERE a.code = '2100' AND NOT x.op), 0), 2),
        '1460', round(COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.code = '1460' AND NOT x.op), 0), 2)),
    'opening_entries', jsonb_build_object(
        '1200', round(COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.code = '1200' AND x.op), 0), 2),
        '2150', round(COALESCE(sum(l.credit - l.debit) FILTER (WHERE a.code = '2150' AND x.op), 0), 2),
        '2100', round(COALESCE(sum(l.credit - l.debit) FILTER (WHERE a.code = '2100' AND x.op), 0), 2),
        '1460', round(COALESCE(sum(l.debit - l.credit) FILTER (WHERE a.code = '1460' AND x.op), 0), 2)))
    FROM journal_entries e
    JOIN journal_entry_lines l ON l.entry_id = e.id
    JOIN chart_of_accounts a ON a.id = l.account_id
    CROSS JOIN LATERAL (SELECT (e.source_type IN ('opening_balance', 'opening_balance_reversal')
                               OR (e.source_type = 'ledger_gl_reversal' AND EXISTS (
                                     SELECT 1 FROM journal_entries o WHERE o.id = e.source_id AND o.source_type = 'opening_balance'))) AS op) x
   WHERE e.tenant_id = p_tenant AND e.status = 'posted' AND a.code IN ('1200', '2150', '2100', '1460')
     AND (x.op OR e.entry_date < public.ledger_cutoff())
$$;

DO $patch$
DECLARE v_def text; v_new text; a int; b int;
BEGIN
  v_def := pg_get_functiondef('public.ledger_gl_reconciliation(uuid)'::regprocedure);
  a := position($q$        'journal', (SELECT jsonb_build_object($q$ IN v_def);
  b := position($q$o.source_type = 'opening_balance'))))$q$ IN v_def);
  IF a = 0 OR b = 0 OR b < a THEN RAISE EXCEPTION 'Step 6E: opening block of ledger_gl_reconciliation not found'; END IF;
  b := b + length($q$o.source_type = 'opening_balance'))))$q$);
  v_new := substr(v_def, 1, a - 1)
        || $r$        'journal', (SELECT jsonb_build_object(
            '1200', (ob->'books_2025'->>'1200')::numeric + (ob->'opening_entries'->>'1200')::numeric,
            '2150', (ob->'books_2025'->>'2150')::numeric + (ob->'opening_entries'->>'2150')::numeric,
            '2100', (ob->'books_2025'->>'2100')::numeric + (ob->'opening_entries'->>'2100')::numeric,
            '1460', (ob->'books_2025'->>'1460')::numeric + (ob->'opening_entries'->>'1460')::numeric)
          FROM (SELECT public.ledger_opening_books(v_t) AS ob) z),
        'books_2025', public.ledger_opening_books(v_t)->'books_2025',
        'opening_entries', public.ledger_opening_books(v_t)->'opening_entries')$r$
        || substr(v_def, b);
  EXECUTE v_new;
END
$patch$;

CREATE OR REPLACE FUNCTION public.match_opening_books(p_apply boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_t uuid; v_uid uuid := auth.uid(); v_cut date := public.ledger_cutoff(); v_main uuid;
        r jsonb; led jsonb; bk jsonb; v_lines jsonb := '[]'::jsonb; v_rev int := 0; v_entry uuid;
        d1200 numeric; d2150 numeric; d2100 numeric; d1460 numeric; v_bal numeric; e record;
BEGIN
  v_t := public.assert_company_access(NULL);
  IF NOT (public.is_admin(v_uid) OR public.is_super_admin(v_uid)) THEN RAISE EXCEPTION 'للإدارة فقط' USING ERRCODE = '42501'; END IF;
  IF public.ledger_period_closed(v_t, v_cut) THEN
    RAISE EXCEPTION 'الفترة المحاسبية اللي فيها % مقفولة — افتحها الأول عشان قيد المطابقة', v_cut;
  END IF;
  IF p_apply THEN PERFORM pg_advisory_xact_lock(hashtextextended('opening_match:' || v_t::text, 0)); END IF;

  r := public.ledger_gl_reconciliation(v_t)->'opening';
  led := r->'ledger';
  bk := (SELECT jsonb_build_object(
            '1200', COALESCE(sum(CASE WHEN a.code = '1200' THEN l.debit - l.credit END), 0),
            '2150', COALESCE(sum(CASE WHEN a.code = '2150' THEN l.credit - l.debit END), 0),
            '2100', COALESCE(sum(CASE WHEN a.code = '2100' THEN l.credit - l.debit END), 0),
            '1460', COALESCE(sum(CASE WHEN a.code = '1460' THEN l.debit - l.credit END), 0))
           FROM journal_entries m JOIN journal_entry_lines l ON l.entry_id = m.id JOIN chart_of_accounts a ON a.id = l.account_id
          WHERE m.tenant_id = v_t AND m.status = 'posted' AND m.reversed_by IS NULL
            AND m.source_type = 'opening_balance' AND m.source_id = public.opening_section_key(v_t, 'contacts_match'));
  d1200 := round((led->>'1200')::numeric - ((r->'journal'->>'1200')::numeric - (bk->>'1200')::numeric), 2);
  d2150 := round((led->>'2150')::numeric - ((r->'journal'->>'2150')::numeric - (bk->>'2150')::numeric), 2);
  d2100 := round((led->>'2100')::numeric - ((r->'journal'->>'2100')::numeric - (bk->>'2100')::numeric), 2);
  d1460 := round((led->>'1460')::numeric - ((r->'journal'->>'1460')::numeric - (bk->>'1460')::numeric), 2);

  IF d1200 <> 0 THEN v_lines := v_lines || jsonb_build_object('account_code', '1200', 'debit', GREATEST(d1200, 0), 'credit', GREATEST(-d1200, 0), 'description', 'مطابقة مديونية العملاء مع الدفتر الموحد'); END IF;
  IF d1460 <> 0 THEN v_lines := v_lines || jsonb_build_object('account_code', '1460', 'debit', GREATEST(d1460, 0), 'credit', GREATEST(-d1460, 0), 'description', 'مطابقة مقدماتنا عند الموردين مع الدفتر الموحد'); END IF;
  IF d2150 <> 0 THEN v_lines := v_lines || jsonb_build_object('account_code', '2150', 'debit', GREATEST(-d2150, 0), 'credit', GREATEST(d2150, 0), 'description', 'مطابقة مقدمات العملاء مع الدفتر الموحد'); END IF;
  IF d2100 <> 0 THEN v_lines := v_lines || jsonb_build_object('account_code', '2100', 'debit', GREATEST(-d2100, 0), 'credit', GREATEST(d2100, 0), 'description', 'مطابقة مستحقات الموردين مع الدفتر الموحد'); END IF;
  v_bal := d1200 + d1460 - d2150 - d2100;
  IF v_bal <> 0 THEN
    v_lines := v_lines || jsonb_build_object('account_code', '3950', 'debit', GREATEST(-v_bal, 0), 'credit', GREATEST(v_bal, 0), 'description', 'فرق مطابقة الأرصدة الافتتاحية');
  END IF;

  IF NOT p_apply THEN
    RETURN jsonb_build_object('applied', false, 'ledger', led, 'books_2025', r->'books_2025', 'opening_entries', r->'opening_entries',
                              'gap', jsonb_build_object('1200', round((led->>'1200')::numeric - (r->'journal'->>'1200')::numeric, 2),
                                                        '2150', round((led->>'2150')::numeric - (r->'journal'->>'2150')::numeric, 2),
                                                        '2100', round((led->>'2100')::numeric - (r->'journal'->>'2100')::numeric, 2),
                                                        '1460', round((led->>'1460')::numeric - (r->'journal'->>'1460')::numeric, 2)),
                              'difference', jsonb_build_object('1200', d1200, '2150', d2150, '2100', d2100, '1460', d1460),
                              'lines', v_lines);
  END IF;

  FOR e IN SELECT m.id FROM journal_entries m
            WHERE m.tenant_id = v_t AND m.status = 'posted' AND m.reversed_by IS NULL
              AND m.source_type = 'opening_balance' AND m.source_id = public.opening_section_key(v_t, 'contacts_match') LOOP
    IF public.reverse_opening_entry(e.id, 'عكس مطابقة سابقة') IS NOT NULL THEN v_rev := v_rev + 1; END IF;
  END LOOP;
  IF jsonb_array_length(v_lines) > 0 THEN
    SELECT id INTO v_main FROM branches WHERE tenant_id = v_t AND code = 'MAIN-TREASURY' LIMIT 1;
    v_entry := public.post_journal(v_t, v_cut, 'مطابقة أرصدة العملاء والموردين الافتتاحية مع الدفتر الموحد', 'opening_balance',
                                   public.opening_section_key(v_t, 'contacts_match'), v_lines);
    IF v_entry IS NOT NULL THEN
      UPDATE journal_entries SET created_by = v_uid, branch_id = COALESCE(v_main, branch_id) WHERE id = v_entry;
    END IF;
  END IF;
  INSERT INTO audit_log (user_id, user_name, tenant_id, action, entity, entity_id, details)
  VALUES (v_uid, COALESCE((SELECT name FROM profiles WHERE id = v_uid), '?'), v_t, 'UPDATE', 'opening_balances', COALESCE(v_entry::text, ''),
          jsonb_build_object('match', jsonb_build_object('1200', d1200, '2150', d2150, '2100', d2100, '1460', d1460), 'reversed', v_rev, 'step', '6E'));
  RETURN jsonb_build_object('applied', true, 'entry_id', v_entry, 'reversed', v_rev,
                            'difference', jsonb_build_object('1200', d1200, '2150', d2150, '2100', d2100, '1460', d1460));
END
$fn$;

REVOKE ALL ON FUNCTION public.voucher_flow_class_of(text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_archive_cancel_parts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_archive_cancel_lines(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_archive_paid_in_ledger(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_archive_due_at_cutoff(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_archive_shipment_parts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_archive_shipment_due(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_pre_ledger_document_date() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.duplicate_fee_till_rows(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.repair_duplicate_fee_till_rows(boolean, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ledger_money_flow(text, uuid, date, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ledger_opening_books(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.match_opening_books(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_opening_books(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.duplicate_fee_till_rows(uuid), public.repair_duplicate_fee_till_rows(boolean, uuid),
                          public.ledger_money_flow(text, uuid, date, date, uuid) TO authenticated, service_role;

INSERT INTO public.security_rpc_allowlist (function_name, added_in, note) VALUES
  ('ledger_money_flow',              '0058', 'read-only money of a branch and period by method from the ledger; side permission and branch membership'),
  ('duplicate_fee_till_rows',        '0058', 'read-only list of transfer fees taken twice; company admins'),
  ('repair_duplicate_fee_till_rows', '0058', 'company admins; cancel-only correction (reversing till row + voucher cancelled), preview by default'),
  ('match_opening_books',            '0058', 'company admins; one opening entry for the difference between the books on 1 Jan 2026 and the ledger opening (preview by default; previous match reversed, never deleted)')
ON CONFLICT (function_name) DO UPDATE SET added_in = EXCLUDED.added_in, note = EXCLUDED.note;

ANALYZE public.ledger_gl_links;
ANALYZE public.money_movements;
ANALYZE public.payment_allocations;
ANALYZE public.journal_entries;

DO $check$
DECLARE v_list text;
BEGIN
  SELECT string_agg(function_signature, ', ') INTO v_list FROM public.security_exposed_definer_functions();
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Step 6E: definer functions executable by authenticated outside the allow-list: %', v_list;
  END IF;
END
$check$;