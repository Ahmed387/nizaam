ALTER TABLE public.returns
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.purchase_returns
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- Owner-only check helper
CREATE OR REPLACE FUNCTION public.is_return_canceller(_uid uuid, _tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant AND t.owner_user_id = _uid)
      OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role::text = 'owner')
      OR public.is_super_admin(_uid);
$$;

-- ============ CANCEL SALE RETURN ============
CREATE OR REPLACE FUNCTION public.cancel_sale_return(_return_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record; it record; v_money numeric; v_qty numeric := 0; v_avail numeric;
  v_docnum text; v_branch text; v_actor text;
BEGIN
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
  IF v_money > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id,
                                created_by, tenant_id, payment_method, reference_number)
    VALUES (r.branch_id, 'income', 'return_cancel', v_money,
            'إلغاء مرتجع بيع ' || COALESCE(r.return_number,''), r.id, auth.uid(), r.tenant_id,
            r.refund_method, r.refund_reference);
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
END $$;

-- ============ CANCEL PURCHASE RETURN ============
CREATE OR REPLACE FUNCTION public.cancel_purchase_return(_return_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record; it record; v_money numeric; v_qty numeric := 0; v_batch uuid;
  v_branch text; v_actor text; v_docnum text;
BEGIN
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
  IF v_money > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id,
                                created_by, tenant_id, payment_method, reference_number)
    VALUES (r.branch_id, 'expense', 'purchase_return_cancel', v_money,
            'إلغاء مرتجع شراء ' || COALESCE(r.return_number,''), r.id, auth.uid(), r.tenant_id,
            r.refund_method, r.refund_reference);
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
END $$;

REVOKE ALL ON FUNCTION public.cancel_sale_return(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.cancel_purchase_return(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_sale_return(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_return(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_return_canceller(uuid, uuid) TO authenticated;