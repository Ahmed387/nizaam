-- 0141 checks — rollback-only (ends with RAISE). Run after migration 0141 (or with its text pasted above for a dry-run).
-- IN03400 (عبدالمنعم): heater 1 × 1,100 + kettle 280 + washer 1,800; kettle and washer came back in SR00076.
--  A) a cashier edits it directly → refused; he sends a request (heater 1,100 → 1,000, keep the return);
--     the owner approves → the invoice is 3,080, SR00076 is still active and its lines are still «returned».
--  B) the owner edits IN03400 again directly (heater → 900), keeps the return, refunds the 100 paid above the total now
--     → a refund voucher to the customer.
--  C) IN03383 (SR00078): the owner edits it and cancels the return first → SR00078 «ملغي».
DO $t$
DECLARE
  v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  v_t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
  v_inv uuid := 'fd2b31c6-b345-43e6-bf46-c8e81ff10071'; v_ret uuid := '2b859c1a-93ed-4957-9aca-dfb4da004064';
  v_inv2 uuid := '1cde3555-3629-4299-9771-0fc3f83976e0'; v_ret2 uuid := '1d64d43f-6e2b-4996-b2ab-9ec97b5f97e3';
  v_cust uuid := 'ec3c05a4-bc35-446d-b43f-9f16617eaf5c';
  v_items jsonb; v_items_b jsonb; v_cashier uuid; v_req uuid; v_seq jsonb; v_seq_after jsonb; r record;
  c_direct text; v_total_a numeric; v_ret_status text; v_retq int; v_total_b numeric; v_res jsonb; v_vstat text; v_ret2_status text;
BEGIN
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq FROM pg_sequences WHERE schemaname = 'public';
  v_items := jsonb_build_array(
    jsonb_build_object('product_id', '80010bd2-2e95-43fc-a2ae-ff3ccd31140b', 'product_name', 'سخان', 'quantity', 1, 'selling_price', 1000, 'line_discount', 0),
    jsonb_build_object('product_id', 'df58cde8-96ba-4f95-a228-be85b181a605', 'product_name', 'كنكة', 'quantity', 1, 'selling_price', 280, 'line_discount', 0),
    jsonb_build_object('product_id', 'a8543f31-27fc-497d-9895-834c5e6bc80d', 'product_name', 'غسالة', 'quantity', 1, 'selling_price', 1800, 'line_discount', 0));

  -- A) cashier: direct edit refused, request approved by the owner
  SELECT ur.user_id INTO v_cashier FROM public.user_roles ur WHERE ur.role = 'cashier' AND ur.tenant_id = v_t
     AND NOT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = ur.user_id AND x.role IN ('owner', 'admin')) LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cashier, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.edit_invoice(v_inv, v_cust, v_items, NULL, NULL); c_direct := 'allowed'; EXCEPTION WHEN OTHERS THEN c_direct := SQLERRM; END;
  INSERT INTO public.approval_requests (tenant_id, branch_id, entity_type, entity_id, entity_label, action, payload, reason, requested_by, requested_by_name)
  VALUES (v_t, '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213', 'invoice', v_inv, 'تعديل فاتورة IN03400', 'update',
          jsonb_build_object('rpc', 'edit_invoice', 'args', jsonb_build_object('_invoice_id', v_inv, '_customer_id', v_cust, '_items', v_items),
                             'before', jsonb_build_array(jsonb_build_object('label', 'سعر السخان', 'before', 1100, 'after', 1000))),
          'سعر غلط', v_cashier, 'كاشير')
  RETURNING id INTO v_req;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  UPDATE public.approval_requests SET status = 'approved', admin_id = v_owner,
         payload = payload || jsonb_build_object('return_action', 'keep', 'return_ids', jsonb_build_array(v_ret))
   WHERE id = v_req;
  SELECT total INTO v_total_a FROM public.invoices WHERE id = v_inv;
  SELECT coalesce(status, 'active') INTO v_ret_status FROM public.returns WHERE id = v_ret;
  SELECT coalesce(sum(returned_quantity), 0) INTO v_retq FROM public.invoice_items WHERE invoice_id = v_inv;

  -- B) owner directly: heater → 900, keep the return, refund the 100 paid above the new total
  v_items_b := jsonb_set(v_items, '{0,selling_price}', '900');
  v_res := public.apply_document_edit(jsonb_build_object('rpc', 'edit_invoice',
             'args', jsonb_build_object('_invoice_id', v_inv, '_customer_id', v_cust, '_items', v_items_b),
             'return_action', 'keep', 'return_ids', jsonb_build_array(v_ret),
             'excess', jsonb_build_object('action', 'refund', 'amount', 100, 'method', 'cash')));
  SELECT total INTO v_total_b FROM public.invoices WHERE id = v_inv;
  SELECT status INTO v_vstat FROM public.vouchers WHERE id = (v_res->>'refund_voucher')::uuid;

  -- C) owner cancels the return first
  PERFORM public.apply_document_edit(jsonb_build_object('rpc', 'edit_invoice',
             'args', jsonb_build_object('_invoice_id', v_inv2, '_customer_id', '311093d9-44fa-46e3-a3bd-555f689d3501',
                     '_items', jsonb_build_array(jsonb_build_object('product_id', '7f3d1ffb-30e2-4ba0-aa1f-71e52adfac63', 'product_name', 'مبرد', 'quantity', 1, 'selling_price', 4500, 'line_discount', 0))),
             'return_action', 'cancel', 'return_ids', jsonb_build_array(v_ret2)));
  SELECT status INTO v_ret2_status FROM public.returns WHERE id = v_ret2;

  FOR r IN SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' LOOP
    IF (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS DISTINCT FROM r.last_value::text
       AND (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS NOT NULL THEN
      PERFORM setval(format('%I.%I', r.schemaname, r.sequencename), (v_seq ->> (r.schemaname || '.' || r.sequencename))::bigint);
    END IF;
  END LOOP;
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq_after FROM pg_sequences WHERE schemaname = 'public';

  RAISE EXCEPTION '0141 CHECKS %', jsonb_build_object(
    'A1_cashier_direct_refused', c_direct, 'A2_total_after_approval_3080', v_total_a = 3080,
    'A3_return_kept', v_ret_status = 'active', 'A4_returned_lines_kept', v_retq = 2,
    'B1_total_2980', v_total_b = 2980, 'B2_refund_voucher', v_vstat, 'C1_return_cancelled', v_ret2_status,
    'C2_sequences_same', v_seq = v_seq_after);
END
$t$;
