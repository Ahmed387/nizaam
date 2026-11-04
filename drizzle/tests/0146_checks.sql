-- 0146 checks — rollback-only (ends with RAISE). Run after migration 0146 (or with its text pasted above for a dry-run).
-- Each case: a picture (stock of the lines, the branch's cash till, the contact's balance, the books on the document's
-- day and today), cancel, restore, the picture again — the same, except where the owner chose otherwise.
--  A) SR00072 (sale return 3,400 cash, عبدالمنعم 9/10) → same picture; the invoice lines count it as returned again
--  B) PR00025 (purchase return 13,100 on account, 25/8) → same picture
--  C) PO00395 (purchase 88,730, nothing paid, 8/8) cancelled «تحت حسابه» → same picture; batches full again
--  D) PO00578 (purchase 200 paid, عبدالمنعم 18/2) cancelled «المورد رجّع» cash → restore without an answer refused →
--     «هترجعهوله النهارده» → same stock / supplier / books / till total (200 in, 200 out today);
--     D2) the same again with «كأن الاسترداد ماحصلش» → the same picture
--  E) PO01531 (purchase 36,400 paid, شلبى, no supplier) cancelled «غلط ومفيش فلوس» → «يفضلوا علينا» → its plan
--     is open again (36,400), the till 36,400 higher (the payment was voided on its day), stock back
--  F) a branch manager: direct restore refused; a request; the owner's approval restores it
DO $t$
DECLARE
  v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  v_mgr uuid := '598491e8-589f-4ad1-88a6-62d6e9114bde';
  a_sr uuid := 'ca2dab77-9874-4d7e-b5cc-503301da7662'; b_pr uuid := 'd959f9ff-aac0-4b14-b4ab-276aa4d5a3f7';
  c_po uuid := '1c5cc13c-e9a1-4871-bc94-ae24bce3baab'; d_po uuid := '7ece995b-319d-4859-85ff-21640cbb1942'; e_po uuid := 'ec832240-82fe-4fe0-a1e7-f453b5cded88';
  v_seq jsonb; v_seq_after jsonb; r record; s0 jsonb; s1 jsonb; x jsonb; v_err text; v_req uuid;
  v_rq0 numeric; v_rq1 numeric; v_b0 numeric; v_b1 numeric;
BEGIN
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq FROM pg_sequences WHERE schemaname = 'public';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET CONSTRAINTS ALL IMMEDIATE;
  CREATE TEMP TABLE t0146 (k text, v jsonb) ON COMMIT DROP;
  -- the books on two days (the document's and today) for the money / stock / party accounts
  CREATE OR REPLACE FUNCTION pg_temp.gl(p_day date) RETURNS jsonb LANGUAGE sql AS $f$
    SELECT coalesce(jsonb_object_agg(code, s), '{}') FROM (
      SELECT c.code, round(sum(l.debit - l.credit), 2) s
        FROM public.journal_entries e JOIN public.journal_entry_lines l ON l.entry_id = e.id JOIN public.chart_of_accounts c ON c.id = l.account_id
       WHERE e.tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71' AND e.status = 'posted' AND e.entry_date IN (p_day, public.cairo_today())
         AND c.code IN ('1100', '1200', '1300', '1460', '2100', '2150', '4100', '4900', '5100')
       GROUP BY 1) g WHERE s <> 0;
  $f$;
  CREATE OR REPLACE FUNCTION pg_temp.pic(p_branch uuid, p_products uuid[], p_contact uuid, p_day date) RETURNS jsonb LANGUAGE sql AS $f$
    SELECT jsonb_build_object(
      'stock', (SELECT jsonb_object_agg(p.id, p.quantity) FROM public.products p WHERE p.id = ANY (p_products)),
      'till', (SELECT round(coalesce(sum(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0), 2) FROM public.treasury
                WHERE branch_id = p_branch AND coalesce(payment_method, 'cash') = 'cash'),
      'contact', (SELECT round(ledger_balance, 2) FROM public.v_contact_balances WHERE contact_id = p_contact),
      'gl', pg_temp.gl(p_day));
  $f$;

  -- A) sale return
  SELECT jsonb_build_object('b', r2.branch_id, 'p', (SELECT array_agg(product_id) FROM public.return_items WHERE return_id = r2.id), 'c', i.contact_id,
                            'd', (r2.invoice_date AT TIME ZONE 'Africa/Cairo')::date) INTO x
    FROM public.returns r2 JOIN public.invoices i ON i.id = r2.invoice_id WHERE r2.id = a_sr;
  SELECT sum(returned_quantity) INTO v_rq0 FROM public.invoice_items WHERE invoice_id = (SELECT invoice_id FROM public.returns WHERE id = a_sr);
  s0 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
  PERFORM public.cancel_sale_return(a_sr, 'تجربة 0146');
  INSERT INTO t0146 VALUES ('A_res', public.restore_cancelled_sale_return(a_sr));
  s1 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
  SELECT sum(returned_quantity) INTO v_rq1 FROM public.invoice_items WHERE invoice_id = (SELECT invoice_id FROM public.returns WHERE id = a_sr);
  INSERT INTO t0146 VALUES ('A_same', to_jsonb(s0 = s1)), ('A_returned_qty_same', to_jsonb(v_rq0 = v_rq1)),
    ('A_status', to_jsonb((SELECT status FROM public.returns WHERE id = a_sr)));
  IF s0 <> s1 THEN INSERT INTO t0146 VALUES ('A_before', s0), ('A_after', s1); END IF;

  -- B) purchase return
  SELECT jsonb_build_object('b', branch_id, 'p', (SELECT array_agg(product_id) FROM public.purchase_return_items WHERE purchase_return_id = pr.id), 'c', contact_id,
                            'd', (invoice_date AT TIME ZONE 'Africa/Cairo')::date) INTO x FROM public.purchase_returns pr WHERE id = b_pr;
  s0 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
  PERFORM public.cancel_purchase_return(b_pr, 'تجربة 0146');
  INSERT INTO t0146 VALUES ('B_res', public.restore_cancelled_purchase_return(b_pr));
  s1 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
  INSERT INTO t0146 VALUES ('B_same', to_jsonb(s0 = s1));
  IF s0 <> s1 THEN INSERT INTO t0146 VALUES ('B_before', s0), ('B_after', s1); END IF;

  -- C) purchase invoice, nothing paid
  SELECT jsonb_build_object('b', branch_id, 'p', (SELECT array_agg(product_id) FROM public.shipment_items WHERE shipment_id = s.id), 'c', contact_id,
                            'd', (invoice_date AT TIME ZONE 'Africa/Cairo')::date) INTO x FROM public.shipments s WHERE id = c_po;
  SELECT sum(quantity_remaining) INTO v_b0 FROM public.product_batches WHERE shipment_id = c_po;
  s0 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
  PERFORM public.cancel_purchase_invoice(c_po, 'تجربة 0146', 'credit', 'cash');
  INSERT INTO t0146 VALUES ('C_res', public.restore_cancelled_shipment(c_po, '{}'::jsonb));
  s1 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
  SELECT sum(quantity_remaining) INTO v_b1 FROM public.product_batches WHERE shipment_id = c_po;
  INSERT INTO t0146 VALUES ('C_same', to_jsonb(s0 = s1)), ('C_batches_same', to_jsonb(v_b0 = v_b1)),
    ('C_status', to_jsonb((SELECT status FROM public.shipments WHERE id = c_po)));
  IF s0 <> s1 THEN INSERT INTO t0146 VALUES ('C_before', s0), ('C_after', s1); END IF;
  -- and it can be cancelled again (the purchase entry is reversible again)
  PERFORM public.cancel_purchase_invoice(c_po, 'تجربة 0146 تاني', 'credit', 'cash');
  s1 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
  INSERT INTO t0146 VALUES ('C_cancel_again_books', s1->'gl'), ('C_before_books', s0->'gl');
  PERFORM public.restore_cancelled_shipment(c_po, '{}'::jsonb);

  -- D) purchase invoice refunded by the supplier → we pay again
  SELECT jsonb_build_object('b', branch_id, 'p', (SELECT array_agg(product_id) FROM public.shipment_items WHERE shipment_id = s.id), 'c', contact_id,
                            'd', (invoice_date AT TIME ZONE 'Africa/Cairo')::date) INTO x FROM public.shipments s WHERE id = d_po;
  s0 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
  PERFORM public.cancel_purchase_invoice(d_po, 'تجربة 0146', 'refund', 'cash');
  BEGIN PERFORM public.restore_cancelled_shipment(d_po, '{}'::jsonb); v_err := 'allowed'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  INSERT INTO t0146 VALUES ('D_refused_without_answer', to_jsonb(v_err));
  INSERT INTO t0146 VALUES ('D_res', public.restore_cancelled_shipment(d_po, jsonb_build_object('action', 'pay', 'method', 'cash')));
  s1 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
  INSERT INTO t0146 VALUES ('D_stock_same', to_jsonb(s0->'stock' = s1->'stock')), ('D_till_same', to_jsonb(s0->'till' = s1->'till')),
    ('D_supplier_same', to_jsonb(s0->'contact' = s1->'contact')), ('D_books_same', to_jsonb(s0->'gl' = s1->'gl'));
  -- D2) again, «كأن الاسترداد ماحصلش» → the whole picture is the same
  PERFORM public.cancel_purchase_invoice(d_po, 'تجربة 0146 (D2)', 'refund', 'cash');
  PERFORM public.restore_cancelled_shipment(d_po, jsonb_build_object('action', 'as_before'));
  s1 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
  INSERT INTO t0146 VALUES ('D2_same', to_jsonb(s0 = s1));
  IF s0 <> s1 THEN INSERT INTO t0146 VALUES ('D2_before', s0), ('D2_after', s1); END IF;

  -- E) purchase invoice voided → stays owed
  SELECT jsonb_build_object('b', branch_id, 'p', (SELECT array_agg(product_id) FROM public.shipment_items WHERE shipment_id = s.id), 'c', contact_id,
                            'd', (invoice_date AT TIME ZONE 'Africa/Cairo')::date) INTO x FROM public.shipments s WHERE id = e_po;
  s0 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
  PERFORM public.cancel_purchase_invoice(e_po, 'تجربة 0146', 'void', 'cash');
  INSERT INTO t0146 VALUES ('E_res', public.restore_cancelled_shipment(e_po, jsonb_build_object('action', 'debt')));
  s1 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
  INSERT INTO t0146 VALUES ('E_stock_same', to_jsonb(s0->'stock' = s1->'stock')),
    ('E_till_change_p36400', to_jsonb(round((s1->>'till')::numeric - (s0->>'till')::numeric, 2))),
    ('E_supplier_change', to_jsonb(round((s1->>'contact')::numeric - (s0->>'contact')::numeric, 2))),
    ('E_plan_remaining', to_jsonb((SELECT remaining_amount FROM public.payment_plans WHERE reference_type = 'shipment' AND reference_id = e_po LIMIT 1)));

  -- F) the manager asks, the owner approves
  PERFORM public.cancel_sale_return(a_sr, 'تجربة 0146 (F)');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.restore_cancelled_sale_return(a_sr); v_err := 'allowed'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  x := public.request_document_edit('sale_return', a_sr, 'استرجاع مرتجع SR00072',
         jsonb_build_object('rpc', 'restore_sale_return', 'args', jsonb_build_object('p_return_id', a_sr), 'diff', jsonb_build_array('الحالة: ملغي ← شغال')), 'اتلغى بالغلط');
  v_req := (x->>'request_id')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  UPDATE public.approval_requests SET status = 'approved', admin_id = v_owner WHERE id = v_req;
  INSERT INTO t0146 VALUES ('F_direct_refused', to_jsonb(v_err)), ('F_mode', x->'mode'),
    ('F_status_after_approval', to_jsonb((SELECT status FROM public.returns WHERE id = a_sr)));

  FOR r IN SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' LOOP
    IF (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS DISTINCT FROM r.last_value::text
       AND (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS NOT NULL THEN
      PERFORM setval(format('%I.%I', r.schemaname, r.sequencename), (v_seq ->> (r.schemaname || '.' || r.sequencename))::bigint);
    END IF;
  END LOOP;
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq_after FROM pg_sequences WHERE schemaname = 'public';
  INSERT INTO t0146 VALUES ('seq_same', to_jsonb(v_seq = v_seq_after));
  RAISE EXCEPTION '0146 CHECKS %', (SELECT jsonb_object_agg(k, v) FROM t0146);
END
$t$;
