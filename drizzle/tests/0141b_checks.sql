-- 0141b checks — rollback-only (ends with RAISE). Run after migration 0141b (or with its text pasted above for a dry-run).
-- IN03400 (عبدالمنعم, 12/8): heater 1 × 1,100 + kettle 280 + washer 1,800; kettle and washer came back in SR00076.
--  R1) a branch manager WITH «تعديل المبيعات» sends: heater 1,100 → 1,000 AND the date 12/8 → 11/8 (one request, two steps)
--      → mode «requested», nothing changed yet.
--  R2) the same document again while it waits → refused.            R3) a manager WITHOUT the permission → refused.
--  R4) a step that is not for this document type (edit_shipment on an invoice) → refused.
--  R5) the owner approves, keeping the return → total 3,080, date 11/8, SR00076 still active.
--  R6) the owner sends through the same door → mode «applied» at once.
DO $t$
DECLARE
  v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  v_mgr uuid := '598491e8-589f-4ad1-88a6-62d6e9114bde';      -- branch manager of عبدالمنعم with sales.update
  v_mgr_no uuid := '9aa41d69-13ef-41d8-a6ca-b6c722c95c62';   -- branch manager of عبدالمنعم without it
  v_inv uuid := 'fd2b31c6-b345-43e6-bf46-c8e81ff10071'; v_ret uuid := '2b859c1a-93ed-4957-9aca-dfb4da004064';
  v_cust uuid := 'ec3c05a4-bc35-446d-b43f-9f16617eaf5c';
  v_items jsonb; v_payload jsonb; v_res jsonb; v_req uuid; v_seq jsonb; v_seq_after jsonb; r record;
  r1 text; r1_total numeric; r2 text; r3 text; r4 text; r5_total numeric; r5_day date; r5_ret text; r6 text;
BEGIN
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq FROM pg_sequences WHERE schemaname = 'public';
  v_items := jsonb_build_array(
    jsonb_build_object('product_id', '80010bd2-2e95-43fc-a2ae-ff3ccd31140b', 'product_name', 'سخان', 'quantity', 1, 'selling_price', 1000, 'line_discount', 0),
    jsonb_build_object('product_id', 'df58cde8-96ba-4f95-a228-be85b181a605', 'product_name', 'كنكة', 'quantity', 1, 'selling_price', 280, 'line_discount', 0),
    jsonb_build_object('product_id', 'a8543f31-27fc-497d-9895-834c5e6bc80d', 'product_name', 'غسالة', 'quantity', 1, 'selling_price', 1800, 'line_discount', 0));
  v_payload := jsonb_build_object('rpc', 'edit_invoice',
    'args', jsonb_build_object('_invoice_id', v_inv, '_customer_id', v_cust, '_items', v_items),
    'return_ids', jsonb_build_array(v_ret),
    'diff', jsonb_build_array('سعر «سخان»: 1,100 ← 1,000', 'التاريخ: 12/08/2026 ← 11/08/2026'),
    'then', jsonb_build_object('rpc', 'update_invoice_date_sovereign',
      'args', jsonb_build_object('p_invoice_id', v_inv, 'p_new_date', '2026-08-11T16:33:00+00', 'p_reason', 'تعديل التاريخ')));

  -- R1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  v_res := public.request_document_edit('invoice', v_inv, 'فاتورة IN03400', v_payload, 'سعر غلط');
  r1 := v_res->>'mode'; v_req := (v_res->>'request_id')::uuid;
  SELECT total INTO r1_total FROM public.invoices WHERE id = v_inv;
  -- R2
  BEGIN PERFORM public.request_document_edit('invoice', v_inv, 'فاتورة IN03400', v_payload, NULL); r2 := 'allowed';
  EXCEPTION WHEN OTHERS THEN r2 := SQLERRM; END;
  -- R4
  BEGIN PERFORM public.request_document_edit('invoice', v_inv, 'x', jsonb_build_object('rpc', 'edit_shipment', 'args', '{}'::jsonb), NULL); r4 := 'allowed';
  EXCEPTION WHEN OTHERS THEN r4 := SQLERRM; END;
  -- R3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr_no, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.request_document_edit('invoice', v_inv, 'x', v_payload, NULL); r3 := 'allowed';
  EXCEPTION WHEN OTHERS THEN r3 := SQLERRM; END;

  -- R5: the owner approves and answers «سيب المرتجع»
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  UPDATE public.approval_requests SET status = 'approved', admin_id = v_owner,
         payload = payload || jsonb_build_object('return_action', 'keep') WHERE id = v_req;
  SELECT total, (invoice_date AT TIME ZONE 'Africa/Cairo')::date INTO r5_total, r5_day FROM public.invoices WHERE id = v_inv;
  SELECT coalesce(status, 'active') INTO r5_ret FROM public.returns WHERE id = v_ret;

  -- R6: the owner through the same door
  v_res := public.request_document_edit('invoice', v_inv, 'فاتورة IN03400',
    jsonb_build_object('rpc', 'edit_invoice', 'return_action', 'keep',
      'args', jsonb_build_object('_invoice_id', v_inv, '_customer_id', v_cust, '_items', jsonb_set(v_items, '{0,selling_price}', '950'))), NULL);
  r6 := v_res->>'mode';

  FOR r IN SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' LOOP
    IF (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS DISTINCT FROM r.last_value::text
       AND (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS NOT NULL THEN
      PERFORM setval(format('%I.%I', r.schemaname, r.sequencename), (v_seq ->> (r.schemaname || '.' || r.sequencename))::bigint);
    END IF;
  END LOOP;
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq_after FROM pg_sequences WHERE schemaname = 'public';

  RAISE EXCEPTION '0141b CHECKS %', jsonb_build_object(
    'R1_requested', r1, 'R1_total_unchanged_3180', r1_total, 'R2_duplicate_refused', r2, 'R3_no_permission_refused', r3,
    'R4_wrong_step_refused', r4, 'R5_total_3080', r5_total, 'R5_day_2026_08_11', r5_day, 'R5_return_active', r5_ret,
    'R6_owner_applied', r6, 'seq_same', v_seq = v_seq_after);
END
$t$;
