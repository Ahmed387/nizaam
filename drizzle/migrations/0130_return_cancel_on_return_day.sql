-- 0130: cancelling a return gives its money back on the RETURN's own day (owner choice «أ», 2026-10-28)
--
-- cancel_sale_return / cancel_purchase_return removed the return's journal from the return day but wrote the money
-- coming back (sale: into the till; purchase: out of it) on the cancel day — the treasury column default is «today»:
-- SR00077 (4,600 cash on 10/8, cancelled 19/10) left August's till 4,600 short while August's books had no return.
-- Now the till row is dated the return's day (a closed period moves it to the first open day, ledger_effective_date),
-- like voucher cancellations (0084): the return reads as if it never happened, in the till and in the books.
-- The three old ones move: SR00070 (1,150: 16/10 → 31/1), SR00073 (1,300: 19/10 → 18/8), SR00077 (4,600: 19/10 → 10/8),
-- through their vouchers' date (the till row follows — sync_treasury_date_from_voucher).

CREATE OR REPLACE FUNCTION public.cancel_sale_return(_return_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; it record; v_money numeric; v_qty numeric := 0; v_avail numeric;
  v_docnum text; v_branch text; v_actor text; v_tid uuid; v_day date;
BEGIN
  -- SEC-003 guard (migration 0051)
  PERFORM public.assert_access((SELECT gr.branch_id FROM public.returns gr WHERE gr.id = _return_id), NULL);

  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'لازم تكتب سبب الإلغاء';
  END IF;

  SELECT * INTO r FROM public.returns WHERE id = _return_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'المرتجع مش موجود'; END IF;
  IF COALESCE(r.status,'active') <> 'active' THEN
    RAISE EXCEPTION 'المرتجع ده متلغي بالفعل';
  END IF;
  IF NOT public.is_return_canceller(auth.uid(), r.tenant_id) THEN
    RAISE EXCEPTION 'إلغاء المرتجع مسموح للمالك بس';
  END IF;

  -- Guard 1: stock must still be available (returned pieces must not have been re-sold)
  FOR it IN SELECT product_id, quantity FROM public.return_items WHERE return_id = _return_id AND product_id IS NOT NULL LOOP
    SELECT quantity INTO v_avail FROM public.products WHERE id = it.product_id FOR UPDATE;
    IF COALESCE(v_avail,0) < it.quantity THEN
      RAISE EXCEPTION 'مينفعش تلغي — الكمية اللي رجعت اتباعت تاني (المتاح % والمطلوب سحبه %)', COALESCE(v_avail,0), it.quantity;
    END IF;
  END LOOP;

  -- Reverse stock
  FOR it IN SELECT product_id, quantity FROM public.return_items WHERE return_id = _return_id AND product_id IS NOT NULL LOOP
    UPDATE public.products SET quantity = quantity - it.quantity WHERE id = it.product_id;
    v_qty := v_qty + it.quantity;
  END LOOP;

  -- Reverse treasury: money that went out to the customer comes back in
  v_money := COALESCE(r.refund_cash_amount,0) + COALESCE(r.refund_transfer_amount,0);
  -- the part a voided refund voucher already put back is not reversed again (0096)
  v_money := GREATEST(v_money - COALESCE((
    SELECT sum(t2.amount) FROM public.treasury t
      JOIN public.vouchers vv ON vv.treasury_id = t.id
      JOIN public.treasury t2 ON t2.reference_id = vv.id AND t2.category = 'إلغاء سند'
     WHERE t.reference_id = r.id AND t.category NOT IN ('إلغاء سند', 'return_cancel', 'purchase_return_cancel')), 0), 0);
  IF v_money > 0 THEN
    -- 0130: on the return's own day
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id,
                                created_by, tenant_id, payment_method, reference_number, transaction_date)
    VALUES (r.branch_id, 'income', 'return_cancel', v_money,
            'إلغاء مرتجع بيع ' || COALESCE(r.return_number,''), r.id, auth.uid(), r.tenant_id,
            r.refund_method, r.refund_reference,
            public.ledger_effective_date(r.tenant_id, (COALESCE(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date))
    RETURNING id INTO v_tid;
    -- the till row's voucher is made «today» and drags the row with it: put both on the return's day
    v_day := public.ledger_effective_date(r.tenant_id, (COALESCE(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date);
    UPDATE public.vouchers SET voucher_date = v_day WHERE treasury_id = v_tid AND voucher_date IS DISTINCT FROM v_day;
    UPDATE public.treasury SET transaction_date = v_day WHERE id = v_tid AND transaction_date IS DISTINCT FROM v_day;
  END IF;

  -- Guard 2 (closed period) is enforced by the existing update trigger
  UPDATE public.returns
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(_reason)
   WHERE id = _return_id;

  PERFORM public._audit_write(r.tenant_id, 'sale_return', r.id, COALESCE(r.return_number,''),
                              'cancel', COALESCE(r.total_refund,0), 0, r.branch_id, btrim(_reason), 'manual', v_qty);

  SELECT i.invoice_number INTO v_docnum FROM public.invoices i WHERE i.id = r.invoice_id;
  SELECT b.name INTO v_branch FROM public.branches b WHERE b.id = r.branch_id;
  SELECT p.name INTO v_actor FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public.notifications(tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
  SELECT r.tenant_id, ur.user_id,
         '↩️ اتلغى مرتجع بيع',
         'مرتجع ' || COALESCE(r.return_number,'') || ' على فاتورة ' || COALESCE(v_docnum,'—') ||
         ' بقيمة ' || COALESCE(r.total_refund,0) || ' ج — فرع ' || COALESCE(v_branch,'—') ||
         ' — ألغاه ' || COALESCE(v_actor,'—') || ' — السبب: ' || btrim(_reason),
         'general', '/branch/' || r.branch_id || '/invoices?tab=sale_return', 'sale_return', r.id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE p.tenant_id = r.tenant_id AND ur.role::text IN ('owner','admin');

  RETURN jsonb_build_object('ok', true, 'money_back', v_money, 'debt_restored', COALESCE(r.refund_balance_amount,0), 'qty_pulled', v_qty);
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_purchase_return(_return_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; it record; v_money numeric; v_qty numeric := 0; v_batch uuid;
  v_branch text; v_actor text; v_docnum text; v_tid uuid; v_day date;
BEGIN
  -- SEC-003 guard (migration 0051)
  PERFORM public.assert_access((SELECT pr.branch_id FROM public.purchase_returns pr WHERE pr.id = _return_id), NULL);

  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'لازم تكتب سبب الإلغاء';
  END IF;

  SELECT * INTO r FROM public.purchase_returns WHERE id = _return_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'المرتجع مش موجود'; END IF;
  IF COALESCE(r.status,'active') <> 'active' THEN
    RAISE EXCEPTION 'المرتجع ده متلغي بالفعل';
  END IF;
  IF NOT public.is_return_canceller(auth.uid(), r.tenant_id) THEN
    RAISE EXCEPTION 'إلغاء المرتجع مسموح للمالك بس';
  END IF;

  -- Reverse stock: put the pieces back (source shipment batch first)
  FOR it IN SELECT product_id, quantity FROM public.purchase_return_items WHERE purchase_return_id = _return_id LOOP
    v_batch := NULL;
    IF r.shipment_id IS NOT NULL THEN
      SELECT id INTO v_batch FROM public.product_batches
       WHERE product_id = it.product_id AND shipment_id = r.shipment_id AND branch_id = r.branch_id
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    END IF;
    IF v_batch IS NULL THEN
      SELECT id INTO v_batch FROM public.product_batches
       WHERE product_id = it.product_id AND branch_id = r.branch_id AND batch_type = 'purchase'
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    END IF;
    IF v_batch IS NOT NULL THEN
      UPDATE public.product_batches SET quantity_remaining = quantity_remaining + it.quantity WHERE id = v_batch;
    END IF;
    UPDATE public.products SET quantity = quantity + it.quantity WHERE id = it.product_id;
    v_qty := v_qty + it.quantity;
  END LOOP;

  -- Reverse treasury: money the supplier refunded goes back out (blocked if balance insufficient)
  v_money := COALESCE(r.refund_cash_amount,0) + COALESCE(r.refund_transfer_amount,0);
  -- the part a voided refund voucher already put back is not reversed again (0096)
  v_money := GREATEST(v_money - COALESCE((
    SELECT sum(t2.amount) FROM public.treasury t
      JOIN public.vouchers vv ON vv.treasury_id = t.id
      JOIN public.treasury t2 ON t2.reference_id = vv.id AND t2.category = 'إلغاء سند'
     WHERE t.reference_id = r.id AND t.category NOT IN ('إلغاء سند', 'return_cancel', 'purchase_return_cancel')), 0), 0);
  IF v_money > 0 THEN
    -- 0130: on the return's own day
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id,
                                created_by, tenant_id, payment_method, reference_number, transaction_date)
    VALUES (r.branch_id, 'expense', 'purchase_return_cancel', v_money,
            'إلغاء مرتجع شراء ' || COALESCE(r.return_number,''), r.id, auth.uid(), r.tenant_id,
            r.refund_method, r.refund_reference,
            public.ledger_effective_date(r.tenant_id, (COALESCE(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date))
    RETURNING id INTO v_tid;
    -- the till row's voucher is made «today» and drags the row with it: put both on the return's day
    v_day := public.ledger_effective_date(r.tenant_id, (COALESCE(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date);
    UPDATE public.vouchers SET voucher_date = v_day WHERE treasury_id = v_tid AND voucher_date IS DISTINCT FROM v_day;
    UPDATE public.treasury SET transaction_date = v_day WHERE id = v_tid AND transaction_date IS DISTINCT FROM v_day;
  END IF;

  UPDATE public.purchase_returns
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(_reason)
   WHERE id = _return_id;

  PERFORM public._audit_write(r.tenant_id, 'purchase_return', r.id, COALESCE(r.return_number,''),
                              'cancel', COALESCE(r.total_amount,0), 0, r.branch_id, btrim(_reason), 'manual', v_qty);

  SELECT s.shipment_number INTO v_docnum FROM public.shipments s WHERE s.id = r.shipment_id;
  SELECT b.name INTO v_branch FROM public.branches b WHERE b.id = r.branch_id;
  SELECT p.name INTO v_actor FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public.notifications(tenant_id, user_id, title, body, type, link, related_entity, related_entity_id)
  SELECT r.tenant_id, ur.user_id,
         '↩️ اتلغى مرتجع شراء',
         'مرتجع ' || COALESCE(r.return_number,'') || ' على شحنة ' || COALESCE(v_docnum,'—') ||
         ' بقيمة ' || COALESCE(r.total_amount,0) || ' ج — فرع ' || COALESCE(v_branch,'—') ||
         ' — ألغاه ' || COALESCE(v_actor,'—') || ' — السبب: ' || btrim(_reason),
         'general', '/branch/' || r.branch_id || '/invoices?tab=purchase_return', 'purchase_return', r.id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE p.tenant_id = r.tenant_id AND ur.role::text IN ('owner','admin');

  RETURN jsonb_build_object('ok', true, 'money_out', v_money, 'payable_restored', COALESCE(r.refund_balance_amount,0), 'qty_returned', v_qty);
END $function$;

-- the three cancelled cash returns: their «إلغاء مرتجع» money moves to the return's day
UPDATE public.vouchers v
   SET voucher_date = public.ledger_effective_date(t.tenant_id, (COALESCE(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date)
  FROM public.treasury t
  JOIN public.returns r ON r.id = t.reference_id
 WHERE v.treasury_id = t.id AND t.category = 'return_cancel'
   AND v.voucher_date <> public.ledger_effective_date(t.tenant_id, (COALESCE(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date);
UPDATE public.vouchers v
   SET voucher_date = public.ledger_effective_date(t.tenant_id, (COALESCE(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date)
  FROM public.treasury t
  JOIN public.purchase_returns r ON r.id = t.reference_id
 WHERE v.treasury_id = t.id AND t.category = 'purchase_return_cancel'
   AND v.voucher_date <> public.ledger_effective_date(t.tenant_id, (COALESCE(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date);
-- a till row without a voucher follows directly
UPDATE public.treasury t
   SET transaction_date = public.ledger_effective_date(t.tenant_id, (COALESCE(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date)
  FROM public.returns r
 WHERE r.id = t.reference_id AND t.category = 'return_cancel'
   AND t.transaction_date <> public.ledger_effective_date(t.tenant_id, (COALESCE(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date);
UPDATE public.treasury t
   SET transaction_date = public.ledger_effective_date(t.tenant_id, (COALESCE(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date)
  FROM public.purchase_returns r
 WHERE r.id = t.reference_id AND t.category = 'purchase_return_cancel'
   AND t.transaction_date <> public.ledger_effective_date(t.tenant_id, (COALESCE(r.invoice_date, r.created_at) AT TIME ZONE 'Africa/Cairo')::date);
