-- 0142 checks — rollback-only (ends with RAISE). Run after migration 0142 (or with its text pasted above for a dry-run).
-- Each case: take a picture (stock of the lines, the books per account, the till of the branch, the customer's
-- balance), cancel, restore, take the picture again — it must be the same, except where the owner chose otherwise.
--  A) IN04941 (1,050 cash, عبدالمنعم 5/10): cancelled «لحسابه» (credit) → restored → same picture.
--  B) IN04938 (1,250 cash): cancelled with the 1,250 given back in cash → restore without an answer is refused →
--     restore «يدفع تاني دلوقتي» → same picture (the refund row is mirrored today).
--  C) IN04952 (1,285 cash): cancelled «غلط ومفيش فلوس» (void) → restore «يفضل عليه» → stock as before, the
--     customer now owes 1,285, the till is 1,285 lower and the books say the same (cash −1,285, customers +1,285).
--  D) RV-3227 (customer receipt 5,000 cash, 5/9): cancelled → restored → same picture.
--  E) a branch manager cannot restore directly; he can send a request; the owner's approval restores it.
DO $t$
DECLARE
  v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  v_mgr uuid := '598491e8-589f-4ad1-88a6-62d6e9114bde';
  v_t uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71';
  v_br uuid := '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213';
  a_inv uuid := '3f565c0e-1e57-4295-95bb-757f8e174b44'; b_inv uuid := 'ae70ab13-6433-4ab4-b25e-586ae1b4aeb7';
  c_inv uuid := '4175e631-6f70-4691-bd1f-eb42c887b8e6'; d_v uuid := '78fe477d-0c83-449c-93ba-6cf71fe1c5b6';
  v_seq jsonb; v_seq_after jsonb; r record; s0 jsonb; s1 jsonb; x jsonb; v_req uuid;
  ra jsonb; rb jsonb; rb_refused text; rc jsonb; rd jsonb; re_direct text; re_mode text; re_status text;
BEGIN
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq FROM pg_sequences WHERE schemaname = 'public';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  SET CONSTRAINTS ALL IMMEDIATE;   -- the ledger triggers fire now, not at commit
  CREATE TEMP TABLE t0142 (k text, v jsonb) ON COMMIT DROP;
  -- the books change of THIS transaction on the money accounts (new posted entries − entries that stopped being posted)
  CREATE OR REPLACE FUNCTION pg_temp.gl() RETURNS jsonb LANGUAGE sql AS $f$
    SELECT coalesce(jsonb_object_agg(code, s), '{}') FROM (
      SELECT c.code, round(sum(CASE WHEN e.status = 'posted' AND e.created_at = now() THEN l.debit - l.credit
                                    WHEN e.status <> 'posted' AND e.created_at < now() AND e.updated_at = now() THEN l.credit - l.debit ELSE 0 END), 2) s
        FROM public.journal_entries e JOIN public.journal_entry_lines l ON l.entry_id = e.id JOIN public.chart_of_accounts c ON c.id = l.account_id
       WHERE e.tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71' AND (e.created_at = now() OR e.updated_at = now())
         AND c.code IN ('1100', '1110', '1200', '2150', '4100', '4200')
       GROUP BY 1) g WHERE s <> 0;
  $f$;
  CREATE OR REPLACE FUNCTION pg_temp.pic(p_inv uuid, p_contact uuid) RETURNS jsonb LANGUAGE sql AS $f$
    SELECT jsonb_build_object(
      'stock', (SELECT jsonb_object_agg(p.id, p.quantity) FROM public.products p WHERE p.id IN (SELECT product_id FROM public.invoice_items WHERE invoice_id = p_inv)),
      'till', (SELECT (to_jsonb(w))->'cash_balance' FROM public.get_branch_wallet_balances('7a9f9e1b-d6ae-47c0-9965-bf23d0d31213') w),
      'contact', (SELECT round(ledger_balance, 2) FROM public.v_contact_balances WHERE contact_id = p_contact),
      'gl', pg_temp.gl());
  $f$;

  -- A) credit
  s0 := pg_temp.pic(a_inv, (SELECT contact_id FROM public.invoices WHERE id = a_inv));
  PERFORM public.cancel_invoice_with_refund(a_inv, 'تجربة 0142', 'credit', 'cash');
  ra := public.restore_cancelled_invoice(a_inv, '{}'::jsonb);
  s1 := pg_temp.pic(a_inv, (SELECT contact_id FROM public.invoices WHERE id = a_inv));
  INSERT INTO t0142 VALUES ('A_same', to_jsonb(s0 = s1)), ('A_status', to_jsonb((SELECT status::text FROM public.invoices WHERE id = a_inv)));
  IF s0 <> s1 THEN INSERT INTO t0142 VALUES ('A_before', s0), ('A_after', s1); END IF;

  -- B) cash refund, collected again
  s0 := pg_temp.pic(b_inv, (SELECT contact_id FROM public.invoices WHERE id = b_inv));
  PERFORM public.cancel_invoice_with_refund(b_inv, 'تجربة 0142', 'cash', 'cash');
  BEGIN PERFORM public.restore_cancelled_invoice(b_inv, '{}'::jsonb); rb_refused := 'allowed'; EXCEPTION WHEN OTHERS THEN rb_refused := SQLERRM; END;
  rb := public.restore_cancelled_invoice(b_inv, jsonb_build_object('action', 'collect', 'method', 'cash'));
  s1 := pg_temp.pic(b_inv, (SELECT contact_id FROM public.invoices WHERE id = b_inv));
  INSERT INTO t0142 VALUES ('B_refused_without_answer', to_jsonb(rb_refused)), ('B_same', to_jsonb(s0 = s1)), ('B_res', rb);
  IF s0 <> s1 THEN INSERT INTO t0142 VALUES ('B_before', s0), ('B_after', s1); END IF;

  -- C) void, stays on the customer
  s0 := pg_temp.pic(c_inv, (SELECT contact_id FROM public.invoices WHERE id = c_inv));
  PERFORM public.cancel_invoice_with_refund(c_inv, 'تجربة 0142', 'void', 'cash');
  rc := public.restore_cancelled_invoice(c_inv, jsonb_build_object('action', 'debt'));
  s1 := pg_temp.pic(c_inv, (SELECT contact_id FROM public.invoices WHERE id = c_inv));
  INSERT INTO t0142 VALUES ('C_stock_same', to_jsonb(s0->'stock' = s1->'stock')),
    ('C_contact_owes_more_1285', to_jsonb(round((s1->>'contact')::numeric - (s0->>'contact')::numeric, 2))),
    ('C_till_cash_change_m1285', to_jsonb(round((s1->>'till')::numeric - (s0->>'till')::numeric, 2))),
    ('C_books_cash_m1285', to_jsonb(round(coalesce((s1->'gl'->>'1100')::numeric, 0) - coalesce((s0->'gl'->>'1100')::numeric, 0), 2))),
    ('C_books_customers_p1285', to_jsonb(round(coalesce((s1->'gl'->>'1200')::numeric, 0) + coalesce((s1->'gl'->>'2150')::numeric, 0)
                                             - coalesce((s0->'gl'->>'1200')::numeric, 0) - coalesce((s0->'gl'->>'2150')::numeric, 0), 2)));

  -- D) a hand-written voucher
  s0 := pg_temp.pic(NULL, (SELECT party_id FROM public.vouchers WHERE id = d_v));
  PERFORM public.cancel_voucher(d_v, 'تجربة 0142');
  rd := public.restore_cancelled_voucher(d_v);
  s1 := pg_temp.pic(NULL, (SELECT party_id FROM public.vouchers WHERE id = d_v));
  INSERT INTO t0142 VALUES ('D_same', to_jsonb(s0 = s1)), ('D_status', to_jsonb((SELECT status::text FROM public.vouchers WHERE id = d_v))), ('D_res', rd);
  IF s0 <> s1 THEN INSERT INTO t0142 VALUES ('D_before', s0), ('D_after', s1); END IF;

  -- E) the manager: direct refused, request → owner approves
  PERFORM public.cancel_voucher(d_v, 'تجربة 0142 (E)');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.restore_cancelled_voucher(d_v); re_direct := 'allowed'; EXCEPTION WHEN OTHERS THEN re_direct := SQLERRM; END;
  x := public.request_document_edit('voucher', d_v, 'استرجاع سند RV-3227',
         jsonb_build_object('rpc', 'restore_voucher', 'args', jsonb_build_object('p_voucher_id', d_v), 'diff', jsonb_build_array('الحالة: ملغي ← شغال')), 'اتلغى بالغلط');
  re_mode := x->>'mode'; v_req := (x->>'request_id')::uuid;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  UPDATE public.approval_requests SET status = 'approved', admin_id = v_owner WHERE id = v_req;
  SELECT status::text INTO re_status FROM public.vouchers WHERE id = d_v;
  INSERT INTO t0142 VALUES ('E_direct_refused', to_jsonb(re_direct)), ('E_mode', to_jsonb(re_mode)), ('E_status_after_approval', to_jsonb(re_status));

  FOR r IN SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' LOOP
    IF (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS DISTINCT FROM r.last_value::text
       AND (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS NOT NULL THEN
      PERFORM setval(format('%I.%I', r.schemaname, r.sequencename), (v_seq ->> (r.schemaname || '.' || r.sequencename))::bigint);
    END IF;
  END LOOP;
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq_after FROM pg_sequences WHERE schemaname = 'public';
  INSERT INTO t0142 VALUES ('seq_same', to_jsonb(v_seq = v_seq_after));

  RAISE EXCEPTION '0142 CHECKS %', (SELECT jsonb_object_agg(k, v) FROM t0142);
END
$t$;
