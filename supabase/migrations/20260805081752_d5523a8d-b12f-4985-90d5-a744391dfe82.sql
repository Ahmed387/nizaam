-- ============================================================
-- 1) Single owner for products.quantity on invoice_items delete,
--    and make it aware of already-returned quantities.
-- ============================================================
CREATE OR REPLACE FUNCTION public.reverse_invoice_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.product_id IS NOT NULL THEN
      UPDATE public.products
         SET quantity = quantity + GREATEST(OLD.quantity - COALESCE(OLD.returned_quantity, 0), 0)
       WHERE id = OLD.product_id;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.product_id IS NOT NULL AND OLD.product_id = NEW.product_id THEN
      UPDATE public.products
         SET quantity = quantity + (OLD.quantity - NEW.quantity)
       WHERE id = NEW.product_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END $function$;

-- ============================================================
-- 2) Batch restore must be scaled to the un-returned portion
-- ============================================================
CREATE OR REPLACE FUNCTION public.restore_batches_from_item(_invoice_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  it record; bc jsonb; v_batch_id uuid; v_qty numeric; v_cost numeric;
  v_exists boolean; new_batch_id uuid; v_ratio numeric;
BEGIN
  SELECT ii.*, i.branch_id, i.tenant_id INTO it
    FROM public.invoice_items ii JOIN public.invoices i ON i.id = ii.invoice_id
   WHERE ii.id = _invoice_item_id;

  IF it.batches_consumed IS NULL OR jsonb_array_length(it.batches_consumed) = 0 THEN RETURN; END IF;
  IF COALESCE(it.quantity, 0) <= 0 THEN RETURN; END IF;

  -- only the part that is still "out" (not already restored by a return)
  v_ratio := GREATEST(it.quantity - COALESCE(it.returned_quantity, 0), 0)::numeric / it.quantity::numeric;
  IF v_ratio <= 0 THEN RETURN; END IF;

  FOR bc IN
    SELECT value FROM jsonb_array_elements(it.batches_consumed) WITH ORDINALITY arr(value, ord) ORDER BY ord DESC
  LOOP
    v_batch_id := NULLIF(bc->>'batch_id','')::uuid;
    v_qty := ROUND(COALESCE((bc->>'qty_taken')::numeric, 0) * v_ratio, 4);
    v_cost := COALESCE((bc->>'cost_price')::numeric, COALESCE(it.original_unit_cost, it.unit_cost_at_sale, 0));
    IF v_qty <= 0 THEN CONTINUE; END IF;

    SELECT EXISTS(SELECT 1 FROM public.product_batches WHERE id = v_batch_id) INTO v_exists;
    IF v_exists THEN
      UPDATE public.product_batches
         SET quantity_remaining = quantity_remaining + v_qty,
             restore_count = restore_count + 1, last_restored_at = now()
       WHERE id = v_batch_id;
    ELSE
      INSERT INTO public.product_batches(
        tenant_id, branch_id, product_id, quantity_purchased, quantity_remaining,
        cost_price, base_purchase_price, true_unit_cost, batch_type, restore_count, last_restored_at)
      VALUES (it.tenant_id, it.branch_id, it.product_id, v_qty, v_qty,
        v_cost, v_cost, v_cost, 'return_restored', 1, now())
      RETURNING id INTO new_batch_id;
      BEGIN
        INSERT INTO public.audit_log(action, entity_type, entity_id, tenant_id, branch_id, details)
        VALUES ('batch_restored_missing', 'product_batches', new_batch_id, it.tenant_id, it.branch_id,
                jsonb_build_object('original_batch_id', v_batch_id, 'invoice_item_id', _invoice_item_id,
                                   'qty', v_qty, 'cost_price', v_cost));
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END LOOP;
END; $function$;

-- ============================================================
-- 3) Cancel path: restore batches AND products.quantity, net of returns
-- ============================================================
CREATE OR REPLACE FUNCTION public.restore_invoice_batches(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE it RECORD; v_net numeric;
BEGIN
  FOR it IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
    v_net := GREATEST(COALESCE(it.quantity,0) - COALESCE(it.returned_quantity,0), 0);
    IF v_net <= 0 THEN CONTINUE; END IF;
    IF it.batches_consumed IS NOT NULL AND jsonb_array_length(it.batches_consumed) > 0 THEN
      PERFORM public.restore_batches_from_item(it.id);
    END IF;
    IF it.product_id IS NOT NULL THEN
      UPDATE public.products SET quantity = quantity + v_net WHERE id = it.product_id;
    END IF;
  END LOOP;
END $function$;

-- ============================================================
-- 4) Line-level data validation (all creation paths)
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_invoice_item()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE v_gross numeric;
BEGIN
  IF COALESCE(NEW.quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'كمية الصنف "%" لازم تكون أكبر من صفر', COALESCE(NEW.product_name,'');
  END IF;
  IF COALESCE(NEW.selling_price, 0) < 0 THEN
    RAISE EXCEPTION 'سعر بيع الصنف "%" لا يمكن أن يكون سالباً', COALESCE(NEW.product_name,'');
  END IF;
  IF COALESCE(NEW.cost_price, 0) < 0 THEN
    RAISE EXCEPTION 'تكلفة الصنف "%" لا يمكن أن تكون سالبة', COALESCE(NEW.product_name,'');
  END IF;
  v_gross := COALESCE(NEW.quantity,0) * COALESCE(NEW.selling_price,0);
  IF COALESCE(NEW.line_discount, 0) < 0 THEN
    RAISE EXCEPTION 'خصم الصنف "%" لا يمكن أن يكون سالباً', COALESCE(NEW.product_name,'');
  END IF;
  IF COALESCE(NEW.line_discount, 0) > v_gross + 0.01 THEN
    RAISE EXCEPTION 'خصم الصنف "%" أكبر من قيمة البند', COALESCE(NEW.product_name,'');
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_validate_invoice_item ON public.invoice_items;
CREATE TRIGGER trg_validate_invoice_item
BEFORE INSERT OR UPDATE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.validate_invoice_item();

CREATE OR REPLACE FUNCTION public.validate_shipment_item()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF COALESCE(NEW.quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'كمية الصنف "%" في فاتورة الشراء لازم تكون أكبر من صفر', COALESCE(NEW.product_name,'');
  END IF;
  IF COALESCE(NEW.cost_price, 0) < 0 THEN
    RAISE EXCEPTION 'تكلفة الصنف "%" لا يمكن أن تكون سالبة', COALESCE(NEW.product_name,'');
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_validate_shipment_item ON public.shipment_items;
CREATE TRIGGER trg_validate_shipment_item
BEFORE INSERT OR UPDATE ON public.shipment_items
FOR EACH ROW EXECUTE FUNCTION public.validate_shipment_item();

-- ============================================================
-- 5) Treasury sync: ignore voided payments, match by method
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_invoice_cash_treasury(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  inv record; v_pay numeric[]; v_tid uuid[]; i int; n_pay int; n_row int;
BEGIN
  SELECT id, invoice_number, branch_id, tenant_id INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv.id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(array_agg(amount ORDER BY created_at, id), '{}') INTO v_pay
  FROM public.invoice_payments
  WHERE invoice_id = _invoice_id
    AND voided_at IS NULL AND reverses_payment_id IS NULL
    AND LOWER(COALESCE(payment_method, 'cash')) = 'cash';

  SELECT COALESCE(array_agg(id ORDER BY created_at, id), '{}') INTO v_tid
  FROM public.treasury
  WHERE reference_id = _invoice_id AND type = 'income'
    AND LOWER(COALESCE(payment_method, 'cash')) = 'cash';

  n_pay := COALESCE(array_length(v_pay, 1), 0);
  n_row := COALESCE(array_length(v_tid, 1), 0);

  FOR i IN 1..GREATEST(n_pay, n_row) LOOP
    IF i <= n_pay AND i <= n_row THEN
      UPDATE public.treasury SET amount = v_pay[i], description = 'فاتورة ' || inv.invoice_number WHERE id = v_tid[i];
    ELSIF i <= n_pay THEN
      INSERT INTO public.treasury (branch_id, tenant_id, type, category, amount, description, reference_id, payment_method, created_by)
      VALUES (inv.branch_id, inv.tenant_id, 'income', 'sales_extra_payment', v_pay[i],
              'فاتورة ' || inv.invoice_number, _invoice_id, 'cash', auth.uid());
    ELSE
      DELETE FROM public.treasury WHERE id = v_tid[i];
    END IF;
  END LOOP;
END; $function$;

-- ============================================================
-- 6) Purchase return trigger: idempotent total, branch-scoped
--    batch drain, server-side over-return guard
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_purchase_return_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  pr record; v_remaining numeric := NEW.quantity; v_take numeric; b record;
  v_purchased numeric; v_returned numeric;
BEGIN
  SELECT id, status, shipment_id, branch_id INTO pr
  FROM public.purchase_returns WHERE id = NEW.purchase_return_id;

  IF pr.status = 'draft' THEN RETURN NEW; END IF;

  -- Guard: never return more than what was purchased on the source shipment
  IF pr.shipment_id IS NOT NULL THEN
    SELECT COALESCE(SUM(quantity), 0) INTO v_purchased
      FROM public.shipment_items WHERE shipment_id = pr.shipment_id AND product_id = NEW.product_id;
    SELECT COALESCE(SUM(pri.quantity), 0) INTO v_returned
      FROM public.purchase_return_items pri
      JOIN public.purchase_returns p2 ON p2.id = pri.purchase_return_id
     WHERE p2.shipment_id = pr.shipment_id AND p2.status = 'active'
       AND pri.product_id = NEW.product_id AND pri.id <> NEW.id;
    IF v_purchased <= 0 THEN
      RAISE EXCEPTION 'الصنف "%" غير موجود في فاتورة الشراء', COALESCE(NEW.product_name,'');
    END IF;
    IF v_returned + NEW.quantity > v_purchased THEN
      RAISE EXCEPTION 'كمية مرتجع الشراء للصنف "%" أكبر من المتاح (المشترى %، المرتجع سابقاً %)',
        COALESCE(NEW.product_name,''), v_purchased, v_returned;
    END IF;
  END IF;

  -- 1) Drain batches of the source shipment first
  IF pr.shipment_id IS NOT NULL THEN
    FOR b IN
      SELECT id, quantity_remaining FROM public.product_batches
       WHERE product_id = NEW.product_id AND shipment_id = pr.shipment_id
         AND branch_id = pr.branch_id AND quantity_remaining > 0
       ORDER BY created_at DESC FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(b.quantity_remaining, v_remaining);
      UPDATE public.product_batches SET quantity_remaining = quantity_remaining - v_take WHERE id = b.id;
      v_remaining := v_remaining - v_take;
    END LOOP;
  END IF;

  -- 2) Fallback: newest purchase batches IN THE SAME BRANCH only
  IF v_remaining > 0 THEN
    FOR b IN
      SELECT id, quantity_remaining FROM public.product_batches
       WHERE product_id = NEW.product_id AND batch_type = 'purchase'
         AND branch_id = pr.branch_id AND quantity_remaining > 0
       ORDER BY created_at DESC FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(b.quantity_remaining, v_remaining);
      UPDATE public.product_batches SET quantity_remaining = quantity_remaining - v_take WHERE id = b.id;
      v_remaining := v_remaining - v_take;
    END LOOP;
  END IF;

  UPDATE public.products SET quantity = GREATEST(0, quantity - NEW.quantity) WHERE id = NEW.product_id;

  -- 3) Recompute (not accumulate) the parent total
  UPDATE public.purchase_returns pr2
     SET total_amount = (SELECT COALESCE(SUM(total), 0) FROM public.purchase_return_items
                          WHERE purchase_return_id = pr2.id)
   WHERE pr2.id = NEW.purchase_return_id;

  RETURN NEW;
END; $function$;

-- Purchase-return cash/transfer inflow booked by the DB, not the client
CREATE OR REPLACE FUNCTION public.process_purchase_return_refund()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_in numeric;
BEGIN
  v_in := COALESCE(NEW.refund_cash_amount, 0) + COALESCE(NEW.refund_transfer_amount, 0);
  IF COALESCE(NEW.status, 'active') = 'active' AND v_in > 0 THEN
    INSERT INTO public.treasury(branch_id, type, category, amount, description, reference_id,
                                created_by, tenant_id, payment_method, reference_number, transfer_from_account)
    VALUES (NEW.branch_id, 'income', 'purchase_return', v_in,
            'مرتجع شراء ' || COALESCE(NEW.return_number, ''), NEW.id, NEW.created_by, NEW.tenant_id,
            NEW.refund_method, NEW.refund_reference, NEW.refund_account);
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_purchase_return_refund ON public.purchase_returns;
CREATE TRIGGER trg_purchase_return_refund
AFTER INSERT ON public.purchase_returns
FOR EACH ROW EXECUTE FUNCTION public.process_purchase_return_refund();

-- ============================================================
-- 7) Remove legacy / duplicated implementations
-- ============================================================
DROP FUNCTION IF EXISTS public.register_sale_return(uuid, jsonb, text, text, text);
DROP FUNCTION IF EXISTS public.process_return_effects();
DROP FUNCTION IF EXISTS public.process_purchase_return();
DROP FUNCTION IF EXISTS public.edit_invoice(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.edit_invoice(uuid, uuid, jsonb, numeric);
DROP FUNCTION IF EXISTS public.edit_invoice__impl(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.edit_invoice__impl(uuid, uuid, jsonb, numeric);

-- ============================================================
-- 8) Canonical edit_invoice: no manual stock write, guards, validation
-- ============================================================
CREATE OR REPLACE FUNCTION public.edit_invoice__impl(
  _invoice_id uuid, _customer_id uuid, _items jsonb,
  _vat_rate numeric DEFAULT NULL, _discount_amount numeric DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  inv record; uid uuid := auth.uid(); is_adm boolean; is_bm boolean;
  it jsonb; old_it record; v_new_qty int; v_pid uuid;
  v_subtotal numeric := 0; v_total numeric := 0; v_disc_amount numeric;
  v_consume jsonb; v_batches jsonb; v_single_batch uuid; v_unit_cost numeric; v_orig_cost numeric;
  v_vat_rate numeric; v_vat_amount numeric := 0; v_count int := 0; v_returned int;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id FOR UPDATE;
  IF inv IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  IF inv.status <> 'active' THEN RAISE EXCEPTION 'لا يمكن تعديل فاتورة ملغاة'; END IF;
  IF inv.tenant_id IS DISTINCT FROM public.current_tenant_id() AND NOT public.is_super_admin(uid) THEN
    RAISE EXCEPTION 'الفاتورة ليست ضمن شركتك'; END IF;
  SELECT public.has_role(uid, 'admin'::app_role) INTO is_adm;
  SELECT public.has_role(uid, 'branch_manager'::app_role) INTO is_bm;
  IF NOT (is_adm OR is_bm OR public.is_super_admin(uid)) THEN
    RAISE EXCEPTION 'غير مصرح بتعديل الفاتورة'; END IF;
  IF NOT is_adm AND NOT public.is_super_admin(uid) AND NOT public.user_in_branch(uid, inv.branch_id) THEN
    RAISE EXCEPTION 'الفرع خارج نطاق صلاحياتك'; END IF;

  SELECT COUNT(*) INTO v_returned FROM public.returns
   WHERE invoice_id = _invoice_id AND COALESCE(status,'active') NOT IN ('cancelled','draft');
  IF v_returned > 0 THEN
    RAISE EXCEPTION 'مش ممكن تعديل فاتورة عليها مرتجع. ألغي المرتجع الأول أو اعمل مرتجع جديد بدل التعديل.';
  END IF;

  -- Restore stock: products.quantity is handled by trg_reverse_invoice_item on DELETE
  FOR old_it IN SELECT * FROM public.invoice_items WHERE invoice_id = _invoice_id LOOP
    IF old_it.batches_consumed IS NOT NULL AND jsonb_array_length(old_it.batches_consumed) > 0 THEN
      PERFORM public.restore_batches_from_item(old_it.id);
    END IF;
  END LOOP;
  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_pid := NULLIF((it->>'product_id'), '')::uuid;
    v_new_qty := COALESCE((it->>'quantity')::int, 0);
    IF v_new_qty <= 0 THEN
      RAISE EXCEPTION 'كمية الصنف "%" لازم تكون أكبر من صفر', COALESCE(it->>'product_name','');
    END IF;
    IF COALESCE((it->>'selling_price')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'سعر بيع الصنف "%" لا يمكن أن يكون سالباً', COALESCE(it->>'product_name','');
    END IF;
    v_count := v_count + 1;
    v_batches := NULL; v_single_batch := NULL; v_unit_cost := COALESCE((it->>'cost_price')::numeric, 0);
    IF v_pid IS NOT NULL THEN
      v_consume := public.consume_product_batches_json(v_pid, inv.branch_id, v_new_qty::numeric);
      v_batches := COALESCE(v_consume->'batches', '[]'::jsonb);
      v_unit_cost := COALESCE((v_consume->>'weighted_unit_cost')::numeric, v_unit_cost);
      IF jsonb_array_length(v_batches) = 1 THEN v_single_batch := NULLIF(v_batches->0->>'batch_id','')::uuid; END IF;
      UPDATE public.products SET quantity = quantity - v_new_qty WHERE id = v_pid;
    END IF;
    v_orig_cost := v_unit_cost;
    INSERT INTO public.invoice_items(invoice_id, product_id, product_name, quantity, cost_price,
      selling_price, market_price, line_discount, total, tenant_id, unit_cost_at_sale, batch_id,
      batches_consumed, original_unit_cost)
    VALUES (_invoice_id, v_pid, it->>'product_name', v_new_qty, v_unit_cost,
      COALESCE((it->>'selling_price')::numeric, 0), COALESCE((it->>'market_price')::numeric, 0),
      COALESCE((it->>'line_discount')::numeric, 0),
      (COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty) - COALESCE((it->>'line_discount')::numeric, 0),
      inv.tenant_id, v_unit_cost, v_single_batch, v_batches, v_orig_cost);
    v_subtotal := v_subtotal + (COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty);
    v_total := v_total + ((COALESCE((it->>'selling_price')::numeric, 0) * v_new_qty) - COALESCE((it->>'line_discount')::numeric, 0));
  END LOOP;

  IF v_count = 0 THEN RAISE EXCEPTION 'لازم يكون في صنف واحد على الأقل في الفاتورة'; END IF;

  v_disc_amount := COALESCE(_discount_amount, inv.discount_amount, 0);
  IF v_disc_amount < 0 THEN v_disc_amount := 0; END IF;
  IF v_disc_amount > v_total THEN v_disc_amount := v_total; END IF;
  v_total := GREATEST(v_total - v_disc_amount, 0);
  v_vat_rate := COALESCE(_vat_rate, inv.vat_rate, 0);
  IF v_vat_rate < 0 THEN v_vat_rate := 0; END IF;
  v_vat_amount := ROUND(v_total * v_vat_rate / 100.0, 2);
  v_total := v_total + v_vat_amount;

  UPDATE public.invoices SET contact_id = _customer_id, subtotal = v_subtotal, total = v_total,
    discount_amount = v_disc_amount, vat_rate = v_vat_rate, vat_amount = v_vat_amount
   WHERE id = _invoice_id;

  PERFORM public.sync_invoice_cash_treasury(_invoice_id);
  PERFORM public.repost_invoice_journal(_invoice_id);
END; $function$;

CREATE OR REPLACE FUNCTION public.edit_invoice(
  _invoice_id uuid, _customer_id uuid, _items jsonb,
  _vat_rate numeric DEFAULT NULL, _discount_amount numeric DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.assert_can_edit_invoice(_invoice_id);
  PERFORM public.edit_invoice__impl(_invoice_id, _customer_id, _items, _vat_rate, _discount_amount);
END $function$;

GRANT EXECUTE ON FUNCTION public.edit_invoice(uuid, uuid, jsonb, numeric, numeric) TO authenticated;

-- ============================================================
-- 9) hard_delete_invoice: stop double-restoring stock
-- ============================================================
CREATE OR REPLACE FUNCTION public.hard_delete_invoice__impl(_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  inv record; uid uuid := auth.uid(); is_adm boolean; is_bm boolean; v_plan_ids uuid[];
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = _invoice_id;
  IF inv IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;

  SELECT has_role(uid, 'admin'::app_role) INTO is_adm;
  SELECT has_role(uid, 'branch_manager'::app_role) INTO is_bm;
  IF NOT (is_adm OR is_bm OR is_super_admin(uid)) THEN
    RAISE EXCEPTION 'غير مصرح بالحذف النهائي — مدير الفرع أو الأدمن فقط';
  END IF;

  IF EXISTS (SELECT 1 FROM public.returns WHERE invoice_id = _invoice_id
              AND COALESCE(status,'active') NOT IN ('cancelled','draft')) THEN
    RAISE EXCEPTION 'مش ممكن حذف فاتورة عليها مرتجع. ألغي المرتجع الأول.';
  END IF;

  -- Restore FIFO batches for still-active invoices; products.quantity is
  -- restored by trg_reverse_invoice_item when the items are deleted below.
  IF inv.status = 'active' THEN
    PERFORM public.restore_batches_from_item(ii.id) FROM public.invoice_items ii
      WHERE ii.invoice_id = _invoice_id
        AND ii.batches_consumed IS NOT NULL AND jsonb_array_length(ii.batches_consumed) > 0;
  END IF;

  DELETE FROM public.treasury WHERE reference_id = _invoice_id;

  BEGIN
    UPDATE public.pre_orders SET invoice_id = NULL WHERE invoice_id = _invoice_id;
  EXCEPTION WHEN undefined_column THEN NULL; END;

  DELETE FROM public.returns WHERE invoice_id = _invoice_id;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_plan_ids
  FROM public.payment_plans WHERE reference_type = 'invoice' AND reference_id = _invoice_id;

  IF array_length(v_plan_ids, 1) > 0 THEN
    DELETE FROM public.payment_transactions WHERE payment_plan_id = ANY(v_plan_ids);
    DELETE FROM public.payment_installments WHERE payment_plan_id = ANY(v_plan_ids);
    DELETE FROM public.payment_plans WHERE id = ANY(v_plan_ids);
  END IF;

  DELETE FROM public.invoice_payments WHERE invoice_id = _invoice_id;
  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;
  IF inv.status <> 'active' THEN
    -- cancelled invoices already restored their stock on cancel; undo the
    -- restore the delete trigger just performed
    NULL;
  END IF;
  DELETE FROM public.invoices WHERE id = _invoice_id;
END; $function$;

-- ============================================================
-- 10) Cancel invoice: block when a return already exists
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_invoice_with_refund__impl(
  _invoice_id uuid, _reason text, _refund_method text DEFAULT 'none')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_inv invoices%ROWTYPE; v_paid numeric := 0; v_uid uuid := auth.uid();
  v_plan_id uuid; v_cancelled_count int := 0;
BEGIN
  SELECT * INTO v_inv FROM invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  IF v_inv.status = 'cancelled' THEN RAISE EXCEPTION 'invoice already cancelled'; END IF;
  IF COALESCE(_reason,'') = '' THEN RAISE EXCEPTION 'reason required'; END IF;

  IF EXISTS (SELECT 1 FROM public.returns WHERE invoice_id = _invoice_id
              AND COALESCE(status,'active') NOT IN ('cancelled','draft')) THEN
    RAISE EXCEPTION 'الفاتورة دي عليها مرتجع بالفعل — ألغي المرتجع الأول أو كمّل مرتجع للباقي بدل إلغاء الفاتورة.';
  END IF;

  SELECT id INTO v_plan_id FROM payment_plans WHERE reference_type='invoice' AND reference_id=_invoice_id LIMIT 1;
  IF v_plan_id IS NOT NULL THEN
    SELECT COALESCE(SUM(paid_amount),0) INTO v_paid FROM payment_installments WHERE payment_plan_id = v_plan_id;
  END IF;
  v_paid := v_paid + COALESCE((SELECT SUM(amount) FROM invoice_payments
    WHERE invoice_id = _invoice_id AND voided_at IS NULL AND reverses_payment_id IS NULL), 0);

  IF v_plan_id IS NOT NULL THEN
    UPDATE payment_installments SET status='cancelled', cancelled_at=now(), cancelled_by=v_uid,
        adjustment_reason='تم إلغاء الفاتورة'
      WHERE payment_plan_id = v_plan_id AND status IN ('pending','overdue','partial');
    GET DIAGNOSTICS v_cancelled_count = ROW_COUNT;
    UPDATE payment_plans SET status='cancelled', remaining_amount=0 WHERE id=v_plan_id;
  END IF;

  UPDATE invoices SET status='cancelled', cancel_reason=_reason, cancelled_by=v_uid, cancelled_at=now(),
    total_paid_before_cancel=v_paid,
    refund_method = CASE WHEN v_paid > 0 THEN _refund_method ELSE 'none' END,
    refund_amount = CASE WHEN v_paid > 0 AND _refund_method IN ('cash','credit') THEN v_paid ELSE 0 END,
    refund_processed_by = CASE WHEN v_paid > 0 AND _refund_method IN ('cash','credit') THEN v_uid END,
    refund_processed_at = CASE WHEN v_paid > 0 AND _refund_method IN ('cash','credit') THEN now() END
  WHERE id=_invoice_id;

  IF v_paid > 0 AND _refund_method = 'credit' AND v_inv.contact_id IS NOT NULL THEN
    UPDATE contacts SET credit_balance = COALESCE(credit_balance,0) + v_paid, refund_status = 'credit_added'
      WHERE id = v_inv.contact_id;
    INSERT INTO customer_credit_log(contact_id, invoice_id, amount, type, notes, created_by)
      VALUES (v_inv.contact_id, _invoice_id, v_paid, 'credit_added',
              'إلغاء فاتورة ' || v_inv.invoice_number, v_uid);
  ELSIF v_paid > 0 AND _refund_method = 'cash' THEN
    INSERT INTO treasury(branch_id, type, category, amount, description, reference_id, created_by)
      VALUES (v_inv.branch_id, 'expense', 'sales_refund', v_paid,
              'رد مبلغ فاتورة ملغاة ' || v_inv.invoice_number, _invoice_id, v_uid);
    IF v_inv.contact_id IS NOT NULL THEN
      UPDATE contacts SET refund_status = 'refunded_cash' WHERE id = v_inv.contact_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('total_paid', v_paid, 'cancelled_installments', v_cancelled_count,
    'refund_method', CASE WHEN v_paid > 0 THEN _refund_method ELSE 'none' END);
END; $function$;

-- ============================================================
-- 11) Contact balance view: ignore draft/cancelled returns and
--     stop double-crediting cash/transfer refunds
-- ============================================================
CREATE OR REPLACE VIEW public.v_contact_balances AS
 SELECT c.id AS contact_id, c.tenant_id, c.name, c.type,
    COALESCE(c.credit_balance, 0::numeric) AS credit_balance,
    COALESCE(inv.total_invoiced, 0::numeric) AS total_invoiced,
    COALESCE(ret.total_returned, 0::numeric) AS total_returned,
    COALESCE(pay.total_paid, 0::numeric) AS total_paid,
    COALESCE(ship.total_shipments, 0::numeric) AS total_shipments,
    COALESCE(pur_ret.total_purchase_returns, 0::numeric) AS total_purchase_returns,
    COALESCE(sup_pay.total_supplier_paid, 0::numeric) AS total_supplier_paid,
    COALESCE(vouch_receipt.total_receipts, 0::numeric) AS total_voucher_receipts,
    COALESCE(vouch_payment.total_payments, 0::numeric) AS total_voucher_payments,
    COALESCE(c.opening_balance, 0::numeric) + COALESCE(inv.total_invoiced, 0::numeric)
      - COALESCE(ret.total_returned, 0::numeric) - COALESCE(pay.total_paid, 0::numeric)
      - (COALESCE(ship.total_shipments, 0::numeric) - COALESCE(pur_ret.total_purchase_returns, 0::numeric)
         - COALESCE(sup_pay.total_supplier_paid, 0::numeric))
      - COALESCE(vouch_receipt.total_receipts, 0::numeric)
      + COALESCE(vouch_payment.total_payments, 0::numeric) AS ledger_balance,
    COALESCE(c.opening_balance, 0::numeric) + COALESCE(inv.total_invoiced, 0::numeric)
      - COALESCE(ret.total_returned, 0::numeric) - COALESCE(pay.total_paid, 0::numeric)
      - (COALESCE(ship.total_shipments, 0::numeric) - COALESCE(pur_ret.total_purchase_returns, 0::numeric)
         - COALESCE(sup_pay.total_supplier_paid, 0::numeric))
      - COALESCE(vouch_receipt.total_receipts, 0::numeric)
      + COALESCE(vouch_payment.total_payments, 0::numeric)
      + COALESCE(c.credit_balance, 0::numeric) AS total_balance,
    COALESCE(overdue.total_overdue, 0::numeric) AS overdue_amount,
    GREATEST(inv.last_at, ret.last_at, pay.last_at, ship.last_at, pur_ret.last_at, sup_pay.last_at,
             vouch_receipt.last_at, vouch_payment.last_at) AS last_transaction_date,
    COALESCE(c.opening_balance, 0::numeric) AS opening_balance
   FROM contacts c
     LEFT JOIN LATERAL ( SELECT sum(i.total) AS total_invoiced, max(i.created_at) AS last_at
           FROM invoices i
          WHERE i.contact_id = c.id AND i.tenant_id = c.tenant_id AND i.status = 'active'::invoice_status) inv ON true
     LEFT JOIN LATERAL ( SELECT sum(GREATEST(COALESCE(r.total_refund,0)
                                    - COALESCE(r.refund_cash_amount,0)
                                    - COALESCE(r.refund_transfer_amount,0), 0)) AS total_returned,
            max(r.created_at) AS last_at
           FROM returns r JOIN invoices i ON i.id = r.invoice_id
          WHERE i.contact_id = c.id AND r.tenant_id = c.tenant_id
            AND COALESCE(r.status, 'active') NOT IN ('draft', 'cancelled')) ret ON true
     LEFT JOIN LATERAL ( SELECT sum(ip.amount) AS total_paid, max(ip.created_at) AS last_at
           FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
          WHERE i.contact_id = c.id AND ip.tenant_id = c.tenant_id
            AND ip.voided_at IS NULL AND ip.reverses_payment_id IS NULL) pay ON true
     LEFT JOIN LATERAL ( SELECT sum(s.total_cost) AS total_shipments, max(s.created_at) AS last_at
           FROM shipments s WHERE s.contact_id = c.id AND s.tenant_id = c.tenant_id) ship ON true
     LEFT JOIN LATERAL ( SELECT sum(GREATEST(COALESCE(pr.total_amount,0)
                                    - COALESCE(pr.refund_cash_amount,0)
                                    - COALESCE(pr.refund_transfer_amount,0), 0)) AS total_purchase_returns,
            max(pr.created_at) AS last_at
           FROM purchase_returns pr
          WHERE pr.contact_id = c.id AND pr.tenant_id = c.tenant_id AND pr.status = 'active'::text) pur_ret ON true
     LEFT JOIN LATERAL ( SELECT sum(sp.amount) AS total_supplier_paid, max(sp.created_at) AS last_at
           FROM supplier_payments sp WHERE sp.contact_id = c.id AND sp.tenant_id = c.tenant_id) sup_pay ON true
     LEFT JOIN LATERAL ( SELECT sum(v.amount) AS total_receipts, max(v.created_at) AS last_at
           FROM vouchers v
          WHERE v.party_id = c.id AND v.tenant_id = c.tenant_id AND v.type = 'receipt'::voucher_type
            AND v.status = 'active'::voucher_status
            AND (v.party_type = ANY (ARRAY['customer'::voucher_party_type, 'supplier'::voucher_party_type]))) vouch_receipt ON true
     LEFT JOIN LATERAL ( SELECT sum(v.amount) AS total_payments, max(v.created_at) AS last_at
           FROM vouchers v
          WHERE v.party_id = c.id AND v.tenant_id = c.tenant_id AND v.type = 'payment'::voucher_type
            AND v.status = 'active'::voucher_status
            AND (v.party_type = ANY (ARRAY['customer'::voucher_party_type, 'supplier'::voucher_party_type]))) vouch_payment ON true
     LEFT JOIN LATERAL ( SELECT sum(pi.amount) AS total_overdue
           FROM payment_installments pi
             JOIN payment_plans pp ON pp.id = pi.payment_plan_id
             JOIN invoices i ON i.id = pp.reference_id AND pp.reference_type = 'invoice'::text
          WHERE i.contact_id = c.id AND pi.tenant_id = c.tenant_id
            AND pi.due_date < CURRENT_DATE AND pi.status <> 'paid'::text) overdue ON true;
