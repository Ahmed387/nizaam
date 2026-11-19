-- 0271 checks (rollback-only): partial count in شلبى as ا/محمد طه (warehouse).
DO $t$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; WH uuid := '22bd79c0-ba02-4775-9e93-7b95ae2ae453';
  CASHIER uuid := 'a3174891-df98-4baa-a806-8c4c94d29eca';
  SH uuid := 'f2b47364-4837-4e1b-84b0-e39f78940d59'; SK uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142';
  out text := ''; fails int := 0; ok boolean; err text; ids uuid[]; other uuid; sid uuid; n int; moved int; wash int;
BEGIN
  SELECT array_agg(id) INTO ids FROM (SELECT id FROM products WHERE branch_id = SH AND archived_at IS NULL AND name LIKE '%غسال%' ORDER BY name LIMIT 5) z;
  SELECT count(*) INTO wash FROM products WHERE branch_id = SH AND archived_at IS NULL AND name LIKE '%غسال%';
  SELECT id INTO other FROM products WHERE branch_id = SK AND archived_at IS NULL LIMIT 1;

  -- 1 the cashier cannot open one
  PERFORM set_config('request.jwt.claims', json_build_object('sub', CASHIER, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', CASHIER::text, true);
  BEGIN PERFORM public.create_partial_inventory_session(SK, 'x', ARRAY[other], '{"mode":"items"}'); ok := false;
  EXCEPTION WHEN others THEN ok := true; END;
  IF ok THEN out := out || E'\nPASS 1 cashier refused'; ELSE fails := fails + 1; out := out || E'\nFAIL 1 cashier opened'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', WH, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', WH::text, true);
  -- 2 an item of another branch is refused; an empty list is refused
  BEGIN PERFORM public.create_partial_inventory_session(SH, 'x', ids || other, '{"mode":"items"}'); ok := false;
  EXCEPTION WHEN others THEN ok := SQLERRM LIKE '%مش في الفرع%'; err := SQLERRM; END;
  IF ok THEN out := out || E'\nPASS 2a other branch item refused'; ELSE fails := fails + 1; out := out || E'\nFAIL 2a ' || coalesce(err, 'opened'); END IF;
  BEGIN PERFORM public.create_partial_inventory_session(SH, 'x', ARRAY[]::uuid[], '{"mode":"items"}'); ok := false;
  EXCEPTION WHEN others THEN ok := SQLERRM LIKE '%صنف واحد%'; END;
  IF ok THEN out := out || E'\nPASS 2b empty list refused'; ELSE fails := fails + 1; out := out || E'\nFAIL 2b'; END IF;

  -- 3 «غسالة»: only the chosen items, with the scope kept
  sid := public.create_partial_inventory_session(SH, 'جرد الغسالات', ids, '{"mode":"words","words":"غسالة"}');
  SELECT count(*) INTO n FROM inventory_session_items WHERE session_id = sid;
  IF n = cardinality(ids) AND (SELECT scope->>'words' FROM inventory_sessions WHERE id = sid) = 'غسالة'
     AND (SELECT (scope->>'count')::int FROM inventory_sessions WHERE id = sid) = n
  THEN out := out || format(E'\nPASS 3 partial count holds %s of %s washers only', n, wash);
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 3 lines %s of %s', n, cardinality(ids)); END IF;

  -- 4 a second open count (partial or full) is refused
  BEGIN PERFORM public.create_inventory_session(SH, 'كامل'); ok := false;
  EXCEPTION WHEN others THEN ok := SQLERRM LIKE '%جرد مفتوح%'; END;
  IF ok THEN out := out || E'\nPASS 4 one open count per branch'; ELSE fails := fails + 1; out := out || E'\nFAIL 4'; END IF;

  -- 5 items moved in October
  SELECT count(*) INTO moved FROM public.count_moved_products(SH, '2026-10-01', '2026-10-31');
  IF moved > 0 THEN out := out || format(E'\nPASS 5 %s items moved in October', moved);
  ELSE fails := fails + 1; out := out || E'\nFAIL 5 nothing moved'; END IF;

  RAISE EXCEPTION 'ROLLBACK — % failed%', fails, out;
END $t$;
