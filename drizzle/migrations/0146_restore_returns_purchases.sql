-- 0146: «استرجاع من الملغاة» for sale returns, purchase returns and purchase invoices (owner «3-كمل», 2026-11-04)
-- Same rule as 0142: same number, same day, as if the cancellation never happened. Owner only; anybody else with the
-- document's permission sends it through request_document_edit (rpc restore_sale_return / restore_purchase_return /
-- restore_shipment) and the owner approves.
--
-- Sale return (2026, its invoice active): the pieces come back into stock again, the invoice lines count them as returned
-- again, the books of the return are posted again (trg_returns_journal on the status), the on-account part is the
-- customer's credit again (ledger), and the money the cancellation put back in the till («return_cancel», on the
-- return's day) is cancelled on that same day — the till of that day is what it was before the cancellation.
--   Example: SR00072 (3,400 cash, 9/10) cancelled → restored → stock −1 again… +1 again, till of 9/10 −3,400 again.
-- Purchase return: the pieces go out of stock again (from the same batch), its books / the supplier's credit come back,
-- the «purchase_return_cancel» till row is cancelled on its day.
-- Purchase invoice (2026): stock and its batches come back in full (the cancellation needed them untouched), the plan and
-- the installments the cancellation closed come back, the reversing entry of the cancellation is reversed on its own day
-- (so the purchase entry counts again and a later cancel reverses it again). Money:
--   * «تحت حسابه» (credit) or nothing paid: the ledger puts the money back on the invoice by itself.
--   * «المورد رجّع فلوسنا» (refund) / «غلط ومفيش فلوس» (void): the money is gone, so the owner answers every time
--     (p_money.action). void: 'debt' = we owe it again, 'pay' = a payment on its plan today (p_money.method).
--     refund: the money goes back to the supplier — 'pay' = today, 'as_before' = on the day he gave it (its till row is
--     mirrored; the ledger counts his refund only while the invoice is cancelled; a supplier receipt is not allowed).
--   Example: PO00578 (200 paid, 18/2) cancelled «المورد رجّع» 200 cash → restore «هترجعهوله النهارده» → active on 18/2,
--   200 out of the till today; supplier, stock and books as before the cancellation.

-- the purchase status guard lets ONE more path change a cancelled invoice: the restore
DO $mig$
DECLARE d text := pg_get_functiondef('public.guard_shipment_status()'::regprocedure);
  o text := $o$  IF OLD.status = 'cancelled' THEN$o$;
BEGIN
  IF position('app.shipment_restore' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0146: guard_shipment_status not the expected version'; END IF;
  EXECUTE replace(d, o, $n$  -- 0146: «استرجاع من الملغاة» (restore_cancelled_shipment) is the only way back
  IF OLD.status = 'cancelled' AND NEW.status = 'active' AND COALESCE(current_setting('app.shipment_restore', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
$n$ || o);
END
$mig$;

CREATE OR REPLACE FUNCTION public.restore_cancelled_sale_return(p_return_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r public.returns%ROWTYPE; it record; ii record; v_left numeric; v_take numeric; v_qty numeric := 0; v_inv record;
  t record; n int := 0;
BEGIN
  IF NOT public.doc_edit_is_direct() THEN RAISE EXCEPTION 'الاسترجاع من الملغاة للمالك بس — ابعت طلب' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المرتجع غير موجود'; END IF;
  PERFORM public.assert_access(r.branch_id, NULL);
  IF coalesce(r.status, 'active') <> 'cancelled' THEN RAISE EXCEPTION 'المرتجع مش ملغي'; END IF;
  IF public.ledger_day(coalesce(r.invoice_date, r.created_at)) < public.ledger_cutoff() THEN RAISE EXCEPTION 'مرتجع قبل 2026 مش بيرجع من الملغاة'; END IF;
  IF r.replaces_return_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.returns x WHERE x.replaces_return_id = r.id) THEN
    RAISE EXCEPTION 'المرتجع ده اتلغى بالتعديل (اتعمل مكانه مرتجع جديد) — عدّل الجديد';
  END IF;
  SELECT id, invoice_number, status, contact_id INTO v_inv FROM public.invoices WHERE id = r.invoice_id;
  IF v_inv.id IS NOT NULL AND v_inv.status <> 'active' THEN
    RAISE EXCEPTION 'الفاتورة % ملغاة — رجّعها الأول', v_inv.invoice_number;
  END IF;

  -- the invoice lines count the pieces as returned again (refused if another return took them meanwhile)
  IF r.invoice_id IS NOT NULL THEN
    FOR it IN SELECT product_id, sum(quantity) AS quantity FROM public.return_items WHERE return_id = r.id AND product_id IS NOT NULL GROUP BY 1 LOOP
      v_left := it.quantity;
      FOR ii IN SELECT id, quantity, coalesce(returned_quantity, 0) AS rq FROM public.invoice_items
                 WHERE invoice_id = r.invoice_id AND product_id = it.product_id AND coalesce(quantity, 0) > coalesce(returned_quantity, 0)
                 ORDER BY id FOR UPDATE LOOP
        EXIT WHEN v_left <= 0;
        v_take := least(ii.quantity - ii.rq, v_left);
        UPDATE public.invoice_items SET returned_quantity = ii.rq + v_take, fully_returned = (ii.rq + v_take >= ii.quantity) WHERE id = ii.id;
        v_left := v_left - v_take;
      END LOOP;
      IF v_left > 0.0001 THEN
        RAISE EXCEPTION 'الكمية دي من الفاتورة % رجعت في مرتجع تاني — مينفعش يرجع المرتجع ده', v_inv.invoice_number;
      END IF;
    END LOOP;
  END IF;

  -- the pieces come back in (the cancellation took them out)
  FOR it IN SELECT product_id, sum(quantity) AS quantity FROM public.return_items WHERE return_id = r.id AND product_id IS NOT NULL GROUP BY 1 LOOP
    PERFORM public.stock_mv_ctx('return_in', 'sale_return', r.id, it.product_id, coalesce(r.invoice_date, r.created_at));
    UPDATE public.products SET quantity = quantity + it.quantity WHERE id = it.product_id;
    v_qty := v_qty + it.quantity;
  END LOOP;

  -- the document is back; its books follow the status (trg_returns_journal)
  UPDATE public.returns SET status = 'active', cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL WHERE id = r.id;

  -- the money the cancellation put back in the till is cancelled on the same (return's) day
  FOR t IN SELECT id FROM public.treasury WHERE reference_id = r.id AND category = 'return_cancel' ORDER BY created_at LOOP
    PERFORM public.till_cancel_on_original_date(t.id, 'استرجاع المرتجع ' || coalesce(r.return_number, '') || ' من الملغاة');
    n := n + 1;
  END LOOP;

  IF v_inv.contact_id IS NOT NULL THEN
    PERFORM public.ledger_refresh_contact(v_inv.contact_id);
    PERFORM public.ledger_gl_sync(r.tenant_id, v_inv.contact_id, NULL);
  END IF;
  INSERT INTO public.audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (auth.uid(), coalesce((SELECT name FROM public.profiles WHERE id = auth.uid()), '?'), r.tenant_id, r.branch_id, 'RESTORE', 'sale_return', r.id::text,
          jsonb_build_object('return_number', r.return_number, 'cancel_reason', r.cancel_reason, 'qty', v_qty, 'till_rows', n));
  RETURN jsonb_build_object('return_number', r.return_number, 'qty_back', v_qty, 'till_rows_cancelled', n);
END $function$;

CREATE OR REPLACE FUNCTION public.restore_cancelled_purchase_return(p_return_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r public.purchase_returns%ROWTYPE; it record; v_batch uuid; v_qty numeric := 0; t record; n int := 0; v_ship text;
BEGIN
  IF NOT public.doc_edit_is_direct() THEN RAISE EXCEPTION 'الاسترجاع من الملغاة للمالك بس — ابعت طلب' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.purchase_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المرتجع غير موجود'; END IF;
  PERFORM public.assert_access(r.branch_id, NULL);
  IF coalesce(r.status, 'active') <> 'cancelled' THEN RAISE EXCEPTION 'المرتجع مش ملغي'; END IF;
  IF public.ledger_day(coalesce(r.invoice_date, r.created_at)) < public.ledger_cutoff() THEN RAISE EXCEPTION 'مرتجع قبل 2026 مش بيرجع من الملغاة'; END IF;
  IF r.replaces_return_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.purchase_returns x WHERE x.replaces_return_id = r.id) THEN
    RAISE EXCEPTION 'المرتجع ده اتلغى بالتعديل (اتعمل مكانه مرتجع جديد) — عدّل الجديد';
  END IF;
  IF r.shipment_id IS NOT NULL THEN
    SELECT shipment_number INTO v_ship FROM public.shipments WHERE id = r.shipment_id AND status = 'cancelled';
    IF FOUND THEN RAISE EXCEPTION 'فاتورة الشراء % ملغاة — رجّعها الأول', v_ship; END IF;
  END IF;

  -- the pieces go out again, from the batch the cancellation put them back in (negative stock follows the branch rule)
  FOR it IN SELECT product_id, sum(quantity) AS quantity FROM public.purchase_return_items WHERE purchase_return_id = r.id AND product_id IS NOT NULL GROUP BY 1 LOOP
    v_batch := NULL;
    IF r.shipment_id IS NOT NULL THEN
      SELECT id INTO v_batch FROM public.product_batches
       WHERE product_id = it.product_id AND shipment_id = r.shipment_id AND branch_id = r.branch_id ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    END IF;
    IF v_batch IS NULL THEN
      SELECT id INTO v_batch FROM public.product_batches
       WHERE product_id = it.product_id AND branch_id = r.branch_id AND batch_type = 'purchase' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    END IF;
    IF v_batch IS NOT NULL THEN
      UPDATE public.product_batches SET quantity_remaining = greatest(quantity_remaining - it.quantity, 0) WHERE id = v_batch;
    END IF;
    PERFORM public.stock_mv_ctx('return_out', 'purchase_return', r.id, it.product_id, coalesce(r.invoice_date, r.created_at));
    UPDATE public.products SET quantity = quantity - it.quantity WHERE id = it.product_id;
    v_qty := v_qty + it.quantity;
  END LOOP;

  UPDATE public.purchase_returns SET status = 'active', cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL WHERE id = r.id;

  -- the money the cancellation paid back out is cancelled on the same (return's) day
  FOR t IN SELECT id FROM public.treasury WHERE reference_id = r.id AND category = 'purchase_return_cancel' ORDER BY created_at LOOP
    PERFORM public.till_cancel_on_original_date(t.id, 'استرجاع المرتجع ' || coalesce(r.return_number, '') || ' من الملغاة');
    n := n + 1;
  END LOOP;

  IF r.contact_id IS NOT NULL THEN
    PERFORM public.ledger_refresh_contact(r.contact_id);
    PERFORM public.ledger_gl_sync(r.tenant_id, r.contact_id, NULL);
  END IF;
  INSERT INTO public.audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (auth.uid(), coalesce((SELECT name FROM public.profiles WHERE id = auth.uid()), '?'), r.tenant_id, r.branch_id, 'RESTORE', 'purchase_return', r.id::text,
          jsonb_build_object('return_number', r.return_number, 'cancel_reason', r.cancel_reason, 'qty', v_qty, 'till_rows', n));
  RETURN jsonb_build_object('return_number', r.return_number, 'qty_out', v_qty, 'till_rows_cancelled', n);
END $function$;

CREATE OR REPLACE FUNCTION public.restore_cancelled_shipment(p_shipment_id uuid, p_money jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s public.shipments%ROWTYPE; it record; v_plan record; v_lines int := 0; v_action text; v_gone numeric := 0;
  v_ans text := coalesce(p_money->>'action', ''); v_method text := coalesce(nullif(p_money->>'method', ''), 'cash'); v_pay jsonb;
  v_plan_id uuid; v_cat uuid; t public.treasury%ROWTYPE;
BEGIN
  IF NOT public.doc_edit_is_direct() THEN RAISE EXCEPTION 'الاسترجاع من الملغاة للمالك بس — ابعت طلب' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة الشراء غير موجودة'; END IF;
  PERFORM public.assert_access(s.branch_id, NULL);
  IF s.status <> 'cancelled' THEN RAISE EXCEPTION 'فاتورة الشراء مش ملغاة'; END IF;
  IF public.ledger_day(coalesce(s.invoice_date, s.created_at)) < public.ledger_cutoff() THEN RAISE EXCEPTION 'فاتورة شراء قبل 2026 مش بترجع من الملغاة'; END IF;

  -- the money that left at the cancellation: the owner answers every time
  v_action := coalesce(s.money_action, 'credit');
  IF v_action = 'refund' THEN
    v_gone := coalesce(s.refund_amount, 0);
  ELSIF v_action = 'void' THEN
    SELECT coalesce(sum(pt.amount), 0) INTO v_gone FROM public.payment_plans pp JOIN public.payment_transactions pt ON pt.payment_plan_id = pp.id
     WHERE pp.reference_type = 'shipment' AND pp.reference_id = s.id AND pt.voided_at IS NOT NULL AND pt.reverses_tx_id IS NULL
       AND pt.void_reason LIKE 'إلغاء فاتورة الشراء%';
  END IF;
  IF v_gone > 0.005 AND v_action = 'void' AND v_ans NOT IN ('debt', 'pay') THEN
    RAISE EXCEPTION 'الفاتورة اتلغت ودفعاتها (%) اتلغت — هندفعهم للمورد تاني دلوقتي ولا يفضلوا علينا؟', round(v_gone, 2);
  END IF;
  IF v_gone > 0.005 AND v_action = 'refund' AND v_ans NOT IN ('pay', 'as_before') THEN
    RAISE EXCEPTION 'المورد رجّعلنا % لما الفاتورة اتلغت — هترجعهوله النهارده ولا كأن الاسترداد ماحصلش (بيومه)؟', round(v_gone, 2);
  END IF;
  IF v_ans = 'pay' AND v_action = 'void' AND NOT public.vessel_is_known(s.tenant_id, v_method) THEN RAISE EXCEPTION 'الوعاء غير معروف: %', v_method; END IF;

  -- the document is back on its own day (the cancellation stays in the history / audit)
  PERFORM set_config('app.shipment_restore', 'on', true);
  PERFORM set_config('app.shipment_cancel', 'on', true);
  UPDATE public.shipments SET status = 'active', cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL,
         money_action = NULL, refund_amount = 0, refund_pay_method = NULL
   WHERE id = s.id;
  PERFORM set_config('app.shipment_cancel', '', true);
  PERFORM set_config('app.shipment_restore', '', true);

  -- stock and batches come back in full (the cancellation needed them untouched and emptied them)
  FOR it IN SELECT si.product_id, sum(si.quantity)::numeric AS qty FROM public.shipment_items si
             WHERE si.shipment_id = s.id AND si.product_id IS NOT NULL GROUP BY si.product_id LOOP
    PERFORM public.stock_mv_ctx('purchase', 'shipment', s.id, it.product_id, coalesce(s.invoice_date, s.created_at));
    UPDATE public.products SET quantity = quantity + it.qty WHERE id = it.product_id;
    v_lines := v_lines + 1;
  END LOOP;
  UPDATE public.product_batches SET quantity_remaining = quantity_purchased WHERE shipment_id = s.id;

  -- the books: the cancellation's reversing entry is reversed on its own day, the purchase entry counts again
  PERFORM set_config('app.reverse_on_original_date', '1', true);
  PERFORM public.reverse_journal_for_source(s.tenant_id, 'shipment_reversal', s.id, 'استرجاع فاتورة الشراء ' || coalesce(s.shipment_number, '') || ' من الملغاة');
  PERFORM set_config('app.reverse_on_original_date', '', true);
  UPDATE public.journal_entries SET reversed_by = NULL WHERE tenant_id = s.tenant_id AND source_type = 'shipment' AND source_id = s.id AND status = 'posted';
  IF NOT EXISTS (SELECT 1 FROM public.journal_entries WHERE source_type = 'shipment' AND source_id = s.id AND status = 'posted') THEN
    PERFORM public.sync_shipment_journal(s.id);
  END IF;

  -- the plan and the installments the cancellation closed
  FOR v_plan IN SELECT * FROM public.payment_plans WHERE reference_type = 'shipment' AND reference_id = s.id AND status = 'cancelled' FOR UPDATE LOOP
    UPDATE public.payment_installments SET status = 'pending', cancelled_at = NULL, cancelled_by = NULL, adjustment_reason = NULL
     WHERE payment_plan_id = v_plan.id AND status = 'cancelled' AND adjustment_reason = 'إلغاء فاتورة الشراء';
    UPDATE public.payment_plans SET status = 'active', updated_at = now() WHERE id = v_plan.id;
    PERFORM public.plan_recompute(v_plan.id, 0);
  END LOOP;

  -- the money
  --   void (its payments were cancelled on their day): 'debt' = the plan is open again; 'pay' = a payment on it today
  --   refund (the supplier gave it back): the ledger counts that receipt only while the invoice is cancelled, so its till
  --   row is mirrored (as 0142 does for a sale) — the money goes back to him: 'pay' = today, 'as_before' = on the day
  --   he gave it (as if the refund never happened). A receipt from a supplier is not allowed (owner rule), so «it stays
  --   with us and we owe it» is not offered.
  IF v_gone > 0.005 AND v_action = 'void' AND v_ans = 'pay' THEN
    SELECT id INTO v_plan_id FROM public.payment_plans WHERE reference_type = 'shipment' AND reference_id = s.id AND status <> 'cancelled'
     ORDER BY created_at DESC LIMIT 1;
    IF v_plan_id IS NULL THEN RAISE EXCEPTION 'مفيش خطة سداد على الفاتورة عشان ندفع عليها'; END IF;
    v_pay := to_jsonb(public.record_payment_transaction(v_plan_id, NULL, round(v_gone, 2), v_method, NULL, NULL, NULL, 0, NULL, false, 'out', NULL, public.cairo_today()));
  ELSIF v_gone > 0.005 AND v_action = 'refund' THEN
    SELECT * INTO t FROM public.treasury WHERE id = s.refund_treasury_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'مش لاقي حركة الفلوس اللي المورد رجّعها في الخزنة'; END IF;
    PERFORM set_config('app.skip_treasury_voucher', '1', true);
    INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, created_by,
                                 payment_method, transaction_date, created_at)
    VALUES (t.branch_id, t.tenant_id, 'expense', 'purchase_cancel_refund_back', t.amount,
            'رجوع فلوس فاتورة الشراء ' || coalesce(s.shipment_number, '') || ' للمورد بعد استرجاعها من الملغاة'
              || CASE WHEN v_ans = 'pay' THEN '' ELSE ' (بيوم الاسترداد)' END,
            s.id, auth.uid(), t.payment_method,
            CASE WHEN v_ans = 'pay' THEN public.cairo_today() ELSE t.transaction_date END,
            CASE WHEN v_ans = 'pay' THEN now() ELSE t.created_at + interval '1 second' END);
    PERFORM set_config('app.skip_treasury_voucher', '0', true);
  END IF;

  IF s.contact_id IS NOT NULL THEN
    PERFORM public.ledger_refresh_contact(s.contact_id);
    PERFORM public.ledger_gl_sync(s.tenant_id, s.contact_id, NULL);
  END IF;
  INSERT INTO public.audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (auth.uid(), coalesce((SELECT name FROM public.profiles WHERE id = auth.uid()), '?'), s.tenant_id, s.branch_id, 'RESTORE', 'shipment', s.id::text,
          jsonb_build_object('shipment_number', s.shipment_number, 'cancel_reason', s.cancel_reason, 'money_action', v_action,
                             'money_gone', v_gone, 'answer', nullif(v_ans, ''), 'method', CASE WHEN v_ans = 'pay' THEN v_method END));
  RETURN jsonb_build_object('shipment_number', s.shipment_number, 'stock_lines', v_lines, 'money_gone', v_gone, 'answer', nullif(v_ans, ''));
END $function$;

REVOKE ALL ON FUNCTION public.restore_cancelled_sale_return(uuid), public.restore_cancelled_purchase_return(uuid),
  public.restore_cancelled_shipment(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_cancelled_sale_return(uuid), public.restore_cancelled_purchase_return(uuid),
  public.restore_cancelled_shipment(uuid, jsonb) TO service_role;

-- one door: apply_document_edit knows the three restores; request_document_edit lets them through for their document type
DO $mig$
DECLARE d text := pg_get_functiondef('public.apply_document_edit(jsonb)'::regprocedure);
  o text := $o$    WHEN 'restore_voucher' THEN
      v_res := public.restore_cancelled_voucher((a->>'p_voucher_id')::uuid);$o$;
BEGIN
  IF position('restore_shipment' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0146: apply_document_edit not the expected version'; END IF;
  EXECUTE replace(d, o, o || $n$
    WHEN 'restore_sale_return' THEN
      -- 0146
      v_res := public.restore_cancelled_sale_return((a->>'p_return_id')::uuid);
    WHEN 'restore_purchase_return' THEN
      v_res := public.restore_cancelled_purchase_return((a->>'p_return_id')::uuid);
    WHEN 'restore_shipment' THEN
      v_res := public.restore_cancelled_shipment((a->>'p_shipment_id')::uuid, coalesce(a->'p_money', '{}'::jsonb));$n$);
END
$mig$;

DO $mig$
DECLARE d text := pg_get_functiondef('public.request_document_edit(text,uuid,text,jsonb,text)'::regprocedure);
BEGIN
  IF position('restore_shipment' IN d) > 0 THEN RETURN; END IF;
  d := replace(d, $o$v_allowed := ARRAY['edit_shipment', 'update_shipment_date'];$o$,
                  $n$v_allowed := ARRAY['edit_shipment', 'update_shipment_date', 'restore_shipment'];$n$);
  d := replace(d, $o$v_allowed := ARRAY['edit_sale_return'];$o$, $n$v_allowed := ARRAY['edit_sale_return', 'restore_sale_return'];$n$);
  d := replace(d, $o$v_allowed := ARRAY['edit_purchase_return'];$o$, $n$v_allowed := ARRAY['edit_purchase_return', 'restore_purchase_return'];$n$);
  IF position('restore_shipment' IN d) = 0 OR position('restore_sale_return' IN d) = 0 OR position('restore_purchase_return' IN d) = 0 THEN
    RAISE EXCEPTION '0146: request_document_edit not the expected version';
  END IF;
  EXECUTE d;
END
$mig$;
