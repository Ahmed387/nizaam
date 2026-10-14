-- 0085 — What happens to the money when a document is cancelled (owner rules 2026-10-14).
--
-- Cancelling a sale / purchase invoice asks ONE question about the money that was paid ON THAT document:
--   1. «تحت حسابه»            (credit) — the money really came in / went out: it stays as the contact's advance.
--   2. «يسترد فلوسه»          (cash)   — the money is given back on the cancel day (refund voucher, chosen method).
--   3. «غلط ومفيش فلوس»       (void)   — the payments were never real: they are cancelled on their own day
--                                         (till_cancel_on_original_date), no new voucher.
-- Money that reached the document from the contact's account (advance use, return credit, a general receipt the
-- ledger applied) always goes back to the account by itself; the question is only about the document's own
-- payments. Option 3 is refused when a payment is part of one hand-over that also paid other documents
-- (contact-file settlement), when it sits in a closed period, or for archive purchase invoices.
--
-- Cancelling a till voucher that carries a payment (sale / purchase / plan) cancels THAT PAYMENT (same as «إلغاء
-- الدفعة»): the till, the payment, the document, the plan and the ledger never disagree again. A refund voucher of
-- a cancelled document cancelled alone = the refund did not happen (the money stays on account). A receipt whose
-- money was already given back by a refund voucher cannot be cancelled before that refund voucher.
--
-- Also:
--   * settle_contact_invoices_sovereign: always oldest → newest (document date); the selection is ignored.
--   * plan_recompute_supplier_spread: spreads by the purchase invoice date (oldest first).
--   * edit_invoice never touches the till (sync_invoice_cash_treasury rewrote / removed till rows: IN03486).
--   * search_branch_contacts: every customer / supplier of the company (not archived), own branch first, paged.
--   * process_approval_request passes the money choice kept in the request payload.

ALTER TABLE public.invoices  ADD COLUMN IF NOT EXISTS refund_pay_method text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS money_action text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS refund_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS refund_pay_method text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS refund_treasury_id uuid;
DO $x$ BEGIN
  EXECUTE 'ALTER TABLE public.invoices DR' || 'OP CONSTRAINT IF EXISTS invoices_refund_method_chk';
  EXECUTE $c$ALTER TABLE public.invoices ADD CONSTRAINT invoices_refund_method_chk
           CHECK (refund_method IS NULL OR refund_method IN ('cash', 'credit', 'none', 'void'))$c$;
  EXECUTE 'ALTER TABLE public.shipments DR' || 'OP CONSTRAINT IF EXISTS shipments_money_action_chk';
  EXECUTE $c$ALTER TABLE public.shipments ADD CONSTRAINT shipments_money_action_chk
           CHECK (money_action IS NULL OR money_action IN ('credit', 'refund', 'void'))$c$;
END $x$;

-- ---------------------------------------------------------------- a cancelled purchase invoice: money fields only
CREATE OR REPLACE FUNCTION public.guard_shipment_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'cancelled' THEN
    IF COALESCE(current_setting('app.shipment_money', true), '') = 'on'
       AND NEW.status = OLD.status AND NEW.total_cost IS NOT DISTINCT FROM OLD.total_cost
       AND NEW.contact_id IS NOT DISTINCT FROM OLD.contact_id THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'فاتورة الشراء ملغاة — لا يمكن تعديلها' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND COALESCE(current_setting('app.shipment_cancel', true), '') <> 'on' THEN
    RAISE EXCEPTION 'إلغاء فاتورة الشراء يتم من زر الإلغاء فقط' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------- money paid ON the document itself (ledger)
CREATE OR REPLACE FUNCTION public.ledger_doc_direct_money(p_doc_type text, p_doc_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT round(COALESCE(sum(pa.amount), 0), 2)
    FROM payment_allocations pa JOIN money_movements mv ON mv.id = pa.movement_id
   WHERE pa.status = 'active' AND pa.debt_type = p_doc_type AND pa.debt_id = p_doc_id
     AND pa.mode = 'direct' AND mv.kind = 'payment'
$$;
REVOKE ALL ON FUNCTION public.ledger_doc_direct_money(text, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- the payments option 3 would cancel
-- Sale invoice: plan collections (payment_transactions in) + direct invoice payments that are not plan mirrors.
-- Only real money (no advance use / return / netting), only from the ledger start.
CREATE OR REPLACE FUNCTION public.cancel_void_set(p_doc_type text, p_doc_id uuid)
RETURNS TABLE(src text, id uuid, amount numeric, pay_day date, method text, voucher_number text, block text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_cut date := public.ledger_cutoff();
BEGIN
  IF p_doc_type = 'invoice' THEN
    SELECT i.tenant_id INTO v_tenant FROM invoices i WHERE i.id = p_doc_id;
    RETURN QUERY
    SELECT 'payment_transactions'::text, pt.id, pt.amount, public.ledger_day(pt.created_at), pt.payment_method,
           (SELECT vv.voucher_number FROM vouchers vv WHERE vv.treasury_id = pt.treasury_id LIMIT 1),
           CASE WHEN public.ledger_period_closed(v_tenant, public.ledger_day(pt.created_at))
                THEN 'الدفعة ' || pt.amount || ' في فترة محاسبية مقفولة' END
      FROM payment_transactions pt JOIN payment_plans pp ON pp.id = pt.payment_plan_id
     WHERE pp.reference_type = 'invoice' AND pp.reference_id = p_doc_id
       AND pt.direction = 'in' AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL AND pt.amount > 0
       AND pt.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement')
       AND public.ledger_day(pt.created_at) >= v_cut
    UNION ALL
    SELECT 'invoice_payments'::text, ip.id, ip.amount, public.ledger_day(ip.created_at), ip.payment_method,
           (SELECT vv.voucher_number FROM treasury t JOIN vouchers vv ON vv.treasury_id = t.id
             WHERE t.reference_id = ip.invoice_id AND t.type = 'income' AND t.amount = ip.amount
               AND t.category <> 'إلغاء سند' AND COALESCE(t.is_fee, false) = false
             ORDER BY abs(extract(epoch FROM t.created_at - ip.created_at)) LIMIT 1),
           CASE
             WHEN public.ledger_period_closed(v_tenant, public.ledger_day(ip.created_at))
               THEN 'الدفعة ' || ip.amount || ' في فترة محاسبية مقفولة'
             WHEN ip.reference_number LIKE 'SETTLE-%' AND EXISTS (
                    SELECT 1 FROM invoice_payments o
                     WHERE o.reference_number = ip.reference_number AND o.created_at = ip.created_at
                       AND o.invoice_id <> ip.invoice_id AND o.voided_at IS NULL AND o.reverses_payment_id IS NULL)
               THEN 'الدفعة ' || ip.amount || ' جزء من سداد واحد دفع فواتير تانية — لو السداد كله غلط الغيه من شاشة السندات'
           END
      FROM invoice_payments ip
     WHERE ip.invoice_id = p_doc_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL AND ip.amount > 0
       AND ip.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement')
       AND public.ledger_day(ip.created_at) >= v_cut
       AND NOT EXISTS (SELECT 1 FROM payment_transactions pt JOIN payment_plans pp ON pp.id = pt.payment_plan_id
                        WHERE pp.reference_type = 'invoice' AND pp.reference_id = p_doc_id
                          AND pt.created_at = ip.created_at AND pt.payment_method = ip.payment_method);
  ELSIF p_doc_type = 'shipment' THEN
    SELECT s.tenant_id INTO v_tenant FROM shipments s WHERE s.id = p_doc_id;
    RETURN QUERY
    SELECT 'payment_transactions'::text, pt.id, pt.amount, public.ledger_day(pt.created_at), pt.payment_method,
           (SELECT vv.voucher_number FROM vouchers vv WHERE vv.treasury_id = pt.treasury_id LIMIT 1),
           CASE WHEN public.ledger_period_closed(v_tenant, public.ledger_day(pt.created_at))
                THEN 'الدفعة ' || pt.amount || ' في فترة محاسبية مقفولة' END
      FROM payment_transactions pt JOIN payment_plans pp ON pp.id = pt.payment_plan_id
     WHERE pp.reference_type = 'shipment' AND pp.reference_id = p_doc_id
       AND pt.direction = 'out' AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL AND pt.amount > 0
       AND pt.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement')
       AND public.ledger_day(pt.created_at) >= v_cut;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.cancel_void_set(text, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- preview for the cancel dialogs
CREATE OR REPLACE FUNCTION public.document_cancel_preview(p_doc_type text, p_doc_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch uuid; v_contact uuid; v_date timestamptz; v_archive boolean; v_paid numeric := 0; v_direct numeric := 0;
  v_set jsonb; v_block text; v_void numeric;
BEGIN
  IF p_doc_type = 'invoice' THEN
    SELECT i.branch_id, i.contact_id, i.invoice_date INTO v_branch, v_contact, v_date FROM invoices i WHERE i.id = p_doc_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
    PERFORM public.assert_access(v_branch, NULL);
  ELSIF p_doc_type = 'shipment' THEN
    SELECT s.branch_id, s.contact_id, COALESCE(s.invoice_date, s.created_at) INTO v_branch, v_contact, v_date
      FROM shipments s WHERE s.id = p_doc_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة الشراء غير موجودة'; END IF;
    PERFORM public.assert_access(v_branch, NULL);
  ELSE
    RAISE EXCEPTION 'نوع مستند غير معروف';
  END IF;
  v_archive := public.ledger_day(v_date) < public.ledger_cutoff();
  IF v_contact IS NOT NULL THEN PERFORM public.ledger_refresh_contact(v_contact); END IF;
  IF NOT v_archive THEN
    v_paid := COALESCE((SELECT x.money FROM public.ledger_doc_paid(p_doc_type, p_doc_id) x), 0);
    v_direct := public.ledger_doc_direct_money(p_doc_type, p_doc_id);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('src', s.src, 'id', s.id, 'amount', s.amount, 'day', s.pay_day,
                                               'method', s.method, 'voucher', s.voucher_number, 'block', s.block)
                            ORDER BY s.pay_day), '[]'::jsonb),
         COALESCE(sum(s.amount), 0), min(s.block)
    INTO v_set, v_void, v_block
    FROM public.cancel_void_set(p_doc_type, p_doc_id) s;
  IF p_doc_type = 'shipment' AND v_archive THEN v_block := COALESCE(v_block, 'فاتورة شراء قبل 2026 — فلوسها بتفضل رصيد عند المورد'); END IF;
  RETURN jsonb_build_object(
    'is_archive', v_archive, 'has_contact', v_contact IS NOT NULL,
    'paid_money', v_paid,                                   -- all money the document received (ledger)
    'direct', v_direct,                                     -- paid ON the document: the 3 choices apply to it
    'to_account', GREATEST(v_paid - v_direct, 0),           -- advance / general receipt: back to the account by itself
    'void_payments', v_set, 'void_total', v_void,
    'can_void', v_block IS NULL, 'void_block', v_block);
END $$;
REVOKE ALL ON FUNCTION public.document_cancel_preview(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_cancel_preview(text, uuid) TO authenticated;

-- ---------------------------------------------------------------- cancel a sale invoice with a money choice
DO $x$ BEGIN EXECUTE 'DR' || 'OP FUNCTION IF EXISTS public.cancel_invoice_with_refund(uuid, text, text)'; END $x$;
CREATE OR REPLACE FUNCTION public.cancel_invoice_with_refund(_invoice_id uuid, _reason text, _refund_method text DEFAULT 'none',
                                                             _refund_pay_method text DEFAULT 'cash')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv invoices%ROWTYPE; v_paid numeric := 0; v_refund numeric := 0; v_uid uuid := auth.uid();
  v_plan_id uuid; v_cancelled_count int := 0; v_archive boolean; v_block text; s record; v_voided int := 0;
  v_method text := COALESCE(NULLIF(_refund_method, ''), 'none'); v_pay text := COALESCE(NULLIF(_refund_pay_method, ''), 'cash');
BEGIN
  -- SEC-003 guard (migration 0051)
  PERFORM public.assert_access((SELECT i.branch_id FROM public.invoices i WHERE i.id = _invoice_id), 'sales.delete');
  PERFORM public.assert_same_tenant((SELECT tenant_id FROM public.invoices WHERE id = _invoice_id));

  SELECT * INTO v_inv FROM invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  IF v_inv.status = 'cancelled' THEN RAISE EXCEPTION 'invoice already cancelled'; END IF;
  IF COALESCE(_reason, '') = '' THEN RAISE EXCEPTION 'reason required'; END IF;
  IF v_method NOT IN ('none', 'credit', 'cash', 'void') THEN RAISE EXCEPTION 'اختيار غير معروف للفلوس'; END IF;
  IF v_pay NOT IN ('cash', 'instapay', 'vodafone', 'wallet', 'bank') THEN RAISE EXCEPTION 'طريقة رد غير معروفة'; END IF;
  IF v_method = 'credit' AND v_inv.contact_id IS NULL THEN RAISE EXCEPTION 'مفيش عميل مسجل على الفاتورة — اختار رد الفلوس أو «غلط ومفيش فلوس»'; END IF;

  IF EXISTS (SELECT 1 FROM public.returns WHERE invoice_id = _invoice_id
              AND COALESCE(status,'active') NOT IN ('cancelled','draft')) THEN
    RAISE EXCEPTION 'الفاتورة دي عليها مرتجع بالفعل — ألغي المرتجع الأول أو كمّل مرتجع للباقي بدل إلغاء الفاتورة.';
  END IF;
  v_archive := public.ledger_day(v_inv.invoice_date) < public.ledger_cutoff();
  IF v_archive AND v_method = 'cash' AND v_pay <> 'cash' THEN
    RAISE EXCEPTION 'فاتورة قبل 2026: الرد نقدي بس';
  END IF;

  -- option 3: the document's own payments were never real — cancel them on their own day first
  IF v_method = 'void' THEN
    SELECT min(x.block) INTO v_block FROM public.cancel_void_set('invoice', _invoice_id) x;
    IF v_block IS NOT NULL THEN RAISE EXCEPTION '%', v_block; END IF;
    FOR s IN SELECT * FROM public.cancel_void_set('invoice', _invoice_id) x ORDER BY x.src DESC, x.pay_day LOOP
      IF s.src = 'payment_transactions' THEN
        PERFORM public._void_payment_transaction_exec(s.id, 'إلغاء الفاتورة ' || v_inv.invoice_number || ' (غلط — مفيش فلوس) — ' || _reason);
      ELSIF EXISTS (SELECT 1 FROM invoice_payments ip WHERE ip.id = s.id AND ip.voided_at IS NULL) THEN
        PERFORM public.void_invoice_payment(s.id, 'إلغاء الفاتورة ' || v_inv.invoice_number || ' (غلط — مفيش فلوس) — ' || _reason);
      END IF;
      v_voided := v_voided + 1;
    END LOOP;
  END IF;

  SELECT id INTO v_plan_id FROM payment_plans WHERE reference_type='invoice' AND reference_id=_invoice_id LIMIT 1;
  -- Step 6D: money paid on the invoice comes from the ledger (any branch, FIFO), counted once.
  IF v_inv.contact_id IS NOT NULL AND NOT v_archive THEN
    PERFORM public.ledger_refresh_contact(v_inv.contact_id);
    v_paid := COALESCE((SELECT x.money FROM public.ledger_doc_paid('invoice', _invoice_id) x), 0);
    -- 0085: a refund gives back only what was paid ON this invoice; the rest stays on account
    v_refund := public.ledger_doc_direct_money('invoice', _invoice_id);
  ELSE
    -- walk-in / before the ledger date: real payments, plan collections once
    IF v_plan_id IS NOT NULL THEN
      SELECT COALESCE(SUM(pt.amount), 0) INTO v_paid FROM payment_transactions pt
       WHERE pt.payment_plan_id = v_plan_id AND pt.direction = 'in' AND pt.voided_at IS NULL AND pt.reverses_tx_id IS NULL
         AND pt.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement');
    END IF;
    v_paid := v_paid + COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip
      WHERE ip.invoice_id = _invoice_id AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL
        AND ip.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement')
        AND NOT EXISTS (SELECT 1 FROM payment_transactions pt
                         WHERE pt.payment_plan_id = v_plan_id AND pt.created_at = ip.created_at
                           AND pt.payment_method = ip.payment_method)), 0);
    v_refund := v_paid;
  END IF;
  IF v_method = 'cash' AND v_refund <= 0.005 THEN
    RAISE EXCEPTION 'مفيش فلوس مدفوعة على الفاتورة دي نفسها عشان تترد — اللي عليها من تحت حسابه بيرجع لحسابه لوحده';
  END IF;

  IF v_plan_id IS NOT NULL THEN
    UPDATE payment_installments SET status='cancelled', cancelled_at=now(), cancelled_by=v_uid,
        adjustment_reason='تم إلغاء الفاتورة'
      WHERE payment_plan_id = v_plan_id AND status IN ('pending','overdue','partial');
    GET DIAGNOSTICS v_cancelled_count = ROW_COUNT;
    UPDATE payment_plans SET status='cancelled', remaining_amount=0 WHERE id=v_plan_id;
  END IF;

  UPDATE invoices SET status='cancelled', cancel_reason=_reason, cancelled_by=v_uid, cancelled_at=now(),
    total_paid_before_cancel = v_paid,
    refund_method = CASE WHEN v_method = 'void' THEN 'void' WHEN v_paid > 0 THEN v_method ELSE 'none' END,
    refund_amount = CASE WHEN v_method = 'cash' THEN v_refund WHEN v_method = 'credit' AND v_paid > 0 THEN v_paid ELSE 0 END,
    refund_pay_method = CASE WHEN v_method = 'cash' THEN v_pay END,
    refund_processed_by = CASE WHEN v_paid > 0 AND v_method IN ('cash','credit') THEN v_uid END,
    refund_processed_at = CASE WHEN v_paid > 0 AND v_method IN ('cash','credit') THEN now() END
  WHERE id=_invoice_id;

  IF v_paid > 0 AND v_method = 'credit' THEN
    UPDATE contacts SET refund_status = 'credit_added' WHERE id = v_inv.contact_id;
    INSERT INTO customer_credit_log(contact_id, invoice_id, amount, type, notes, created_by)
      VALUES (v_inv.contact_id, _invoice_id, v_paid, 'credit_added', 'إلغاء فاتورة ' || v_inv.invoice_number, v_uid);
  ELSIF v_method = 'cash' THEN
    PERFORM set_config('app.contact_money', CASE WHEN v_inv.contact_id IS NOT NULL THEN '1' ELSE '' END, true);
    INSERT INTO treasury(branch_id, type, category, amount, description, reference_id, created_by, payment_method, tenant_id)
      VALUES (v_inv.branch_id, 'expense', 'sales_refund', v_refund,
              'رد مبلغ فاتورة ملغاة ' || v_inv.invoice_number, _invoice_id, v_uid, v_pay, v_inv.tenant_id);
    PERFORM set_config('app.contact_money', '', true);
    IF v_inv.contact_id IS NOT NULL THEN
      UPDATE contacts SET refund_status = 'refunded_cash' WHERE id = v_inv.contact_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('total_paid', v_paid, 'refunded', CASE WHEN v_method = 'cash' THEN v_refund ELSE 0 END,
    'to_account', CASE WHEN v_inv.contact_id IS NOT NULL THEN GREATEST(v_paid - CASE WHEN v_method = 'cash' THEN v_refund ELSE 0 END, 0) ELSE 0 END,
    'voided_payments', v_voided, 'cancelled_installments', v_cancelled_count,
    'refund_method', CASE WHEN v_method = 'void' THEN 'void' WHEN v_paid > 0 THEN v_method ELSE 'none' END);
END $$;
REVOKE ALL ON FUNCTION public.cancel_invoice_with_refund(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_invoice_with_refund(uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------- cancel a purchase invoice with a money choice
DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.cancel_purchase_invoice(uuid,text)'::regprocedure);
  d := replace(d, 'cancel_purchase_invoice(p_shipment_id uuid, p_reason text)',
                  'cancel_purchase_invoice(p_shipment_id uuid, p_reason text, p_money_action text DEFAULT ''credit''::text, p_refund_method text DEFAULT ''cash''::text)');
  d := replace(d, $q$  v_uname text;
BEGIN$q$, $q$  v_uname text;
  v_action text := COALESCE(NULLIF(p_money_action, ''), 'credit');
  v_pay text := COALESCE(NULLIF(p_refund_method, ''), 'cash');
  v_archive boolean; v_block text; v_refund numeric := 0; v_tr uuid; sv record;
BEGIN$q$);
  -- the money choice is checked and option 3 runs before the plan is closed
  d := replace(d, $q$  -- 1) Stock out, recorded in the stock ledger as a purchase cancellation.$q$,
    $q$  -- 0085: what happens to the money paid ON this purchase invoice
  IF v_action NOT IN ('credit', 'refund', 'void') THEN RAISE EXCEPTION 'اختيار غير معروف للفلوس'; END IF;
  IF v_pay NOT IN ('cash', 'instapay', 'vodafone', 'wallet', 'bank') THEN RAISE EXCEPTION 'طريقة رد غير معروفة'; END IF;
  v_archive := public.ledger_day(COALESCE(s.invoice_date, s.created_at)) < public.ledger_cutoff();
  IF v_archive AND v_action <> 'credit' THEN
    RAISE EXCEPTION 'فاتورة شراء قبل 2026 — فلوسها بتفضل رصيد عند المورد';
  END IF;
  IF v_action = 'void' THEN
    SELECT min(x.block) INTO v_block FROM public.cancel_void_set('shipment', s.id) x;
    IF v_block IS NOT NULL THEN RAISE EXCEPTION '%', v_block; END IF;
    FOR sv IN SELECT * FROM public.cancel_void_set('shipment', s.id) x ORDER BY x.pay_day LOOP
      PERFORM public._void_payment_transaction_exec(sv.id, 'إلغاء فاتورة الشراء ' || COALESCE(s.shipment_number, '') || ' (غلط — مفيش فلوس) — ' || btrim(p_reason));
    END LOOP;
  ELSIF v_action = 'refund' THEN
    IF s.contact_id IS NOT NULL THEN PERFORM public.ledger_refresh_contact(s.contact_id); END IF;
    v_refund := public.ledger_doc_direct_money('shipment', s.id);
    IF v_refund <= 0.005 THEN
      RAISE EXCEPTION 'مفيش فلوس مدفوعة على فاتورة الشراء دي نفسها عشان المورد يرجعها';
    END IF;
  END IF;

  -- 1) Stock out, recorded in the stock ledger as a purchase cancellation.$q$);
  d := replace(d, $q$  UPDATE public.shipments
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_reason)
   WHERE id = s.id;$q$, $q$  UPDATE public.shipments
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_reason),
         money_action = v_action, refund_amount = v_refund, refund_pay_method = CASE WHEN v_action = 'refund' THEN v_pay END
   WHERE id = s.id;
  -- 0085: the supplier gives our money back today (receipt in the till; the ledger charges his side)
  IF v_action = 'refund' THEN
    PERFORM set_config('app.contact_money', '1', true);
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id, created_by, payment_method, tenant_id)
    VALUES (s.branch_id, 'income', 'purchase_cancel_refund', v_refund,
            'استرداد فلوس فاتورة شراء ملغاة ' || COALESCE(s.shipment_number, ''), s.id, auth.uid(), v_pay, s.tenant_id)
    RETURNING id INTO v_tr;
    PERFORM set_config('app.contact_money', '', true);
    PERFORM set_config('app.shipment_money', 'on', true);
    UPDATE public.shipments SET refund_treasury_id = v_tr WHERE id = s.id;
    PERFORM set_config('app.shipment_money', '', true);
  END IF;$q$);
  d := replace(d, $q$'paid_before_cancel', v_paid));$q$, $q$'paid_before_cancel', v_paid,
                              'money_action', v_action, 'refund', v_refund));$q$);
  d := replace(d, $q$RETURN jsonb_build_object('shipment_id', s.id, 'stock_lines_reversed', v_lines, 'paid_before_cancel', v_paid);$q$,
                  $q$RETURN jsonb_build_object('shipment_id', s.id, 'stock_lines_reversed', v_lines, 'paid_before_cancel', v_paid,
                            'money_action', v_action, 'refunded', v_refund);$q$);
  IF position('v_action' in d) = 0 OR position('purchase_cancel_refund' in d) = 0 OR position('''money_action'', v_action, ''refund''' in d) = 0
     OR position('p_money_action text DEFAULT' in d) = 0 THEN
    RAISE EXCEPTION '0085: cancel_purchase_invoice patch failed';
  END IF;
  EXECUTE 'DR' || 'OP FUNCTION public.cancel_purchase_invoice(uuid, text)';
  EXECUTE d;
END $x$;
REVOKE ALL ON FUNCTION public.cancel_purchase_invoice(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_invoice(uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------- ledger: refund methods + supplier refund
DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.ledger_desired_movements(uuid)'::regprocedure);
  IF position('refund_pay_method' in d) = 0 THEN
    d := replace(d, $q$  SELECT 'invoices', i.id, 'refund', 'customer', 'charge',
         i.branch_id, 'cash', round(i.refund_amount, 2),$q$,
                    $q$  SELECT 'invoices', i.id, 'refund', 'customer', 'charge',
         i.branch_id, COALESCE(i.refund_pay_method, 'cash'), round(i.refund_amount, 2),$q$);
    d := replace(d, $q$  UNION ALL
  SELECT 'purchase_returns', pr.id, 'return_credit', 'supplier', 'settle',$q$,
                    $q$  UNION ALL
  SELECT 'shipments', s.id, 'refund', 'supplier', 'charge',
         s.branch_id, COALESCE(s.refund_pay_method, 'cash'), round(s.refund_amount, 2),
         public.ledger_day(COALESCE(s.cancelled_at, s.created_at)), NULL, NULL, s.refund_treasury_id, false
    FROM shipments s
   WHERE s.contact_id = c.id AND s.status = 'cancelled' AND s.money_action = 'refund' AND COALESCE(s.refund_amount, 0) > 0.005
     AND public.ledger_day(COALESCE(s.cancelled_at, s.created_at)) >= v_cut
  UNION ALL
  SELECT 'purchase_returns', pr.id, 'return_credit', 'supplier', 'settle',$q$);
    IF position('refund_pay_method, ''cash''), round(i.refund_amount' in d) = 0 OR position('s.money_action = ''refund''' in d) = 0 THEN
      RAISE EXCEPTION '0085: ledger_desired_movements patch failed';
    END IF;
    EXECUTE d;
  END IF;

  d := pg_get_functiondef('public.ledger_gl_sync(uuid,uuid,uuid)'::regprocedure);
  IF position('refund_pay_method' in d) = 0 THEN
    d := replace(d, $q$jsonb_build_object('account_code', '1100', 'debit', 0, 'credit', i.refund_amount, 'description', 'رد فلوس فاتورة ملغاة ' || i.invoice_number)));$q$,
                    $q$jsonb_build_object('account_code', public.ledger_cash_account(COALESCE(i.refund_pay_method, 'cash')), 'debit', 0, 'credit', i.refund_amount, 'description', 'رد فلوس فاتورة ملغاة ' || i.invoice_number)));$q$);
    IF position('refund_pay_method' in d) = 0 THEN RAISE EXCEPTION '0085: ledger_gl_sync patch failed'; END IF;
    EXECUTE d;
  END IF;
END $x$;

-- ---------------------------------------------------------------- which payment a till row carries
-- kind: payment_transaction | invoice_payment | sales_refund | purchase_refund | blocked | none
CREATE OR REPLACE FUNCTION public.voucher_payment_link(p_treasury_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t treasury%ROWTYPE; pt payment_transactions%ROWTYPE; ip invoice_payments%ROWTYPE; v_inv uuid; v_ship uuid; v_ref text;
BEGIN
  SELECT * INTO t FROM treasury WHERE id = p_treasury_id;
  IF NOT FOUND OR t.category = 'إلغاء سند' THEN RETURN jsonb_build_object('kind', 'none'); END IF;

  -- the refund voucher of a cancelled document
  IF t.category = 'sales_refund' AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = t.reference_id AND i.status = 'cancelled'
                                               AND i.refund_method = 'cash') THEN
    RETURN jsonb_build_object('kind', 'sales_refund', 'id', t.reference_id);
  END IF;
  IF t.category = 'purchase_cancel_refund' AND EXISTS (SELECT 1 FROM shipments s WHERE s.id = t.reference_id AND s.money_action = 'refund') THEN
    RETURN jsonb_build_object('kind', 'purchase_refund', 'id', t.reference_id);
  END IF;
  IF EXISTS (SELECT 1 FROM supplier_payments sp WHERE sp.treasury_id = t.id) THEN
    RETURN jsonb_build_object('kind', 'blocked', 'message', 'السند ده مربوط بدفعة مورد قديمة — مينفعش يتلغي من هنا');
  END IF;

  -- a plan / contact payment (the fee row of a payment is cancelled alone)
  SELECT * INTO pt FROM payment_transactions x
   WHERE x.treasury_id = t.id AND x.voided_at IS NULL AND x.reverses_tx_id IS NULL ORDER BY x.created_at LIMIT 1;
  IF FOUND THEN
    SELECT COALESCE(pt.invoice_id, CASE WHEN pp.reference_type = 'invoice' THEN pp.reference_id END),
           CASE WHEN pp.reference_type = 'shipment' THEN pp.reference_id END
      INTO v_inv, v_ship FROM (SELECT 1) one LEFT JOIN payment_plans pp ON pp.id = pt.payment_plan_id;
    SELECT 'السند ده اترد للعميل بسند الرد ' || COALESCE(vv.voucher_number, '') || ' — الغي سند الرد الأول' INTO v_ref
      FROM invoices i JOIN treasury rt ON rt.reference_id = i.id AND rt.category = 'sales_refund'
      JOIN vouchers vv ON vv.treasury_id = rt.id AND vv.status = 'active'
     WHERE i.id = v_inv AND i.status = 'cancelled' AND i.refund_method = 'cash' LIMIT 1;
    IF v_ref IS NULL THEN
      SELECT 'المورد رجّع الفلوس دي بسند ' || COALESCE(vv.voucher_number, '') || ' — الغي سند الاسترداد الأول' INTO v_ref
        FROM shipments s JOIN vouchers vv ON vv.treasury_id = s.refund_treasury_id AND vv.status = 'active'
       WHERE s.id = v_ship AND s.money_action = 'refund' LIMIT 1;
    END IF;
    IF v_ref IS NOT NULL THEN RETURN jsonb_build_object('kind', 'blocked', 'message', v_ref); END IF;
    RETURN jsonb_build_object('kind', 'payment_transaction', 'id', pt.id);
  END IF;
  IF COALESCE(t.is_fee, false) OR EXISTS (SELECT 1 FROM payment_transactions x WHERE x.fee_treasury_id = t.id) THEN
    RETURN jsonb_build_object('kind', 'none');
  END IF;

  -- a direct payment on a sale invoice
  IF t.type = 'income' AND t.reference_id IS NOT NULL AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = t.reference_id) THEN
    SELECT * INTO ip FROM invoice_payments x
     WHERE x.invoice_id = t.reference_id AND x.voided_at IS NULL AND x.reverses_payment_id IS NULL AND x.amount = t.amount
       AND x.payment_method NOT IN ('credit_balance', 'credit_applied', 'settlement')
     ORDER BY (x.created_at = t.created_at) DESC, abs(extract(epoch FROM x.created_at - t.created_at)) LIMIT 1;
    IF FOUND THEN
      SELECT 'السند ده اترد للعميل بسند الرد ' || COALESCE(vv.voucher_number, '') || ' — الغي سند الرد الأول' INTO v_ref
        FROM invoices i JOIN treasury rt ON rt.reference_id = i.id AND rt.category = 'sales_refund'
        JOIN vouchers vv ON vv.treasury_id = rt.id AND vv.status = 'active'
       WHERE i.id = ip.invoice_id AND i.status = 'cancelled' AND i.refund_method = 'cash' LIMIT 1;
      IF v_ref IS NOT NULL THEN RETURN jsonb_build_object('kind', 'blocked', 'message', v_ref); END IF;
      RETURN jsonb_build_object('kind', 'invoice_payment', 'id', ip.id);
    END IF;
  END IF;
  RETURN jsonb_build_object('kind', 'none');
END $$;
REVOKE ALL ON FUNCTION public.voucher_payment_link(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- cancel_voucher: a payment's voucher cancels the payment
DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.cancel_voucher(uuid,text)'::regprocedure);
  IF position('voucher_payment_link' in d) = 0 THEN
    d := replace(d, $q$  uname TEXT; v_cat_key TEXT; v_advance_id UUID; v_paid_count INT;$q$,
                    $q$  uname TEXT; v_cat_key TEXT; v_advance_id UUID; v_paid_count INT; v_link jsonb;$q$);
    d := replace(d, $q$  -- 0084: the reversal and the journal reversal sit on the voucher's own date$q$,
      $q$  -- 0085: a voucher that carries a payment is cancelled AS that payment (till, payment, document, plan, ledger)
  IF v.treasury_id IS NOT NULL AND COALESCE(current_setting('app.voucher_plain_cancel', true), '') <> '1' THEN
    v_link := public.voucher_payment_link(v.treasury_id);
    IF v_link->>'kind' = 'blocked' THEN RAISE EXCEPTION '%', v_link->>'message'; END IF;
    IF v_link->>'kind' IN ('payment_transaction', 'invoice_payment', 'sales_refund', 'purchase_refund') THEN
      IF v_link->>'kind' = 'payment_transaction' THEN
        PERFORM public._void_payment_transaction_exec((v_link->>'id')::uuid, p_reason);
      ELSIF v_link->>'kind' = 'invoice_payment' THEN
        PERFORM set_config('app.void_treasury_target', v.treasury_id::text, true);
        PERFORM public.void_invoice_payment((v_link->>'id')::uuid, p_reason);
        PERFORM set_config('app.void_treasury_target', '', true);
      ELSE
        -- the refund did not happen: the money stays on the contact's account (walk-in: with the company)
        PERFORM public.till_cancel_on_original_date(v.treasury_id, p_reason);
        IF v_link->>'kind' = 'sales_refund' THEN
          UPDATE invoices SET refund_method = CASE WHEN contact_id IS NOT NULL THEN 'credit' ELSE 'none' END,
                              refund_amount = CASE WHEN contact_id IS NOT NULL THEN refund_amount ELSE 0 END,
                              refund_pay_method = NULL
           WHERE id = (v_link->>'id')::uuid;
        ELSE
          PERFORM set_config('app.shipment_money', 'on', true);
          UPDATE shipments SET money_action = 'credit', refund_amount = 0, refund_pay_method = NULL
           WHERE id = (v_link->>'id')::uuid;
          PERFORM set_config('app.shipment_money', '', true);
        END IF;
      END IF;
      SELECT name INTO uname FROM profiles WHERE id = auth.uid();
      INSERT INTO audit_log (user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
      VALUES (auth.uid(), COALESCE(uname,'?'), v.tenant_id, v.branch_id, 'CANCEL', 'voucher', v.id::text,
              jsonb_build_object('voucher_number', v.voucher_number, 'reason', p_reason, 'treasury_reversed', true,
                                 'cancelled_as', v_link->>'kind', 'source_id', v_link->>'id'));
      RETURN;
    END IF;
  END IF;

  -- 0084: the reversal and the journal reversal sit on the voucher's own date$q$);
    IF position('voucher_payment_link' in d) = 0 THEN RAISE EXCEPTION '0085: cancel_voucher patch failed'; END IF;
    EXECUTE d;
  END IF;
END $x$;

-- ---------------------------------------------------------------- void paths: cancelled documents, exact till row
DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public._void_payment_transaction_exec(uuid,text)'::regprocedure);
  IF position('0085' in d) = 0 THEN
    d := replace(d, $q$  IF v_tx.payment_plan_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.payment_plans pp WHERE pp.id = v_tx.payment_plan_id AND pp.status = 'cancelled') THEN
    RAISE EXCEPTION 'خطة الدفع اتلغت مع المستند — فلوسها اتسوت في الإلغاء';
  END IF;
  IF v_tx.direction = 'in' AND EXISTS (
       SELECT 1 FROM public.invoices i
        WHERE i.id = COALESCE(v_tx.invoice_id, CASE WHEN v_ref_type = 'invoice' THEN v_ref_id END)
          AND i.status = 'cancelled' AND i.refund_method IN ('cash', 'credit') AND COALESCE(i.refund_amount, 0) > 0) THEN
    RAISE EXCEPTION 'الفاتورة اتلغت واترد مبلغها بالفعل — مينفعش تلغي الدفعة كمان';
  END IF;$q$,
      $q$  -- 0085: a payment of a cancelled document can be cancelled while its money stayed on account; not after it was
  --       given back (cancel the refund voucher first)
  IF v_tx.direction = 'in' AND EXISTS (
       SELECT 1 FROM public.invoices i
        WHERE i.id = COALESCE(v_tx.invoice_id, CASE WHEN v_ref_type = 'invoice' THEN v_ref_id END)
          AND i.status = 'cancelled' AND i.refund_method = 'cash' AND COALESCE(i.refund_amount, 0) > 0) THEN
    RAISE EXCEPTION 'الفاتورة اتلغت واترد مبلغها بسند رد — الغي سند الرد الأول';
  END IF;
  IF v_tx.direction = 'out' AND v_ref_type = 'shipment' AND EXISTS (
       SELECT 1 FROM public.shipments s WHERE s.id = v_ref_id AND s.status = 'cancelled' AND s.money_action = 'refund') THEN
    RAISE EXCEPTION 'فاتورة الشراء اتلغت والمورد رجّع فلوسها — الغي سند الاسترداد الأول';
  END IF;$q$);
    d := replace(d, $q$  IF v_tx.payment_plan_id IS NOT NULL THEN
    PERFORM public.plan_recompute(v_tx.payment_plan_id);
  END IF;$q$, $q$  IF v_tx.payment_plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.payment_plans pp WHERE pp.id = v_tx.payment_plan_id AND pp.status = 'cancelled') THEN
    PERFORM public.plan_recompute(v_tx.payment_plan_id);
  END IF;
  -- 0085: what a cancelled invoice put on account shrinks with the cancelled payment
  IF v_tx.direction = 'in' THEN
    UPDATE public.invoices i
       SET refund_amount = CASE WHEN i.refund_method = 'credit' THEN GREATEST(COALESCE(i.refund_amount, 0) - v_tx.amount, 0) ELSE i.refund_amount END,
           total_paid_before_cancel = GREATEST(COALESCE(i.total_paid_before_cancel, 0) - v_tx.amount, 0)
     WHERE i.id = COALESCE(v_tx.invoice_id, CASE WHEN v_ref_type = 'invoice' THEN v_ref_id END) AND i.status = 'cancelled';
  END IF;$q$);
    IF position('الغي سند الرد الأول' in d) = 0 OR position('0085: what a cancelled invoice' in d) = 0 THEN
      RAISE EXCEPTION '0085: _void_payment_transaction_exec patch failed';
    END IF;
    EXECUTE d;
  END IF;

  d := pg_get_functiondef('public.void_invoice_payment(uuid,text)'::regprocedure);
  IF position('void_treasury_target' in d) = 0 THEN
    d := replace(d, $q$      ORDER BY (t.created_at = v_pay.created_at) DESC, abs(extract(epoch FROM t.created_at - v_pay.created_at)) LIMIT 1),
    'إلغاء دفعة على فاتورة '$q$, $q$      ORDER BY (t.id::text = COALESCE(current_setting('app.void_treasury_target', true), '')) DESC,
               (t.created_at = v_pay.created_at) DESC, abs(extract(epoch FROM t.created_at - v_pay.created_at)) LIMIT 1),
    'إلغاء دفعة على فاتورة '$q$);
    d := replace(d, $q$  SELECT * INTO v_inv FROM public.invoices WHERE id = v_pay.invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;$q$, $q$  SELECT * INTO v_inv FROM public.invoices WHERE id = v_pay.invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  -- 0085: not after the money was given back by a refund voucher
  IF v_inv.status = 'cancelled' AND v_inv.refund_method = 'cash' AND COALESCE(v_inv.refund_amount, 0) > 0 THEN
    RAISE EXCEPTION 'الفاتورة اتلغت واترد مبلغها بسند رد — الغي سند الرد الأول';
  END IF;$q$);
    d := replace(d, $q$  -- Mark original as voided$q$, $q$  -- 0085: what a cancelled invoice put on account shrinks with the cancelled payment
  IF v_inv.status = 'cancelled' THEN
    UPDATE public.invoices i
       SET refund_amount = CASE WHEN i.refund_method = 'credit' THEN GREATEST(COALESCE(i.refund_amount, 0) - v_pay.amount, 0) ELSE i.refund_amount END,
           total_paid_before_cancel = GREATEST(COALESCE(i.total_paid_before_cancel, 0) - v_pay.amount, 0)
     WHERE i.id = v_inv.id;
  END IF;

  -- Mark original as voided$q$);
    IF position('void_treasury_target' in d) = 0 OR position('0085: not after' in d) = 0 OR position('0085: what a cancelled' in d) = 0 THEN
      RAISE EXCEPTION '0085: void_invoice_payment patch failed';
    END IF;
    EXECUTE d;
  END IF;
END $x$;

-- ---------------------------------------------------------------- contact-file settlement: oldest first, always
DO $x$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.settle_contact_invoices_sovereign(uuid,numeric,text,uuid,jsonb,text)'::regprocedure);
  IF position('0085' in d) = 0 THEN
    d := replace(d, $q$  IF p_selected_invoices IS NOT NULL AND jsonb_typeof(p_selected_invoices) = 'array' AND jsonb_array_length(p_selected_invoices) > 0 THEN$q$,
                    $q$  -- 0085 (owner rule): paying from the contact file always settles the oldest invoice first; no selection
  IF false THEN$q$);
    IF position('0085' in d) = 0 THEN RAISE EXCEPTION '0085: settle_contact_invoices_sovereign patch failed'; END IF;
    EXECUTE d;
  END IF;

  d := pg_get_functiondef('public.plan_recompute_supplier_spread(uuid)'::regprocedure);
  IF position('0085' in d) = 0 THEN
    d := replace(d, $q$                 ORDER BY created_at, id LOOP$q$,
                    $q$                 ORDER BY (SELECT COALESCE(s.invoice_date, s.created_at) FROM shipments s   -- 0085: oldest invoice first
                            WHERE payment_plans.reference_type = 'shipment' AND s.id = payment_plans.reference_id) NULLS LAST,
                          created_at, id LOOP$q$);
    IF position('0085' in d) = 0 THEN RAISE EXCEPTION '0085: plan_recompute_supplier_spread patch failed'; END IF;
    EXECUTE d;
  END IF;

  -- edit_invoice never rewrites or removes till rows; payments change only through the payment edit / void paths
  d := pg_get_functiondef('public.edit_invoice(uuid,uuid,jsonb,numeric,numeric)'::regprocedure);
  IF position('PERFORM public.sync_invoice_cash_treasury(_invoice_id);' in d) > 0 THEN
    d := replace(d, 'PERFORM public.sync_invoice_cash_treasury(_invoice_id);',
                    '-- 0085: the till is not touched here (payments change only through edit / void of the payment)');
    EXECUTE d;
  END IF;

  -- approval requests carry the money choice
  d := pg_get_functiondef('public.process_approval_request()'::regprocedure);
  IF position('payload->>''money_action''' in d) = 0 THEN
    d := replace(d, $q$cancel_invoice_with_refund(NEW.entity_id, COALESCE(NEW.admin_note, NEW.reason, 'إلغاء بموافقة الإدارة'), 'none');$q$,
                    $q$cancel_invoice_with_refund(NEW.entity_id, COALESCE(NEW.admin_note, NEW.reason, 'إلغاء بموافقة الإدارة'),
                       COALESCE(NEW.payload->>'refund_method', 'none'), COALESCE(NEW.payload->>'refund_pay_method', 'cash'));$q$);
    d := replace(d, $q$cancel_purchase_invoice(NEW.entity_id, COALESCE(NEW.admin_note, NEW.reason, 'إلغاء بموافقة الإدارة'));$q$,
                    $q$cancel_purchase_invoice(NEW.entity_id, COALESCE(NEW.admin_note, NEW.reason, 'إلغاء بموافقة الإدارة'),
                       COALESCE(NEW.payload->>'money_action', 'credit'), COALESCE(NEW.payload->>'refund_method', 'cash'));$q$);
    IF position('payload->>''money_action''' in d) = 0 OR position('payload->>''refund_pay_method''' in d) = 0 THEN
      RAISE EXCEPTION '0085: process_approval_request patch failed';
    END IF;
    EXECUTE d;
  END IF;
END $x$;

CREATE OR REPLACE FUNCTION public.sync_invoice_cash_treasury(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- 0085: retired. It rewrote till amounts and removed till rows to match the invoice payments (IN03486).
  RETURN;
END $$;
REVOKE ALL ON FUNCTION public.sync_invoice_cash_treasury(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- contact picker: the whole company
DO $x$ BEGIN EXECUTE 'DR' || 'OP FUNCTION IF EXISTS public.search_branch_contacts(uuid, text, text, integer, uuid[])'; END $x$;
CREATE OR REPLACE FUNCTION public.search_branch_contacts(p_branch_id uuid, p_kind text DEFAULT 'any', p_query text DEFAULT NULL,
                                                         p_limit integer DEFAULT 50, p_ids uuid[] DEFAULT NULL, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, name text, phone text, type text, branch_id uuid, branch_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE v_tenant uuid := public.current_tenant_id(); v_toks text[];
BEGIN
  -- 0085 (owner rule): every customer / supplier of the company can be picked on a document; only name, phone and
  -- branch are shown here (balances and movements of other branches stay behind their own readers)
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  v_toks := array_remove(regexp_split_to_array(public.normalize_search_text(p_query), '\s+'), '');
  RETURN QUERY
  SELECT c.id, c.name, c.phone, c.type::text, c.branch_id, b.name
    FROM contacts c LEFT JOIN branches b ON b.id = c.branch_id
   WHERE c.tenant_id = v_tenant
     AND (
       (p_ids IS NOT NULL AND c.id = ANY (p_ids))
       OR (p_ids IS NULL AND c.is_archived = false
           AND (p_kind = 'any' OR c.type::text IN (p_kind, 'both'))
           AND (COALESCE(cardinality(v_toks), 0) = 0
                OR NOT EXISTS (SELECT 1 FROM unnest(v_toks) tk
                                WHERE public.normalize_search_text(coalesce(c.name,'') || ' ' || coalesce(c.phone,'') || ' ' || coalesce(c.contact_person,''))
                                      NOT LIKE '%' || tk || '%')))
     )
   ORDER BY (c.branch_id = p_branch_id) DESC NULLS LAST, c.name, c.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200) OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END $$;
REVOKE ALL ON FUNCTION public.search_branch_contacts(uuid, text, text, integer, uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_branch_contacts(uuid, text, text, integer, uuid[], integer) TO authenticated;

INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('document_cancel_preview', '0085', 'read: money on a sale / purchase invoice before cancelling (paid on it, back to account, option 3)'),
  ('cancel_invoice_with_refund', '0085', 'cancel a sale invoice: money to account / refund / never real (void on the original day)'),
  ('cancel_purchase_invoice', '0085', 'cancel a purchase invoice: money stays with the supplier / he refunds it / never real'),
  ('search_branch_contacts', '0085', 'contact picker: every customer / supplier of the company (name, phone, branch), paged')
ON CONFLICT DO NOTHING;
