
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
  v_adjustments INT := 0;
  v_count_sessions INT := 0;
  v_reservations INT := 0;
  v_quotes INT := 0;
  v_batches INT := 0;
BEGIN
  SELECT COUNT(DISTINCT invoice_id) INTO v_sales
  FROM invoice_items WHERE product_id = _product_id;

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
    'reservations', v_reservations,
    'quotes', v_quotes,
    'batches', v_batches,
    'has_any', (v_sales + v_purchases + v_sale_returns + v_purchase_returns + v_shipments + v_adjustments + v_count_sessions + v_reservations + v_quotes + v_batches) > 0
  );
END;
$function$;
