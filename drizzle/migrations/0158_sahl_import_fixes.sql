-- 0158: fixes found by the dry-runs of the «سهل» import (0157), owner 2026-11-05 «نفذها بالكامل وارفع الكل».
--  * The old products have no brand / model (the owner removed the brands, 0153): in import mode only, a new product
--    may be saved without them (`enforce_product_variant_fields`). Outside import mode nothing changes.
--  * The company refuses two accounts whose names are the same after its name rule (ة / ه, ى / ي, أ / ا, spaces —
--    `contacts_block_similar_name`). In «سهل» the same person was sometimes typed twice in one branch
--    («أ/ ايمان جمال» and «ا/ ايمان جمال» in عبدالمنعم): both spellings become ONE account of that branch (the
--    spelling with most documents; opening balances added; customer + supplier = both). A name also in another branch
--    after that rule gets «(الفرع)», like an exact repeat (owner «حساب لكل فرع»).
--  * `sahl_import.dry(day)`: the whole import up to that day in ONE transaction that always ends in an error (nothing
--    stays, document numbers put back with setval), run by pg_cron so the web gateway's time limit does not cut it;
--    its summary is the job's error message in cron.job_run_details.
DO $mig$
BEGIN
  PERFORM sahl_import._patch('public.enforce_product_variant_fields()'::regprocedure,
    $p$IF TG_OP = 'INSERT' AND COALESCE(NEW.is_migrated, false) = false THEN$p$,
    $p$IF TG_OP = 'INSERT' AND COALESCE(NEW.is_migrated, false) = false AND NOT public.sahl_import_mode() THEN  -- 0158$p$);
END
$mig$;

ALTER TABLE sahl_import.acc ADD COLUMN IF NOT EXISTS canon text;

DO $mig$
BEGIN
  PERFORM sahl_import._patch('sahl_import.build()'::regprocedure,
$p$  UPDATE sahl_import.acc a SET display = CASE
      WHEN EXISTS (SELECT 1 FROM sahl_import.acc b WHERE b.name = a.name AND b.branch <> a.branch)$p$,
$p$  -- 0158: the same person typed twice in one branch (ة / ه, ى / ي, أ / ا, spaces) = ONE account: the spelling with most documents
  UPDATE sahl_import.acc a SET canon = g.canon FROM (
    SELECT x.branch, x.name, first_value(x.name) OVER (PARTITION BY x.branch, x.k ORDER BY x.docs DESC, x.name) AS canon
      FROM (SELECT a1.branch, a1.name, trim(public.normalize_ar_name(a1.name)) AS k, coalesce(d.docs, 0) AS docs
              FROM sahl_import.acc a1 LEFT JOIN (SELECT r.branch, btrim(r.rec->>'الحساب') AS name, count(*) AS docs
                                                    FROM sahl_import.records r GROUP BY 1, 2) d ON d.branch = a1.branch AND d.name = a1.name) x) g
   WHERE g.branch = a.branch AND g.name = a.name;
  UPDATE sahl_import.acc a SET type = 'both' WHERE a.name = a.canon
     AND EXISTS (SELECT 1 FROM sahl_import.acc b WHERE b.branch = a.branch AND b.canon = a.name AND b.type IS DISTINCT FROM a.type);
  -- a name also in another branch (same after the system's name rule) gets «(الفرع)»
  UPDATE sahl_import.acc a SET display = CASE
      WHEN EXISTS (SELECT 1 FROM sahl_import.acc b WHERE trim(public.normalize_ar_name(b.name)) = trim(public.normalize_ar_name(a.name)) AND b.branch <> a.branch)$p$);
  PERFORM sahl_import._patch('sahl_import.run_setup()'::regprocedure,
    $p$FOR r IN SELECT * FROM sahl_import.acc WHERE contact_id IS NULL ORDER BY branch, name LOOP$p$,
    $p$FOR r IN SELECT * FROM sahl_import.acc WHERE contact_id IS NULL AND name = coalesce(canon, name) ORDER BY branch, name LOOP  -- 0158$p$);
  PERFORM sahl_import._patch('sahl_import.run_setup()'::regprocedure,
    $p$UPDATE sahl_import.acc SET contact_id = (v_res->>'id')::uuid WHERE branch = r.branch AND name = r.name;$p$,
    $p$UPDATE sahl_import.acc SET contact_id = (v_res->>'id')::uuid WHERE branch = r.branch AND coalesce(canon, name) = r.name;  -- 0158: every spelling$p$);
  PERFORM sahl_import._patch('sahl_import.run_setup()'::regprocedure,
$p$SELECT jsonb_agg(jsonb_build_object('contact_id', a.contact_id, 'amount', a.opening)) INTO v_cont
    FROM sahl_import.acc a WHERE abs(a.opening) >= 0.005;$p$,
$p$SELECT jsonb_agg(jsonb_build_object('contact_id', z.contact_id, 'amount', z.amount)) INTO v_cont  -- 0158: one row per account
    FROM (SELECT a.contact_id, sum(a.opening) AS amount FROM sahl_import.acc a GROUP BY a.contact_id HAVING abs(sum(a.opening)) >= 0.005) z;$p$);
END
$mig$;

-- the dry-run: everything up to p_to, then rolled back (it always raises); sequences put back first
CREATE OR REPLACE FUNCTION sahl_import.dry(p_to date) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s record; v_seq jsonb := '[]'; v_b jsonb; v_setup jsonb; v_run jsonb; v_err text; v_kinds jsonb; v_ctx text;
        v_t0 timestamptz := clock_timestamp(); v_t1 timestamptz; v_t2 timestamptz; v_t3 timestamptz;
BEGIN
  FOR s IN SELECT schemaname, sequencename, last_value, start_value FROM pg_sequences WHERE schemaname IN ('public', 'sahl_import') LOOP
    v_seq := v_seq || jsonb_build_object('s', quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename), 'v', s.last_value, 'st', s.start_value);
  END LOOP;
  BEGIN
    v_b := sahl_import.build();
    v_t1 := clock_timestamp();
    v_setup := sahl_import.run_setup();
    v_t2 := clock_timestamp();
    v_run := sahl_import.run_ops(p_to, false);
    v_t3 := clock_timestamp();
    SELECT jsonb_object_agg(k, c) INTO v_kinds FROM (SELECT kind || ':' || status AS k, count(*) AS c FROM sahl_import.ops WHERE day <= p_to GROUP BY 1) z;
    SELECT string_agg(k || ' x' || c || ': ' || left(e, 220), E'\n') INTO v_err
      FROM (SELECT kind AS k, regexp_replace(err, '[0-9]{3,}', '#', 'g') AS e, count(*) AS c FROM sahl_import.ops
             WHERE status = 'error' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30) z;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_ctx = PG_EXCEPTION_CONTEXT;
    v_err := 'FATAL: ' || SQLERRM || E'\n' || left(v_ctx, 600);
  END;
  FOR s IN SELECT e->>'s' AS sq, (e->>'v')::bigint AS v, (e->>'st')::bigint AS st FROM jsonb_array_elements(v_seq) e LOOP
    IF s.v IS NULL THEN PERFORM setval(s.sq, s.st, false); ELSE PERFORM setval(s.sq, s.v, true); END IF;
  END LOOP;
  RAISE EXCEPTION E'DRY to % | build %s setup %s run %s\nsetup: %\nrun: %\nkinds: %\nerrors:\n%', p_to,
    round(extract(epoch FROM v_t1 - v_t0)::numeric, 1), round(extract(epoch FROM v_t2 - v_t1)::numeric, 1),
    round(extract(epoch FROM v_t3 - v_t2)::numeric, 1), v_setup, v_run, v_kinds, coalesce(v_err, 'none');
END
$$;
