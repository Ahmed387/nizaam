
-- 1) Add archive columns
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID;

CREATE INDEX IF NOT EXISTS idx_products_archived_at ON public.products(archived_at) WHERE archived_at IS NOT NULL;

-- 2) Count references function
CREATE OR REPLACE FUNCTION public.get_product_references_count(_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sales INT := 0;
  v_purchases INT := 0;
  v_sale_returns INT := 0;
  v_purchase_returns INT := 0;
  v_shipments INT := 0;
  v_adjustments INT := 0;
  v_count_sessions INT := 0;
  v_reservations INT := 0;
  v_quotes INT := 0;
  v_batches INT := 0;
BEGIN
  SELECT COUNT(DISTINCT ii.invoice_id) INTO v_sales
  FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
  WHERE ii.product_id = _product_id AND i.type = 'sale';

  SELECT COUNT(DISTINCT ii.invoice_id) INTO v_purchases
  FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
  WHERE ii.product_id = _product_id AND i.type = 'purchase';

  SELECT COUNT(DISTINCT return_id) INTO v_sale_returns
  FROM return_items WHERE product_id = _product_id;

  SELECT COUNT(DISTINCT purchase_return_id) INTO v_purchase_returns
  FROM purchase_return_items WHERE product_id = _product_id;

  SELECT COUNT(DISTINCT shipment_id) INTO v_shipments
  FROM shipment_items WHERE product_id = _product_id;

  SELECT COUNT(*) INTO v_adjustments
  FROM stock_adjustment_items WHERE product_id = _product_id;

  SELECT COUNT(DISTINCT session_id) INTO v_count_sessions
  FROM inventory_session_items WHERE product_id = _product_id;

  SELECT COUNT(*) INTO v_reservations
  FROM inventory_reservations WHERE product_id = _product_id AND status = 'active';

  SELECT COUNT(DISTINCT quote_id) INTO v_quotes
  FROM quote_items WHERE product_id = _product_id;

  SELECT COUNT(*) INTO v_batches
  FROM product_batches WHERE product_id = _product_id AND remaining_quantity > 0;

  RETURN jsonb_build_object(
    'sales', v_sales,
    'purchases', v_purchases,
    'sale_returns', v_sale_returns,
    'purchase_returns', v_purchase_returns,
    'shipments', v_shipments,
    'adjustments', v_adjustments,
    'count_sessions', v_count_sessions,
    'active_reservations', v_reservations,
    'quotes', v_quotes,
    'remaining_batches', v_batches,
    'total', v_sales + v_purchases + v_sale_returns + v_purchase_returns + v_shipments + v_adjustments + v_count_sessions + v_quotes,
    'has_any', (v_sales + v_purchases + v_sale_returns + v_purchase_returns + v_shipments + v_adjustments + v_count_sessions + v_quotes + v_reservations + v_batches) > 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_product_references_count(UUID) TO authenticated;

-- 3) Archive product
CREATE OR REPLACE FUNCTION public.archive_product(_product_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_reservations INT;
  v_product RECORD;
BEGIN
  SELECT * INTO v_product FROM products WHERE id = _product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'المنتج غير موجود'; END IF;
  IF v_product.archived_at IS NOT NULL THEN RAISE EXCEPTION 'المنتج مؤرشف بالفعل'; END IF;

  SELECT COUNT(*) INTO v_active_reservations
  FROM inventory_reservations WHERE product_id = _product_id AND status = 'active';
  IF v_active_reservations > 0 THEN
    RAISE EXCEPTION 'لا يمكن الأرشفة: يوجد % حجز نشط على هذا المنتج', v_active_reservations;
  END IF;

  UPDATE products SET archived_at = now(), archived_by = auth.uid() WHERE id = _product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.archive_product(UUID) TO authenticated;

-- 4) Restore product
CREATE OR REPLACE FUNCTION public.restore_product(_product_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE products SET archived_at = NULL, archived_by = NULL
  WHERE id = _product_id AND archived_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'المنتج غير موجود أو غير مؤرشف'; END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_product(UUID) TO authenticated;

-- 5) Safe hard delete (only if no references)
CREATE OR REPLACE FUNCTION public.safe_delete_product(_product_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refs JSONB;
  v_is_admin BOOLEAN;
BEGIN
  SELECT (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin')) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'صلاحية الحذف النهائي للمالك فقط';
  END IF;

  v_refs := get_product_references_count(_product_id);
  IF (v_refs->>'has_any')::BOOLEAN THEN
    RAISE EXCEPTION 'لا يمكن الحذف النهائي: المنتج مرتبط بفواتير/حركات. استخدم الأرشفة بدلاً منه.';
  END IF;

  DELETE FROM products WHERE id = _product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.safe_delete_product(UUID) TO authenticated;
