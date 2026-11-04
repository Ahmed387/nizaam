-- 0149 checks — rollback-only (ends with RAISE). Run after migration 0149 (or with its text pasted above for a dry-run).
-- PO00578 (purchase 200 paid on 18/2, عبدالمنعم), cancelled «المورد رجّع» 200 cash, then restored with each answer:
--  K) «تفضل معانا وتبقى علينا» → stock as before; the till +200 (his money stays); his account: we owe 200 more;
--     books: 1100 +200 and 2100 / 1460 −200 against the picture before the cancellation; the refund movement is the same one
--  K2) a second «المورد رجّع» on it is refused while the kept 200 is on it
--  K3) we pay him 200 (an ordinary supplier payment) → his account and the till back to the picture before
--  P) «النهارده» and «كأن الاسترداد ماحصلش» still give the same picture as before the cancellation (0146)
DO $t$
DECLARE v_owner uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  d_po uuid := '7ece995b-319d-4859-85ff-21640cbb1942';
  s0 jsonb; s1 jsonb; x jsonb; o jsonb := '{}'; v_err text; v_seq jsonb; r record; v_mv0 uuid; v_mv1 uuid; v_cat uuid;
BEGIN
  SELECT jsonb_object_agg(schemaname || '.' || sequencename, last_value) INTO v_seq FROM pg_sequences WHERE schemaname = 'public';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET CONSTRAINTS ALL IMMEDIATE;
  CREATE OR REPLACE FUNCTION pg_temp.gl(p_day date) RETURNS jsonb LANGUAGE sql AS $f$
    SELECT coalesce(jsonb_object_agg(code, s), '{}') FROM (
      SELECT c.code, round(sum(l.debit - l.credit), 2) s
        FROM public.journal_entries e JOIN public.journal_entry_lines l ON l.entry_id = e.id JOIN public.chart_of_accounts c ON c.id = l.account_id
       WHERE e.tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71' AND e.status = 'posted' AND e.entry_date IN (p_day, public.cairo_today())
         AND c.code IN ('1100', '1300', '1460', '2100')
       GROUP BY 1) g WHERE s <> 0;
  $f$;
  CREATE OR REPLACE FUNCTION pg_temp.pic(p_branch uuid, p_products uuid[], p_contact uuid, p_day date) RETURNS jsonb LANGUAGE sql AS $f$
    SELECT jsonb_build_object(
      'stock', (SELECT jsonb_object_agg(p.id, p.quantity) FROM public.products p WHERE p.id = ANY (p_products)),
      'till', (SELECT round(coalesce(sum(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0), 2) FROM public.treasury
                WHERE branch_id = p_branch AND coalesce(payment_method, 'cash') = 'cash'),
      'supplier', (SELECT round(balance, 2) FROM public.ledger_side_balances('5316fbfe-b862-4c91-b48b-1d81c8aa5a71', NULL, p_contact) WHERE side = 'supplier'),
      'gl', pg_temp.gl(p_day));
  $f$;
  SELECT jsonb_build_object('b', branch_id, 'p', (SELECT array_agg(product_id) FROM public.shipment_items WHERE shipment_id = s.id), 'c', contact_id,
                            'd', public.ledger_day(invoice_date)) INTO x FROM public.shipments s WHERE id = d_po;
  s0 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);

  -- P) «النهارده» / «كأن الاسترداد ماحصلش» still give the picture before the cancellation (each rolled back)
  BEGIN
    PERFORM public.cancel_purchase_invoice(d_po, 'تجربة 0149 (P)', 'refund', 'cash');
    PERFORM public.restore_cancelled_shipment(d_po, '{"action":"pay"}');
    s1 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
    o := o || jsonb_build_object('P_pay_till_change', round((s1->>'till')::numeric - (s0->>'till')::numeric, 2),
      'P_pay_supplier_change', round((s1->>'supplier')::numeric - (s0->>'supplier')::numeric, 2), 'P_pay_gl', s1->'gl');
    RAISE EXCEPTION 'rollback_p';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'rollback_p' THEN o := o || jsonb_build_object('P_pay_err', SQLERRM); END IF; END;
  BEGIN
    PERFORM public.cancel_purchase_invoice(d_po, 'تجربة 0149 (P2)', 'refund', 'cash');
    PERFORM public.restore_cancelled_shipment(d_po, '{"action":"as_before"}');
    s1 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
    o := o || jsonb_build_object('P_asb_till_change', round((s1->>'till')::numeric - (s0->>'till')::numeric, 2),
      'P_asb_supplier_change', round((s1->>'supplier')::numeric - (s0->>'supplier')::numeric, 2), 'P_asb_gl', s1->'gl');
    RAISE EXCEPTION 'rollback_p';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'rollback_p' THEN o := o || jsonb_build_object('P_asb_err', SQLERRM); END IF; END;

  -- K) keep
  PERFORM public.cancel_purchase_invoice(d_po, 'تجربة 0149', 'refund', 'cash');
  SELECT id INTO v_mv0 FROM public.money_movements WHERE source_table = 'shipments' AND source_id = d_po AND kind = 'refund' AND status = 'active';
  BEGIN PERFORM public.restore_cancelled_shipment(d_po, '{}'::jsonb); v_err := 'allowed'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  o := o || jsonb_build_object('K_asks_3', v_err, 'K_res', public.restore_cancelled_shipment(d_po, '{"action":"keep"}'));
  SELECT id INTO v_mv1 FROM public.money_movements WHERE source_table = 'shipments' AND source_id = d_po AND kind = 'refund' AND status = 'active';
  s1 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
  o := o || jsonb_build_object('K_stock_same', s0->'stock' = s1->'stock',
    'K_till_change_p200', round((s1->>'till')::numeric - (s0->>'till')::numeric, 2),
    'K_we_owe_change_p200', round((s1->>'supplier')::numeric - (s0->>'supplier')::numeric, 2),
    'K_gl_before', s0->'gl', 'K_gl_after', s1->'gl',
    'K_same_movement', v_mv0 IS NOT NULL AND v_mv0 = v_mv1,
    'K_status', (SELECT status FROM public.shipments WHERE id = d_po));

  -- K2) a second «المورد رجّع» is refused
  BEGIN PERFORM public.cancel_purchase_invoice(d_po, 'تجربة 0149 (K2)', 'refund', 'cash'); v_err := 'allowed'; EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  o := o || jsonb_build_object('K2_refused', v_err);

  -- K3) we pay him the 200 → back to the picture before
  SELECT id INTO v_cat FROM public.voucher_categories WHERE tenant_id = '5316fbfe-b862-4c91-b48b-1d81c8aa5a71' AND system_key = 'supplier_payment' LIMIT 1;
  PERFORM public.create_manual_voucher((x->>'b')::uuid, 'payment', v_cat, 200, 'cash', NULL, NULL, 0, 'supplier', (x->>'c')::uuid,
            (SELECT name FROM public.contacts WHERE id = (x->>'c')::uuid), 'تجربة 0149 — دفع الـ 200', public.cairo_today(), NULL);
  PERFORM public.ledger_refresh_contact((x->>'c')::uuid);
  s1 := pg_temp.pic((x->>'b')::uuid, ARRAY(SELECT jsonb_array_elements_text(x->'p'))::uuid[], (x->>'c')::uuid, (x->>'d')::date);
  o := o || jsonb_build_object('K3_till_same', s0->'till' = s1->'till', 'K3_supplier_same', s0->'supplier' = s1->'supplier');

  FOR r IN SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' LOOP
    IF (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS DISTINCT FROM r.last_value::text AND (v_seq ->> (r.schemaname || '.' || r.sequencename)) IS NOT NULL THEN
      PERFORM setval(format('%I.%I', r.schemaname, r.sequencename), (v_seq ->> (r.schemaname || '.' || r.sequencename))::bigint);
    END IF;
  END LOOP;
  RAISE EXCEPTION '0149 CHECKS %', o;
END
$t$;
