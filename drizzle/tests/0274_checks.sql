-- 0274 checks (rollback-only, sequences put back, ends with RAISE).
DO $t$
DECLARE
  T uuid := '5316fbfe-b862-4c91-b48b-1d81c8aa5a71'; OWNER uuid := '85c76e60-3d27-4a99-8cd7-c8f8b39d914a';
  B uuid := '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213'; P uuid := '5de8b289-bdd4-4374-943f-69317950417b'; SUP uuid := '3e3dd0ca-ff77-4592-affc-2e9a83a3d857';
  seq jsonb; out text := ''; fails int := 0; r jsonb; r2 jsonb; si uuid; c0 numeric; c1 numeric; sb numeric; n0 int; n1 int;
  hdr jsonb := jsonb_build_object('branch_id', '7a9f9e1b-d6ae-47c0-9965-bf23d0d31213', 'contact_id', '3e3dd0ca-ff77-4592-affc-2e9a83a3d857', 'received_by', 'فحص',
                                  'discount_type', 'amount', 'discount_value', 0, 'vat_type', 'none', 'vat_value', 0);
  ln jsonb := jsonb_build_array(jsonb_build_object('product_id', '5de8b289-bdd4-4374-943f-69317950417b', 'product_name', 'x', 'quantity', 2, 'cost_price', 2000));
BEGIN
  SELECT jsonb_object_agg(sequencename, last_value) INTO seq FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', OWNER, 'role', 'authenticated')::text, true);
  SET CONSTRAINTS ALL IMMEDIATE;

  -- 1) supplier fully paid, return «على حسابه» → drawer unchanged, he owes us 2,000
  BEGIN
    r := public.record_shipment_with_credit(hdr, ln, jsonb_build_object('plan_type', 'open', 'paid_now', 0));
    si := (r->>'shipment_id')::uuid;
    PERFORM public.create_manual_voucher(B, 'payment', '66aae265-ab5c-4d79-b74e-682f7717dae5', 4000, 'cash', NULL, NULL, 0, 'supplier', SUP, NULL, 'فحص', public.cairo_today(), NULL);
    SELECT cash_balance INTO c0 FROM public.get_branch_wallet_balances(B);
    r2 := public.create_purchase_return(jsonb_build_object('shipment_id', si, 'reason', 'فحص', 'refund_method', 'balance', 'refund_balance_amount', 2000, 'refund_cash_amount', 0, 'refund_transfer_amount', 0),
          jsonb_build_array(jsonb_build_object('shipment_item_id', (SELECT id FROM shipment_items WHERE shipment_id = si LIMIT 1), 'quantity', 1)));
    SELECT cash_balance INTO c1 FROM public.get_branch_wallet_balances(B);
    PERFORM set_config('ledger.done', '', true); PERFORM public.ledger_sync_safe(SUP, NULL, 't');
    SELECT supplier_balance INTO sb FROM public.contact_side_balances(ARRAY[SUP], B);
    IF (r2->>'refund_balance_amount')::numeric = 2000 AND c1 = c0 AND sb = -2000 THEN out := out || E'\nPASS 1 مورد متسدد + «على حسابه» → الدرج ثابت والمورد مدين لنا 2,000';
    ELSE fails := fails + 1; out := out || format(E'\nFAIL 1 split=%s cash %s→%s supplier=%s', r2, c0, c1, sb); END IF;
  EXCEPTION WHEN OTHERS THEN fails := fails + 1; out := out || E'\nFAIL 1: ' || SQLERRM; END;

  -- 2) we still owe him, he hands back 2,000 cash → drawer +2,000, his balance stays 4,000
  BEGIN
    r := public.record_shipment_with_credit(hdr, ln, jsonb_build_object('plan_type', 'open', 'paid_now', 0));
    si := (r->>'shipment_id')::uuid;
    PERFORM set_config('ledger.done', '', true); PERFORM public.ledger_sync_safe(SUP, NULL, 't');
    SELECT supplier_balance INTO sb FROM public.contact_side_balances(ARRAY[SUP], B);
    SELECT cash_balance INTO c0 FROM public.get_branch_wallet_balances(B);
    r2 := public.create_purchase_return(jsonb_build_object('shipment_id', si, 'reason', 'فحص', 'refund_method', 'cash', 'refund_balance_amount', 0, 'refund_cash_amount', 2000, 'refund_transfer_amount', 0),
          jsonb_build_array(jsonb_build_object('shipment_item_id', (SELECT id FROM shipment_items WHERE shipment_id = si LIMIT 1), 'quantity', 1)));
    SELECT cash_balance INTO c1 FROM public.get_branch_wallet_balances(B);
    PERFORM set_config('ledger.done', '', true); PERFORM public.ledger_sync_safe(SUP, NULL, 't');
    IF (r2->>'refund_cash_amount')::numeric = 2000 AND c1 = c0 + 2000
       AND (SELECT supplier_balance FROM public.contact_side_balances(ARRAY[SUP], B)) = sb
    THEN out := out || E'\nPASS 2 لسه علينا للمورد + «كاش» → الدرج +2,000 وحسابه زي ما هو';
    ELSE fails := fails + 1; out := out || format(E'\nFAIL 2 split=%s cash %s→%s', r2, c0, c1); END IF;
  EXCEPTION WHEN OTHERS THEN fails := fails + 1; out := out || E'\nFAIL 2: ' || SQLERRM; END;

  -- 3) purchase + 1,000 cash in ONE call
  BEGIN
    SELECT cash_balance INTO c0 FROM public.get_branch_wallet_balances(B);
    r := public.record_shipment_with_credit(hdr, ln, jsonb_build_object('plan_type', 'open', 'paid_now', 1000,
           'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000))));
    SELECT cash_balance INTO c1 FROM public.get_branch_wallet_balances(B);
    IF (r->>'paid_with_invoice')::numeric = 1000 AND c1 = c0 - 1000
       AND (SELECT paid_amount FROM payment_plans WHERE id = (r->>'payment_plan_id')::uuid) = 1000
    THEN out := out || E'\nPASS 3 فاتورة شراء ودفع 1,000 كاش في خطوة واحدة';
    ELSE fails := fails + 1; out := out || format(E'\nFAIL 3 %s cash %s→%s', r, c0, c1); END IF;
  EXCEPTION WHEN OTHERS THEN fails := fails + 1; out := out || E'\nFAIL 3: ' || SQLERRM; END;

  -- 4) a payment that can't go through → nothing saved, not even the invoice
  BEGIN
    SELECT count(*) INTO n0 FROM shipments WHERE branch_id = B;
    BEGIN
      PERFORM public.record_shipment_with_credit(hdr, ln, jsonb_build_object('plan_type', 'open', 'paid_now', 3999,
               'payments', jsonb_build_array(jsonb_build_object('method', 'instapay', 'amount', 3999))));
      out := out || E'\nFAIL 4 accepted';
      fails := fails + 1;
    EXCEPTION WHEN OTHERS THEN
      SELECT count(*) INTO n1 FROM shipments WHERE branch_id = B;
      IF n1 = n0 THEN out := out || E'\nPASS 4 الدفع اترفض («' || left(SQLERRM, 60) || '») → الفاتورة نفسها ماتحفظتش';
      ELSE fails := fails + 1; out := out || E'\nFAIL 4 invoice kept'; END IF;
    END;
  END;

  -- 5) paying more than the invoice is refused
  BEGIN
    PERFORM public.record_shipment_with_credit(hdr, ln, jsonb_build_object('plan_type', 'open', 'paid_now', 5000,
             'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 5000))));
    fails := fails + 1; out := out || E'\nFAIL 5 overpay accepted';
  EXCEPTION WHEN OTHERS THEN out := out || E'\nPASS 5 دفع أكبر من الفاتورة اترفض'; END;

  -- 6) the opening check follows merges: no «ledger_differs» left
  IF NOT EXISTS (SELECT 1 FROM public.opening_balances_reconciliation() x WHERE x.status = 'ledger_differs')
  THEN out := out || E'\nPASS 6 مطابقة الافتتاحي: «البيت (الحاج ناصر)» والحساب المدموج مابقوش يظهروا';
  ELSE fails := fails + 1; out := out || E'\nFAIL 6 still differs'; END IF;

  PERFORM setval('public.' || k, (seq->>k)::bigint, true) FROM jsonb_object_keys(seq) k;
  RAISE EXCEPTION E'CHECKS 0274 fails=% %', fails, out;
END $t$;
