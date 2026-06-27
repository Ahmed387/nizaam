CREATE OR REPLACE FUNCTION public.get_product_references_count(_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sales INT := 0;
  v_purchases INT := 0;
  v_sale_returns INT := 0;
  v_purchase_returns INT := 0;
  v_shipments INT := 0;
  v_transfers INT := 0;
  v_adjustments INT := 0;
  v_count_sessions INT := 0;
  v_reservations INT := 0;
  v_quotes INT := 0;
  v_remaining_batches INT := 0;
  v_blocking_batches INT := 0;
  v_opening_stock_batches INT := 0;
  v_internal_adjustment_batches INT := 0;
  v_blocking_total INT := 0;
BEGIN
  SELECT COUNT(DISTINCT invoice_id) INTO v_sales
  FROM public.invoice_items
  WHERE product_id = _product_id;

  -- Purchase records in this app are represented by shipments, not rows in invoices.
  v_purchases := 0;

  SELECT COUNT(DISTINCT return_id) INTO v_sale_returns
  FROM public.return_items
  WHERE product_id = _product_id;

  SELECT COUNT(DISTINCT purchase_return_id) INTO v_purchase_returns
  FROM public.purchase_return_items
  WHERE product_id = _product_id;

  SELECT COUNT(DISTINCT shipment_id) INTO v_shipments
  FROM public.shipment_items
  WHERE product_id = _product_id;

  SELECT COUNT(*) INTO v_transfers
  FROM public.stock_transfers
  WHERE product_id = _product_id;

  SELECT COUNT(*) INTO v_adjustments
  FROM public.stock_adjustment_items
  WHERE product_id = _product_id;

  SELECT COUNT(DISTINCT session_id) INTO v_count_sessions
  FROM public.inventory_session_items
  WHERE product_id = _product_id;

  SELECT COUNT(*) INTO v_reservations
  FROM public.inventory_reservations
  WHERE product_id = _product_id
    AND status = 'active';

  SELECT COUNT(DISTINCT quote_id) INTO v_quotes
  FROM public.quote_items
  WHERE product_id = _product_id;

  SELECT COUNT(*) INTO v_remaining_batches
  FROM public.product_batches
  WHERE product_id = _product_id
    AND quantity_remaining > 0;

  SELECT COUNT(*) INTO v_opening_stock_batches
  FROM public.product_batches
  WHERE product_id = _product_id
    AND quantity_remaining > 0
    AND COALESCE(batch_type, 'opening_stock') = 'opening_stock';

  SELECT COUNT(*) INTO v_internal_adjustment_batches
  FROM public.product_batches
  WHERE product_id = _product_id
    AND quantity_remaining > 0
    AND batch_type = 'adjustment'
    AND shipment_id IS NULL
    AND transferred_from_branch_id IS NULL;

  -- Only batches that came from real external stock documents should block hard delete.
  -- Opening stock and manual adjustment batches are internal setup records and can be cleaned up
  -- when there are no invoices, shipments, returns, transfers, reservations, or quotes.
  SELECT COUNT(*) INTO v_blocking_batches
  FROM public.product_batches
  WHERE product_id = _product_id
    AND quantity_remaining > 0
    AND NOT (
      COALESCE(batch_type, 'opening_stock') = 'opening_stock'
      OR (
        batch_type = 'adjustment'
        AND shipment_id IS NULL
        AND transferred_from_branch_id IS NULL
      )
    );

  v_blocking_total := v_sales + v_purchases + v_sale_returns + v_purchase_returns
    + v_shipments + v_transfers + v_reservations + v_quotes + v_blocking_batches;

  RETURN jsonb_build_object(
    'sales', v_sales,
    'purchases', v_purchases,
    'sale_returns', v_sale_returns,
    'purchase_returns', v_purchase_returns,
    'shipments', v_shipments,
    'transfers', v_transfers,
    'adjustments', v_adjustments,
    'count_sessions', v_count_sessions,
    'active_reservations', v_reservations,
    'reservations', v_reservations,
    'quotes', v_quotes,
    'remaining_batches', v_remaining_batches,
    'batches', v_remaining_batches,
    'blocking_batches', v_blocking_batches,
    'opening_stock_batches', v_opening_stock_batches,
    'internal_adjustment_batches', v_internal_adjustment_batches,
    'total', v_sales + v_purchases + v_sale_returns + v_purchase_returns + v_shipments + v_transfers + v_adjustments + v_count_sessions + v_quotes,
    'blocking_total', v_blocking_total,
    'has_any', v_blocking_total > 0,
    'has_internal_setup_only', v_blocking_total = 0 AND (v_remaining_batches > 0 OR v_adjustments > 0 OR v_count_sessions > 0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.safe_delete_product(_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_refs JSONB;
  v_is_admin BOOLEAN;
  v_adjustment_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT COALESCE(public.has_role(auth.uid(), 'admin'), false)
      OR COALESCE(public.has_role(auth.uid(), 'super_admin'), false)
    INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'صلاحية الحذف النهائي للمالك فقط';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = _product_id) THEN
    RAISE EXCEPTION 'المنتج غير موجود';
  END IF;

  v_refs := public.get_product_references_count(_product_id);

  IF COALESCE((v_refs->>'has_any')::BOOLEAN, false) THEN
    RAISE EXCEPTION 'لا يمكن الحذف النهائي: المنتج مرتبط بمستندات فعلية. استخدم الأرشفة بدلاً منه.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT adjustment_id), ARRAY[]::uuid[])
    INTO v_adjustment_ids
  FROM public.stock_adjustment_items
  WHERE product_id = _product_id;

  -- Clean internal setup records that do not represent external customer/supplier documents.
  DELETE FROM public.stock_adjustment_items
  WHERE product_id = _product_id;

  DELETE FROM public.stock_adjustments sa
  WHERE sa.id = ANY(v_adjustment_ids)
    AND NOT EXISTS (
      SELECT 1 FROM public.stock_adjustment_items sai
      WHERE sai.adjustment_id = sa.id
    );

  DELETE FROM public.product_batches
  WHERE product_id = _product_id;

  DELETE FROM public.inventory_reservations
  WHERE product_id = _product_id
    AND status IS DISTINCT FROM 'active';

  DELETE FROM public.products
  WHERE id = _product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج غير موجود';
  END IF;
END;
$function$;