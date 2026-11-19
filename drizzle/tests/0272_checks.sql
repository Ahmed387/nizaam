-- 0272 checks (rollback-only): the archive takes a «سهل» file of any branch, as the owner.
DO $t$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; OWNER uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  SK uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142';
  out text := ''; fails int := 0; ok boolean; err text; inv uuid; bid uuid; n int; before_n int;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', OWNER::text, true);
  SELECT count(*) INTO before_n FROM historical_invoices;
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- 1 a branch that was not one of the three fixed names («سكة تله») is accepted and linked to today's branch
  BEGIN
    INSERT INTO historical_invoices(branch_name, doc_type, invoice_no, date, year, month, total_amount)
    VALUES ('معرض سكة تله', 'sales', '1305', '2025-11-15', 2025, 11, 23800) RETURNING id, branch_id INTO inv, bid;
    ok := bid = SK;
  EXCEPTION WHEN others THEN ok := false; err := SQLERRM; END;
  IF ok THEN out := out || E'\nPASS 1 free branch «معرض سكة تله» → سكة تلة';
  ELSE fails := fails + 1; out := out || E'\nFAIL 1 ' || coalesce(err, 'branch_id ' || coalesce(bid::text, 'NULL')); END IF;

  -- 2 a branch nobody has today is kept with no branch link
  INSERT INTO historical_invoices(branch_name, doc_type, invoice_no, date, year, month, total_amount)
  VALUES ('فرع اتقفل من زمان', 'sales', '1', '2023-01-01', 2023, 1, 100) RETURNING branch_id INTO bid;
  IF bid IS NULL THEN out := out || E'\nPASS 2 unknown branch kept, not linked'; ELSE fails := fails + 1; out := out || E'\nFAIL 2'; END IF;

  -- 3 the same file twice is refused (one SHA-256 per company)
  INSERT INTO historical_archive_files(sha256, file_name, branch_name, kind, date_from, date_to, rows_count)
  VALUES (repeat('a', 64), 'x.xlsx', 'معرض سكة تله', 'sales', '2025-11-15', '2025-11-15', 1);
  BEGIN
    INSERT INTO historical_archive_files(sha256, file_name, branch_name, kind) VALUES (repeat('a', 64), 'y.xlsx', 'x', 'sales');
    ok := false;
  EXCEPTION WHEN unique_violation THEN ok := true; END;
  IF ok THEN out := out || E'\nPASS 3 same file refused'; ELSE fails := fails + 1; out := out || E'\nFAIL 3'; END IF;

  -- 4 the upsert key includes the company
  INSERT INTO historical_invoices(branch_name, doc_type, invoice_no, date, year, month, total_amount)
  VALUES ('معرض سكة تله', 'sales', '1305', '2025-11-15', 2025, 11, 99)
  ON CONFLICT (tenant_id, branch_name, doc_type, invoice_no, date) DO UPDATE SET total_amount = EXCLUDED.total_amount;
  SELECT count(*) INTO n FROM historical_invoices WHERE branch_name = 'معرض سكة تله' AND invoice_no = '1305';
  IF n = 1 AND (SELECT total_amount FROM historical_invoices WHERE id = inv) = 99 THEN out := out || E'\nPASS 4 upsert on (company, branch, type, number, day)';
  ELSE fails := fails + 1; out := out || E'\nFAIL 4 rows ' || n; END IF;

  -- 5 the branch list reads the free names
  IF EXISTS (SELECT 1 FROM public.historical_branches() WHERE branch_name = 'معرض سكة تله') THEN out := out || E'\nPASS 5 branch list';
  ELSE fails := fails + 1; out := out || E'\nFAIL 5'; END IF;
  RESET ROLE;
  out := out || format(E'\n(archive had %s invoices before)', before_n);
  RAISE EXCEPTION 'ROLLBACK — % failed%', fails, out;
END $t$;
