-- 0142: «استرجاع من الملغاة» — a cancelled sale invoice or voucher comes back as if it was never cancelled
-- (owner «نفذ», 2026-10-30)
--
-- Owner only. Anybody else with the document's permission sends a «طلب موافقة» through request_document_edit
-- (rpc 'restore_invoice' / 'restore_voucher'); the owner approves and it runs under his name.
--
-- Sale invoice (2026 only): same number, same day. The pieces that came back on the cancellation go out of stock again
-- (negative stock is accepted — owner rule), the sale and its cost of goods are posted again on the invoice day, the
-- payment plan and its open installments come back. Money:
--   * cancelled with «لحسابه» (credit) or with nothing paid: the money never left — the ledger puts it back on the
--     invoice by itself.
--   * cancelled with «رد فلوس» (cash) or «غلط ومفيش فلوس» (void): the money is gone, so the owner is asked every time
--     (p_money.action): 'debt' = it stays on the customer, 'collect' = he pays it again now.
--     cash refund: the till row of the refund is mirrored (the ledger stops counting it once the invoice is active) —
--     collect = mirrored today (the money came back), debt = mirrored on its own day + a refund voucher to the
--     customer on that day (the till of that day does not move, the customer owes it).
--     void: collect = add_invoice_payment today from p_money.method; debt = the invoice stays open.
--   Example: IN05064 (20,800) cancelled on 22/10 with 20,800 given back in cash → restore with «يدفع تاني دلوقتي نقدي»
--   → IN05064 active again on 22/10, stock −1 «تكييف», a payment of 20,800 today.
-- Voucher (written by hand — not the automatic voucher of an invoice / return / purchase): same number, same day, the
-- till gets the money again (a row «استرجاع سند» mirroring the cancellation row, on the original day), the books
-- are posted again.

CREATE OR REPLACE FUNCTION public.restore_cancelled_invoice(p_invoice_id uuid, p_money jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.invoices%ROWTYPE; it record; bc jsonb; v_net numeric; v_plan uuid; v_act text := coalesce(p_money->>'action', '');
  v_amount numeric; v_pay uuid; v_lines int := 0; v_gone numeric := 0; v_refund_method text; t public.treasury%ROWTYPE;
  v_cat uuid; v_voucher uuid;
BEGIN
  IF NOT public.doc_edit_is_direct() THEN RAISE EXCEPTION 'الاسترجاع من الملغاة للمالك بس — ابعت طلب' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  PERFORM public.assert_access(v.branch_id, NULL);
  IF v.status <> 'cancelled' THEN RAISE EXCEPTION 'الفاتورة مش ملغاة'; END IF;
  IF public.ledger_invoice_is_archive(v.invoice_date, v.created_at, v.is_migrated, v.migration_batch_id) THEN
    RAISE EXCEPTION 'فاتورة قبل 2026 مش بترجع من الملغاة';
  END IF;

  -- the money that left at the cancellation: the owner answers every time
  v_refund_method := coalesce(v.refund_method, 'none');
  IF v_refund_method IN ('cash', 'void') THEN
    v_gone := CASE WHEN v.refund_method = 'cash' THEN coalesce(v.refund_amount, 0) ELSE coalesce(v.total_paid_before_cancel, 0) END;
  END IF;
  IF v_gone > 0.005 AND v_act NOT IN ('debt', 'collect') THEN
    RAISE EXCEPTION 'الفاتورة اتلغت ورجع فيها % — العميل هيدفعهم تاني دلوقتي ولا يفضلوا عليه؟', round(v_gone, 2);
  END IF;

  -- the document is back (its own day; the cancellation stays in the history / audit)
  UPDATE public.invoices
     SET status = 'active', cancel_reason = NULL, cancelled_by = NULL, cancelled_at = NULL,
         refund_method = NULL, refund_amount = 0, refund_pay_method = NULL, refund_processed_by = NULL,
         refund_processed_at = NULL, total_paid_before_cancel = 0
   WHERE id = v.id;

  -- what came back on the cancellation goes out again (same rule as restore_invoice_batches, the other way)
  FOR it IN SELECT * FROM public.invoice_items WHERE invoice_id = v.id LOOP
    v_net := greatest(coalesce(it.quantity, 0) - coalesce(it.returned_quantity, 0), 0);
    CONTINUE WHEN v_net <= 0 OR it.product_id IS NULL;
    IF it.batches_consumed IS NOT NULL AND jsonb_typeof(it.batches_consumed) = 'array' THEN
      FOR bc IN SELECT value FROM jsonb_array_elements(it.batches_consumed) LOOP
        UPDATE public.product_batches
           SET quantity_remaining = greatest(quantity_remaining - round(coalesce((bc->>'qty_taken')::numeric, 0) * v_net / it.quantity, 4), 0)
         WHERE id = nullif(bc->>'batch_id', '')::uuid;
      END LOOP;
    END IF;
    PERFORM public.stock_mv_ctx('sale', 'invoice', v.id, it.product_id, v.invoice_date);
    UPDATE public.products SET quantity = quantity - v_net WHERE id = it.product_id;
    v_lines := v_lines + 1;
  END LOOP;

  -- the books: the sale again on its day (cost of goods follows: trg_invoice_status_cogs / repost)
  PERFORM public.repost_invoice_journal(v.id);

  -- the payment plan and the installments the cancellation closed
  SELECT id INTO v_plan FROM public.payment_plans WHERE reference_type = 'invoice' AND reference_id = v.id LIMIT 1;
  IF v_plan IS NOT NULL THEN
    UPDATE public.payment_installments SET status = 'pending', cancelled_at = NULL, cancelled_by = NULL, adjustment_reason = NULL
     WHERE payment_plan_id = v_plan AND status = 'cancelled' AND adjustment_reason = 'تم إلغاء الفاتورة';
    UPDATE public.payment_plans SET status = 'active' WHERE id = v_plan AND status = 'cancelled';
    BEGIN PERFORM public.redistribute_installments_after_return(v.id); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- the money that left at the cancellation
  IF v_refund_method = 'cash' AND v_gone > 0.005 THEN
    -- the cash given back: the ledger stops counting it once the invoice is active again, so the till row is mirrored
    -- (collect: the customer brings it back today; debt: on the day it left, and he owes it by a refund voucher)
    SELECT * INTO t FROM public.treasury WHERE reference_id = v.id AND category = 'sales_refund' AND type = 'expense'
     ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'مش لاقي حركة رد الفلوس بتاعة الفاتورة في الخزنة'; END IF;
    IF v_act = 'debt' AND v.contact_id IS NULL THEN
      RAISE EXCEPTION 'مفيش عميل على الفاتورة — الفلوس لازم ترجع (اختار «يدفع تاني دلوقتي»)';
    END IF;
    PERFORM set_config('app.skip_treasury_voucher', '1', true);
    PERFORM set_config('app.contact_money', CASE WHEN v.contact_id IS NOT NULL THEN '1' ELSE '' END, true);
    INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by,
                                 payment_method, transaction_date, created_at)
    VALUES (t.branch_id, t.tenant_id, 'income', 'sales_refund_back', t.amount,
            'رجوع مبلغ رد الفاتورة ' || v.invoice_number || CASE WHEN v_act = 'collect' THEN ' — العميل رجّعه' ELSE ' (بتاريخ الرد)' END,
            v.id, auth.uid(), t.payment_method,
            CASE WHEN v_act = 'collect' THEN public.cairo_today() ELSE t.transaction_date END,
            CASE WHEN v_act = 'collect' THEN now() ELSE t.created_at + interval '1 second' END);
    PERFORM set_config('app.contact_money', '', true);
    PERFORM set_config('app.skip_treasury_voucher', '0', true);
    IF v_act = 'debt' THEN
      SELECT id INTO v_cat FROM public.voucher_categories
       WHERE tenant_id = v.tenant_id AND type = 'payment' AND coalesce(is_active, true) AND system_key IN ('customer_return', 'other_payment')
       ORDER BY (system_key = 'customer_return') DESC LIMIT 1;
      v_voucher := public.create_manual_voucher(v.branch_id, 'payment', v_cat, t.amount, t.payment_method, NULL, NULL, 0,
        'customer', v.contact_id, (SELECT name FROM public.contacts WHERE id = v.contact_id),
        'فلوس رد الفاتورة ' || v.invoice_number || ' — فضلت مع العميل بعد استرجاع الفاتورة', t.transaction_date, NULL);
    END IF;
  ELSIF v_act = 'collect' AND v_gone > 0.005 THEN
    -- the payments were voided: he pays again now, on the invoice
    v_amount := round(coalesce(nullif(p_money->>'amount', '')::numeric, v_gone), 2);
    v_pay := public.add_invoice_payment(v.id, coalesce(nullif(p_money->>'method', ''), 'cash'), v_amount,
                                        nullif(p_money->>'reference', ''), NULL, NULL, 0, false, NULL);
  END IF;

  -- the customer's ledger and its books follow now (not only at commit)
  IF v.contact_id IS NOT NULL THEN
    PERFORM public.ledger_refresh_contact(v.contact_id);
    PERFORM public.ledger_gl_sync(v.tenant_id, v.contact_id, NULL);
  END IF;

  INSERT INTO public.audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (auth.uid(), coalesce((SELECT name FROM public.profiles WHERE id = auth.uid()), '?'), v.tenant_id, v.branch_id, 'RESTORE', 'invoice', v.id::text,
          jsonb_build_object('invoice_number', v.invoice_number, 'cancel_reason', v.cancel_reason, 'refund_method', v.refund_method,
                             'money_left', v_gone, 'money_action', nullif(v_act, ''), 'payment_id', v_pay, 'refund_voucher', v_voucher));
  RETURN jsonb_build_object('invoice_number', v.invoice_number, 'lines_out', v_lines, 'money_left', v_gone,
                            'money_action', nullif(v_act, ''), 'payment_id', v_pay, 'refund_voucher', v_voucher);
END $function$;
REVOKE ALL ON FUNCTION public.restore_cancelled_invoice(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_cancelled_invoice(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.restore_cancelled_voucher(p_voucher_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v public.vouchers%ROWTYPE; r public.treasury%ROWTYPE; n int := 0;
BEGIN
  IF NOT public.doc_edit_is_direct() THEN RAISE EXCEPTION 'الاسترجاع من الملغاة للمالك بس — ابعت طلب' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'السند غير موجود'; END IF;
  PERFORM public.assert_access(v.branch_id, NULL);
  IF v.status <> 'cancelled' THEN RAISE EXCEPTION 'السند مش ملغي'; END IF;
  IF v.source_type IS NOT NULL THEN
    RAISE EXCEPTION 'السند ده اتعمل لوحده من مستند (فاتورة / مرتجع / شراء) — رجّع المستند نفسه';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.treasury t WHERE t.reference_id = v.id AND t.category = 'إلغاء سند') THEN
    RAISE EXCEPTION 'مش لاقي حركة الإلغاء بتاعة السند ده في الخزنة';
  END IF;

  -- the till: each cancellation row gets its mirror on the same day (the cancellation stays in the history)
  PERFORM set_config('app.skip_treasury_voucher', '1', true);
  PERFORM set_config('app.voucher_cancel_reversal', '1', true);
  FOR r IN SELECT * FROM public.treasury t WHERE t.reference_id = v.id AND t.category = 'إلغاء سند' ORDER BY t.created_at LOOP
    INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by,
                                 payment_method, reference_number, is_fee, transaction_date, created_at)
    VALUES (r.branch_id, r.tenant_id, CASE WHEN r.type = 'income' THEN 'expense'::treasury_type ELSE 'income'::treasury_type END,
            'استرجاع سند', r.amount, 'استرجاع السند ' || coalesce(v.voucher_number, '') || ' من الملغاة (بتاريخه الأصلي)',
            v.id, auth.uid(), r.payment_method, r.reference_number, coalesce(r.is_fee, false), r.transaction_date, now());
    n := n + 1;
  END LOOP;
  PERFORM set_config('app.voucher_cancel_reversal', '0', true);
  PERFORM set_config('app.skip_treasury_voucher', '0', true);

  UPDATE public.vouchers SET status = 'active', cancelled_by = NULL, cancelled_at = NULL, cancel_reason = NULL WHERE id = v.id;
  PERFORM public.post_voucher_journal(v.id);
  IF v.party_id IS NOT NULL THEN
    PERFORM public.ledger_refresh_contact(v.party_id);
    PERFORM public.ledger_gl_sync(v.tenant_id, v.party_id, NULL);
  END IF;

  INSERT INTO public.audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (auth.uid(), coalesce((SELECT name FROM public.profiles WHERE id = auth.uid()), '?'), v.tenant_id, v.branch_id, 'RESTORE', 'voucher', v.id::text,
          jsonb_build_object('voucher_number', v.voucher_number, 'cancel_reason', v.cancel_reason, 'till_rows', n));
  RETURN jsonb_build_object('voucher_number', v.voucher_number, 'till_rows', n);
END $function$;
REVOKE ALL ON FUNCTION public.restore_cancelled_voucher(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_cancelled_voucher(uuid) TO service_role;

-- one door: apply_document_edit knows the two restores; request_document_edit lets them through for the document type
DO $mig$
DECLARE d text := pg_get_functiondef('public.apply_document_edit(jsonb)'::regprocedure);
  o text := $o$    ELSE
      RAISE EXCEPTION 'نوع التعديل غير معروف: %', coalesce(v_rpc, '—');$o$;
  n text := $n$    WHEN 'restore_invoice' THEN
      -- 0142: back from «الملغاة»
      v_res := public.restore_cancelled_invoice((a->>'p_invoice_id')::uuid, coalesce(a->'p_money', '{}'::jsonb));
    WHEN 'restore_voucher' THEN
      v_res := public.restore_cancelled_voucher((a->>'p_voucher_id')::uuid);
    ELSE
      RAISE EXCEPTION 'نوع التعديل غير معروف: %', coalesce(v_rpc, '—');$n$;
BEGIN
  IF position('restore_invoice' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0142: apply_document_edit not the expected version'; END IF;
  EXECUTE replace(d, o, n);
END
$mig$;

DO $mig$
DECLARE d text := pg_get_functiondef('public.request_document_edit(text,uuid,text,jsonb,text)'::regprocedure);
BEGIN
  IF position('restore_invoice' IN d) > 0 THEN RETURN; END IF;
  d := replace(d, $o$v_allowed := ARRAY['edit_invoice', 'update_invoice_date_sovereign'];$o$,
                  $n$v_allowed := ARRAY['edit_invoice', 'update_invoice_date_sovereign', 'restore_invoice'];$n$);
  d := replace(d, $o$v_allowed := ARRAY['edit_voucher'];$o$, $n$v_allowed := ARRAY['edit_voucher', 'restore_voucher'];$n$);
  IF position('restore_invoice' IN d) = 0 OR position('restore_voucher' IN d) = 0 THEN
    RAISE EXCEPTION '0142: request_document_edit not the expected version';
  END IF;
  EXECUTE d;
END
$mig$;
