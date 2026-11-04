-- 0149: a restored purchase invoice whose supplier gave the money back — a THIRD answer «تفضل معانا وتبقى علينا له»
-- (owner «عاوزه يساله الكاشير او المالك وبكده يكون عنده 3 اختيارات», 2026-11-04). The person who restores (the owner, or
-- anybody with shipments.update through «طلب موافقة») picks one, and each one has its effect:
--   «هترجعهوله النهارده» (pay)          → the till −X today; his account as before the cancellation (0)
--   «كأن الاسترداد ماحصلش» (as_before) → the till of the refund day −X; his account 0
--   «تفضل معانا وتبقى علينا» (keep)     → the till stays +X; his account: we owe him X (paid later like any supplier debt)
-- Example: PO00578 (200 paid on 18/2), cancelled «المورد رجّع» 200 cash, restored «تفضل علينا» → till +200,
-- the supplier's account «علينا 200», books 1100 +200 / 2100 −200.
-- How: the ledger counts the supplier's refund only while the invoice is cancelled; for 'keep' the refund is copied to
-- shipments.kept_refund_* and ledger_desired_movements keeps the SAME movement (shipments, refund, charge) from it — so
-- the books and the movement do not change at all. No receipt voucher from a supplier is made (guard_voucher_receipt_party
-- stays). Cancelling that invoice again with «المورد رجّع» is refused while a kept refund is on it (pay him first).

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS kept_refund_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kept_refund_method text,
  ADD COLUMN IF NOT EXISTS kept_refund_day date,
  ADD COLUMN IF NOT EXISTS kept_refund_treasury_id uuid REFERENCES public.treasury(id);

-- the ledger keeps the supplier's refund of a restored invoice when the owner chose «تفضل علينا»
DO $mig$
DECLARE d text := pg_get_functiondef('public.ledger_desired_movements(uuid)'::regprocedure);
  o text := $o$   WHERE s.contact_id = c.id AND s.status = 'cancelled' AND s.money_action = 'refund' AND COALESCE(s.refund_amount, 0) > 0.005
     AND public.ledger_day(COALESCE(s.cancelled_at, s.created_at)) >= v_cut$o$;
BEGIN
  IF position('kept_refund_amount' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0149: ledger_desired_movements not the expected version'; END IF;
  EXECUTE replace(d, o, o || $n$
  UNION ALL
  -- 0149: a restored purchase whose supplier refund stays with us («تفضل علينا») — the same movement, from kept_refund_*
  SELECT 'shipments', s.id, 'refund', 'supplier', 'charge',
         s.branch_id, COALESCE(s.kept_refund_method, 'cash'), round(s.kept_refund_amount, 2),
         s.kept_refund_day, NULL, NULL, s.kept_refund_treasury_id, false
    FROM shipments s
   WHERE s.contact_id = c.id AND COALESCE(s.kept_refund_amount, 0) > 0.005 AND s.kept_refund_day >= v_cut$n$);
END
$mig$;

-- no second «المورد رجّع» on an invoice that still carries a kept refund (the two would be one movement)
DO $mig$
DECLARE d text := pg_get_functiondef('public.cancel_purchase_invoice(uuid,text,text,text)'::regprocedure);
  o text := $o$  IF v_pay NOT IN ('cash', 'instapay', 'vodafone', 'wallet', 'bank') THEN RAISE EXCEPTION 'طريقة رد غير معروفة'; END IF;$o$;
BEGIN
  IF position('kept_refund_amount' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0149: cancel_purchase_invoice not the expected version'; END IF;
  EXECUTE replace(d, o, o || $n$
  -- 0149: the supplier's earlier refund is still with us («تفضل علينا») — pay him first, then «المورد رجّع» again
  IF v_action = 'refund' AND COALESCE(s.kept_refund_amount, 0) > 0.005 THEN
    RAISE EXCEPTION 'على الفاتورة دي % المورد رجّعهم قبل كده ولسه علينا له — ادفعهمله الأول أو اختار «تحت حسابه»', s.kept_refund_amount;
  END IF;$n$);
END
$mig$;

CREATE OR REPLACE FUNCTION public.restore_cancelled_shipment(p_shipment_id uuid, p_money jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s public.shipments%ROWTYPE; it record; v_plan record; v_lines int := 0; v_action text; v_gone numeric := 0;
  v_ans text := coalesce(p_money->>'action', ''); v_method text := coalesce(nullif(p_money->>'method', ''), 'cash'); v_pay jsonb;
  v_plan_id uuid; v_cat uuid; t public.treasury%ROWTYPE; v_keep boolean;
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
  IF v_gone > 0.005 AND v_action = 'refund' AND v_ans NOT IN ('pay', 'as_before', 'keep') THEN
    RAISE EXCEPTION 'المورد رجّعلنا % لما الفاتورة اتلغت — هترجعهوله النهارده، ولا كأن الاسترداد ماحصلش (بيومه)، ولا تفضل معانا وتبقى علينا له؟', round(v_gone, 2);
  END IF;
  IF v_gone > 0.005 AND v_action = 'refund' AND v_ans = 'keep' AND s.contact_id IS NULL THEN
    RAISE EXCEPTION 'مفيش مورد على الفاتورة — الفلوس مينفعش «تفضل علينا» لحد مش معروف';
  END IF;
  v_keep := v_gone > 0.005 AND v_action = 'refund' AND v_ans = 'keep';
  IF v_ans = 'pay' AND v_action = 'void' AND NOT public.vessel_is_known(s.tenant_id, v_method) THEN RAISE EXCEPTION 'الوعاء غير معروف: %', v_method; END IF;

  -- the document is back on its own day (the cancellation stays in the history / audit)
  PERFORM set_config('app.shipment_restore', 'on', true);
  PERFORM set_config('app.shipment_cancel', 'on', true);
  -- 0149 «تفضل علينا»: his refund stays a charge on his side (ledger_desired_movements reads kept_refund_*)
  UPDATE public.shipments SET status = 'active', cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL,
         money_action = NULL, refund_amount = 0, refund_pay_method = NULL,
         kept_refund_amount = CASE WHEN v_keep THEN round(v_gone, 2) ELSE kept_refund_amount END,
         kept_refund_method = CASE WHEN v_keep THEN coalesce(s.refund_pay_method, 'cash') ELSE kept_refund_method END,
         kept_refund_day = CASE WHEN v_keep THEN public.ledger_day(coalesce(s.cancelled_at, s.created_at)) ELSE kept_refund_day END,
         kept_refund_treasury_id = CASE WHEN v_keep THEN s.refund_treasury_id ELSE kept_refund_treasury_id END
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
  --   refund (the supplier gave it back): the ledger counts that receipt only while the invoice is cancelled, so for
  --   'pay' / 'as_before' its till row is mirrored (as 0142 does for a sale) — the money goes back to him today / on the
  --   day he gave it; for 'keep' nothing moves: the ledger keeps the refund movement from kept_refund_* (we owe him).
  IF v_gone > 0.005 AND v_action = 'void' AND v_ans = 'pay' THEN
    SELECT id INTO v_plan_id FROM public.payment_plans WHERE reference_type = 'shipment' AND reference_id = s.id AND status <> 'cancelled'
     ORDER BY created_at DESC LIMIT 1;
    IF v_plan_id IS NULL THEN RAISE EXCEPTION 'مفيش خطة سداد على الفاتورة عشان ندفع عليها'; END IF;
    v_pay := to_jsonb(public.record_payment_transaction(v_plan_id, NULL, round(v_gone, 2), v_method, NULL, NULL, NULL, 0, NULL, false, 'out', NULL, public.cairo_today()));
  ELSIF v_gone > 0.005 AND v_action = 'refund' AND NOT v_keep THEN
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

