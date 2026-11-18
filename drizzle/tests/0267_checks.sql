-- 0267 checks (rollback-only): the stock count flow with its switches, as the real people of A&N.
-- Warehouse (محمد طه, شلبى) opens + counts + hands in, the owner reviews + approves + cancels; a manager (د/نور, عبدالمنعم)
-- opens / reviews / sends back / cancels but never approves; the cashier and a read-only manager open nothing.
DO $t$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; OWNER uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  WH uuid := '22bd79c0-ba02-4775-9e93-7b95ae2ae453'; NOUR uuid := '598491e8-589f-4ad1-88a6-62d6e9114bde';
  MAHMOUD uuid := '9aa41d69-13ef-41d8-a6ca-b6c722c95c62'; CASHIER uuid := 'a3174891-df98-4baa-a806-8c4c94d29eca';
  SH uuid := 'f2b47364-4837-4e1b-84b0-e39f78940d59'; AB uuid := '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213'; SK uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142';
  out text := ''; fails int := 0; ok boolean; err text; n int; sid uuid; sid2 uuid; items jsonb;
  a uuid; b uuid; c uuid; qa int; qb int; qc int; ava numeric; sysc numeric; v_day date; rec record; st text;
BEGIN
  -- three products of شلبى whose stock log and batches equal the quantity
  SELECT x.ids[1], x.ids[2], x.ids[3] INTO a, b, c FROM (SELECT array_agg(id) ids FROM (
    SELECT p.id FROM products p WHERE p.branch_id = SH AND p.quantity BETWEEN 4 AND 50 AND coalesce(p.avg_cost, 0) > 0
       AND coalesce(p.cost_price, 0) <> p.avg_cost
       AND (SELECT coalesce(sum(balance_after - balance_before), 0) FROM stock_movements m WHERE m.product_id = p.id) = p.quantity
       AND (SELECT coalesce(sum(quantity_remaining), 0) FROM product_batches pb WHERE pb.product_id = p.id) = p.quantity
     ORDER BY p.sku LIMIT 3) z) x;
  SELECT quantity, avg_cost INTO qa, ava FROM products WHERE id = a;
  SELECT quantity INTO qb FROM products WHERE id = b;
  SELECT quantity INTO qc FROM products WHERE id = c;
  INSERT INTO inventory_reservations (tenant_id, product_id, branch_id, reserved_quantity, invoice_draft_id, expires_at)
  VALUES (T, c, SH, 2, gen_random_uuid(), now() + interval '1 hour');

  -- 1 cashier (سكة) and a read-only manager (شلبى) cannot open a count
  PERFORM set_config('request.jwt.claims', json_build_object('sub', CASHIER, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', CASHIER::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.create_inventory_session(SK, 'x'); ok := false; EXCEPTION WHEN others THEN ok := true; END;
  RESET ROLE;
  IF ok THEN out := out || E'\nPASS 1a cashier refused'; ELSE fails := fails + 1; out := out || E'\nFAIL 1a cashier opened a count'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', MAHMOUD, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', MAHMOUD::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.create_inventory_session(SH, 'x'); ok := false; EXCEPTION WHEN others THEN ok := true; END;
  RESET ROLE;
  IF ok THEN out := out || E'\nPASS 1b read-only manager refused'; ELSE fails := fails + 1; out := out || E'\nFAIL 1b read-only manager opened'; END IF;

  -- 2 warehouse opens; a second open count is refused; the reserved product shows its full quantity
  PERFORM set_config('request.jwt.claims', json_build_object('sub', WH, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', WH::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  sid := public.create_inventory_session(SH, 'تجربة');
  BEGIN PERFORM public.create_inventory_session(SH, 'تاني'); ok := false; EXCEPTION WHEN others THEN ok := SQLERRM LIKE '%جرد مفتوح%'; END;
  IF ok THEN out := out || E'\nPASS 2a one open count per branch'; ELSE fails := fails + 1; out := out || E'\nFAIL 2a second count allowed'; END IF;
  SELECT system_quantity INTO sysc FROM inventory_session_items WHERE session_id = sid AND product_id = c;
  IF sysc = qc THEN out := out || E'\nPASS 2b reserved product shows the shelf quantity ' || sysc;
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 2b shows %s, real %s', sysc, qc); END IF;

  -- 3 no direct writes from the browser
  UPDATE inventory_session_items SET actual_quantity = 999 WHERE session_id = sid; GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN out := out || E'\nPASS 3a lines not writable directly'; ELSE fails := fails + 1; out := out || E'\nFAIL 3a wrote ' || n; END IF;
  UPDATE inventory_sessions SET status = 'pending_approval' WHERE id = sid; GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN out := out || E'\nPASS 3b status not writable directly'; ELSE fails := fails + 1; out := out || E'\nFAIL 3b status moved'; END IF;
  SELECT count(*) INTO n FROM inventory_session_items WHERE session_id = sid;
  IF n > 0 THEN out := out || E'\nPASS 3c lines still readable ' || n; ELSE fails := fails + 1; out := out || E'\nFAIL 3c lines not readable'; END IF;
  RESET ROLE;

  -- 4 warehouse counts (A −1, B +2, C = shelf) and hands in; then can't change it, can't review, can't approve
  SELECT jsonb_agg(jsonb_build_object('id', i.id, 'actual_quantity',
     CASE WHEN i.product_id = a THEN i.system_quantity - 1 WHEN i.product_id = b THEN i.system_quantity + 2 ELSE i.system_quantity END))
    INTO items FROM inventory_session_items i WHERE i.session_id = sid;
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.upsert_inventory_counts(sid, items);
  PERFORM public.submit_inventory_count(sid);
  BEGIN PERFORM public.upsert_inventory_counts(sid, items); ok := false; EXCEPTION WHEN others THEN ok := true; END;
  IF ok THEN out := out || E'\nPASS 4a no count change after hand-in'; ELSE fails := fails + 1; out := out || E'\nFAIL 4a count changed'; END IF;
  BEGIN PERFORM public.review_inventory_session(sid, '[]'); ok := false; EXCEPTION WHEN others THEN ok := true; END;
  IF ok THEN out := out || E'\nPASS 4b warehouse cannot review'; ELSE fails := fails + 1; out := out || E'\nFAIL 4b warehouse reviewed'; END IF;
  BEGIN PERFORM public.approve_inventory_session(sid); ok := false; EXCEPTION WHEN others THEN ok := true; END;
  IF ok THEN out := out || E'\nPASS 4c warehouse cannot approve'; ELSE fails := fails + 1; out := out || E'\nFAIL 4c warehouse approved'; END IF;
  RESET ROLE;

  -- 5 owner reviews with a reason, approves
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', OWNER::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT jsonb_agg(jsonb_build_object('id', id, 'reason', 'كسر')) INTO items FROM inventory_session_items WHERE session_id = sid AND product_id = a;
  PERFORM public.review_inventory_session(sid, items, 'تمام');
  SELECT status INTO st FROM inventory_sessions WHERE id = sid;
  IF st = 'pending_approval' AND (SELECT reason FROM inventory_session_items WHERE session_id = sid AND product_id = a) = 'كسر'
  THEN out := out || E'\nPASS 5a reviewed with reason'; ELSE fails := fails + 1; out := out || E'\nFAIL 5a ' || st; END IF;
  PERFORM public.approve_inventory_session(sid);
  RESET ROLE;
  IF (SELECT quantity FROM products WHERE id = a) = qa - 1 AND (SELECT quantity FROM products WHERE id = b) = qb + 2
     AND (SELECT quantity FROM products WHERE id = c) = qc
  THEN out := out || E'\nPASS 5b quantities: A −1, B +2, reserved C unchanged';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 5b A %s B %s C %s', (SELECT quantity FROM products WHERE id = a), (SELECT quantity FROM products WHERE id = b), (SELECT quantity FROM products WHERE id = c)); END IF;
  SELECT je.entry_date, (SELECT l.debit FROM journal_entry_lines l JOIN chart_of_accounts ac ON ac.id = l.account_id WHERE l.entry_id = je.id AND ac.code = '5600') d
    INTO rec FROM journal_entries je WHERE je.source_id = sid AND je.source_type = 'inventory_session';
  IF rec.d = round(ava, 2) AND rec.entry_date = (now() AT TIME ZONE 'Africa/Cairo')::date
  THEN out := out || E'\nPASS 5c shortage at the average cost ' || rec.d || ' on the Cairo day';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 5c shortage %s (avg %s) date %s', rec.d, ava, rec.entry_date); END IF;
  SELECT count(*) INTO n FROM stock_movements WHERE reference_id = sid AND reference_type = 'inventory_session' AND movement_type = 'adjustment';
  IF n = 2 THEN out := out || E'\nPASS 5d stock log typed'; ELSE fails := fails + 1; out := out || E'\nFAIL 5d log rows ' || n; END IF;
  IF (SELECT sum(balance_after - balance_before) FROM stock_movements WHERE product_id = b) = qb + 2
     AND (SELECT sum(quantity_remaining) FROM product_batches WHERE product_id = b) = qb + 2
  THEN out := out || E'\nPASS 5e log + batches = quantity'; ELSE fails := fails + 1; out := out || E'\nFAIL 5e'; END IF;

  -- 6 owner cancels the approved count → back as before
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.cancel_inventory_session(sid, 'تجربة'); ok := true; err := ''; EXCEPTION WHEN others THEN ok := false; err := SQLERRM; END;
  RESET ROLE;
  IF ok AND (SELECT quantity FROM products WHERE id = a) = qa AND (SELECT quantity FROM products WHERE id = b) = qb
     AND (SELECT sum(quantity_remaining) FROM product_batches WHERE product_id = b) = qb
     AND (SELECT sum(balance_after - balance_before) FROM stock_movements WHERE product_id = a) = qa
     AND (SELECT status FROM journal_entries WHERE source_id = sid AND source_type = 'inventory_session') = 'reversed'
  THEN out := out || E'\nPASS 6 approved count cancelled, all back';
  ELSE fails := fails + 1; out := out || E'\nFAIL 6 ' || err; END IF;

  -- 7 a manager (د/نور, عبدالمنعم): opens, counts, hands in, reviews; cannot approve; sends back; cancels
  PERFORM set_config('request.jwt.claims', json_build_object('sub', NOUR, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', NOUR::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  sid2 := public.create_inventory_session(AB, NULL);
  SELECT jsonb_agg(jsonb_build_object('id', id, 'actual_quantity', system_quantity)) INTO items
    FROM (SELECT id, system_quantity FROM inventory_session_items WHERE session_id = sid2 LIMIT 5) z;
  PERFORM public.upsert_inventory_counts(sid2, items);
  PERFORM public.submit_inventory_count(sid2);
  PERFORM public.review_inventory_session(sid2, '[]', NULL);
  BEGIN PERFORM public.approve_inventory_session(sid2); ok := false; EXCEPTION WHEN others THEN ok := true; END;
  IF ok THEN out := out || E'\nPASS 7a manager cannot approve'; ELSE fails := fails + 1; out := out || E'\nFAIL 7a manager approved'; END IF;
  st := public.return_inventory_session(sid2, 'راجع تاني');
  IF st = 'reviewing' THEN out := out || E'\nPASS 7b sent back to review'; ELSE fails := fails + 1; out := out || E'\nFAIL 7b ' || st; END IF;
  st := public.return_inventory_session(sid2, 'عد تاني');
  IF st = 'counting' THEN out := out || E'\nPASS 7c sent back to counting'; ELSE fails := fails + 1; out := out || E'\nFAIL 7c ' || st; END IF;
  PERFORM public.cancel_open_inventory_session(sid2, 'تجربة');
  RESET ROLE;
  IF (SELECT status FROM inventory_sessions WHERE id = sid2) = 'cancelled' THEN out := out || E'\nPASS 7d open count cancelled';
  ELSE fails := fails + 1; out := out || E'\nFAIL 7d'; END IF;

  RAISE EXCEPTION 'CHECKS fails=% %', fails, out;
END $t$;
