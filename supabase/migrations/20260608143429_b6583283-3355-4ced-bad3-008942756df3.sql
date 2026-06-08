CREATE OR REPLACE FUNCTION public.historical_stock_at(_branch_id uuid, _as_of timestamptz)
RETURNS TABLE(product_id uuid, name text, sku text, quantity_at_date numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH base AS (
  SELECT id, name, sku, quantity::numeric AS current_qty
  FROM products WHERE branch_id = _branch_id
),
delta_after AS (
  SELECT product_id, SUM(d) AS delta FROM (
    SELECT ii.product_id, -ii.quantity::numeric AS d
      FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.branch_id = _branch_id AND i.status <> 'cancelled' AND i.created_at > _as_of
    UNION ALL
    SELECT ri.product_id, ri.quantity::numeric
      FROM return_items ri JOIN returns r ON r.id = ri.return_id
      WHERE r.branch_id = _branch_id AND r.created_at > _as_of
    UNION ALL
    SELECT si.product_id, si.quantity::numeric
      FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
      WHERE s.branch_id = _branch_id AND s.created_at > _as_of
    UNION ALL
    SELECT pri.product_id, -pri.quantity::numeric
      FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id = pri.purchase_return_id
      WHERE pr.branch_id = _branch_id AND pr.created_at > _as_of
    UNION ALL
    SELECT sai.product_id, sai.difference::numeric
      FROM stock_adjustment_items sai JOIN stock_adjustments sa ON sa.id = sai.adjustment_id
      WHERE sa.branch_id = _branch_id AND sa.created_at > _as_of
    UNION ALL
    SELECT st.product_id, -st.quantity::numeric
      FROM stock_transfers st
      WHERE st.from_branch_id = _branch_id AND st.status = 'confirmed' AND st.created_at > _as_of
    UNION ALL
    SELECT st.product_id, COALESCE(st.received_quantity, st.quantity)::numeric
      FROM stock_transfers st
      WHERE st.to_branch_id = _branch_id AND st.status = 'confirmed' AND st.created_at > _as_of
    UNION ALL
    SELECT ia.product_id, ia.adjustment_amount::numeric
      FROM inventory_adjustments ia JOIN inventory_sessions ses ON ses.id = ia.session_id
      WHERE ses.branch_id = _branch_id AND ia.created_at > _as_of
  ) x
  GROUP BY product_id
)
SELECT b.id, b.name, b.sku,
       (b.current_qty - COALESCE(da.delta, 0))::numeric
FROM base b
LEFT JOIN delta_after da ON da.product_id = b.id
ORDER BY b.name;
$$;

GRANT EXECUTE ON FUNCTION public.historical_stock_at(uuid, timestamptz) TO authenticated;