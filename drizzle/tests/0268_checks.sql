-- 0268 checks (rollback-only): documents go to the Telegram group queue, a document's own voucher rides inside it,
-- cancellations are queued, import mode and a company that switched it off queue nothing.
DO $t$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; OWNER uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  SK uuid := '1329f6cc-a4a5-418c-9e91-cccd651b3142';
  out text := ''; fails int := 0; n0 int; n int; v_cat uuid; v_vid uuid; p jsonb; q bigint; inv record; vch record;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', OWNER::text, true);
  SELECT id INTO v_cat FROM voucher_categories WHERE tenant_id = T AND type = 'receipt' AND is_active AND NOT is_system AND system_key IS NULL ORDER BY name LIMIT 1;

  -- 1 a hand-written receipt is queued and goes alone, with its maker
  SELECT count(*) INTO n0 FROM tg_doc_queue;
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_vid := public.create_manual_voucher(SK, 'receipt', v_cat, 10, 'cash', NULL, NULL, 0, 'other', NULL, 'تجربة الجروب', 'تجربة', (now() AT TIME ZONE 'Africa/Cairo')::date, NULL);
  RESET ROLE;
  SELECT id INTO q FROM tg_doc_queue WHERE kind = 'voucher' AND event = 'create' ORDER BY id DESC LIMIT 1;
  p := public.tg_doc_payload(q);
  IF p->>'title' = 'سند قبض' AND coalesce((p->>'skip')::boolean, false) = false AND p->>'branch' IS NOT NULL AND p->>'employee' <> '—'
  THEN out := out || E'\nPASS 1 manual receipt queued: ' || (p->>'number') || ' — ' || (p->>'branch') || ' — ' || (p->>'employee');
  ELSE fails := fails + 1; out := out || E'\nFAIL 1 ' || coalesce(p::text, 'no payload'); END IF;

  -- 2 a sale and its own voucher: the voucher rides inside the sale
  SELECT i.* INTO inv FROM invoices i WHERE i.invoice_number = 'IN47906';
  SELECT v.* INTO vch FROM vouchers v WHERE v.voucher_number = 'RV-6286';
  INSERT INTO tg_doc_queue (tenant_id, kind, doc_id, event) VALUES (T, 'sale', inv.id, 'create') ON CONFLICT DO NOTHING RETURNING id INTO q;
  p := public.tg_doc_payload(q);
  IF jsonb_array_length(p->'payments') >= 1 AND p->'payments' @> jsonb_build_array(jsonb_build_object('number', 'RV-6286'))
     AND jsonb_array_length(p->'lines') >= 1
  THEN out := out || format(E'\nPASS 2a sale %s has %s line(s) and its voucher RV-6286', p->>'number', jsonb_array_length(p->'lines'));
  ELSE fails := fails + 1; out := out || E'\nFAIL 2a ' || p::text; END IF;
  INSERT INTO tg_doc_queue (tenant_id, kind, doc_id, event) VALUES (T, 'voucher', vch.id, 'create') ON CONFLICT DO NOTHING RETURNING id INTO q;
  p := public.tg_doc_payload(q);
  IF (p->>'skip')::boolean THEN out := out || E'\nPASS 2b its voucher is not sent again';
  ELSE fails := fails + 1; out := out || E'\nFAIL 2b ' || p::text; END IF;

  -- 3 cancelling the manual receipt queues «اتلغى»
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.cancel_voucher(v_vid, 'تجربة الإلغاء');
  RESET ROLE;
  SELECT id INTO q FROM tg_doc_queue WHERE kind = 'voucher' AND doc_id = v_vid AND event = 'cancel';
  p := public.tg_doc_payload(q);
  IF q IS NOT NULL AND p->'cancel'->>'reason' LIKE '%تجربة%' THEN out := out || E'\nPASS 3 cancel queued with its reason';
  ELSE fails := fails + 1; out := out || E'\nFAIL 3 ' || coalesce(p::text, 'not queued'); END IF;
  -- and the create of a document cancelled before it went out is skipped
  SELECT id INTO q FROM tg_doc_queue WHERE kind = 'voucher' AND doc_id = v_vid AND event = 'create';
  IF (public.tg_doc_payload(q)->>'skip')::boolean THEN out := out || E'\nPASS 3b a cancelled one is not sent as new';
  ELSE fails := fails + 1; out := out || E'\nFAIL 3b'; END IF;

  -- 4 import mode and switched-off queue nothing
  SELECT count(*) INTO n0 FROM tg_doc_queue;
  PERFORM set_config('app.sahl_import', '1', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.create_manual_voucher(SK, 'receipt', v_cat, 10, 'cash', NULL, NULL, 0, 'other', NULL, 'تجربة', 'تجربة', (now() AT TIME ZONE 'Africa/Cairo')::date, NULL);
  RESET ROLE;
  PERFORM set_config('app.sahl_import', '0', true);
  UPDATE tenant_ops_settings SET tg_docs_enabled = false WHERE tenant_id = T;
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.create_manual_voucher(SK, 'receipt', v_cat, 10, 'cash', NULL, NULL, 0, 'other', NULL, 'تجربة', 'تجربة', (now() AT TIME ZONE 'Africa/Cairo')::date, NULL);
  RESET ROLE;
  SELECT count(*) INTO n FROM tg_doc_queue;
  IF n = n0 THEN out := out || E'\nPASS 4 import mode / switched off → nothing queued';
  ELSE fails := fails + 1; out := out || format(E'\nFAIL 4 %s new rows', n - n0); END IF;

  -- 5 the browser cannot read the queue
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN SELECT count(*) INTO n FROM tg_doc_queue; out := out || E'\nFAIL 5 queue readable'; fails := fails + 1;
  EXCEPTION WHEN insufficient_privilege THEN out := out || E'\nPASS 5 queue is server only'; END;
  RESET ROLE;

  RAISE EXCEPTION 'CHECKS fails=% %', fails, out;
END $t$;
