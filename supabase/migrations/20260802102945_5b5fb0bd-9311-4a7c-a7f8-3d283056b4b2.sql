DO $$
DECLARE d text; n int;
BEGIN
  -- تعديل الفاتورة: استبعاد الكميات المرتجعة عند إرجاع المخزون
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE proname = 'edit_invoice__impl' LIMIT 1;
  IF d IS NULL THEN RAISE EXCEPTION 'edit_invoice__impl not found'; END IF;
  IF position('UPDATE public.products SET quantity = quantity + old_it.quantity WHERE id = old_it.product_id;' in d) = 0 THEN
    RAISE EXCEPTION 'restock pattern not found';
  END IF;
  d := replace(d,
    'UPDATE public.products SET quantity = quantity + old_it.quantity WHERE id = old_it.product_id;',
    'UPDATE public.products SET quantity = quantity + GREATEST(old_it.quantity - COALESCE((
         SELECT SUM(ri.quantity) FROM public.return_items ri
         JOIN public.returns r ON r.id = ri.return_id
         WHERE r.invoice_id = _invoice_id AND ri.product_id = old_it.product_id
           AND COALESCE(r.status, ''active'') <> ''cancelled''), 0), 0)
       WHERE id = old_it.product_id;');
  EXECUTE d;

  -- إتمام الحجز: توزيع العربون بالتناسب مع الكمية المنفذة
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE proname = 'complete_pre_order_sale' LIMIT 1;
  IF d IS NULL THEN RAISE EXCEPTION 'complete_pre_order_sale not found'; END IF;
  d := replace(d,
    '  v_subtotal numeric; v_remaining numeric;',
    '  v_subtotal numeric; v_remaining numeric; v_deposit_used numeric := 0;');
  d := replace(d,
    'v_remaining := GREATEST(0, v_subtotal - COALESCE(v_po.deposit_amount,0));',
    'v_deposit_used := LEAST(
       COALESCE(v_po.deposit_amount,0),
       ROUND(COALESCE(v_po.deposit_amount,0) * v_qty_sell::numeric / NULLIF(v_po.quantity,0), 2),
       v_subtotal);
     v_remaining := GREATEST(0, v_subtotal - v_deposit_used);');
  d := replace(d,
    'v_subtotal, COALESCE(v_po.deposit_amount,0), 0,',
    'v_subtotal, v_deposit_used, 0,');
  d := replace(d,
    'UPDATE public.pre_orders SET quantity = v_po.quantity - v_qty_sell, updated_at=now() WHERE id=p_pre_order_id;',
    'UPDATE public.pre_orders SET quantity = v_po.quantity - v_qty_sell,
       deposit_amount = GREATEST(COALESCE(v_po.deposit_amount,0) - v_deposit_used, 0),
       updated_at=now() WHERE id=p_pre_order_id;');
  EXECUTE d;
END $$;