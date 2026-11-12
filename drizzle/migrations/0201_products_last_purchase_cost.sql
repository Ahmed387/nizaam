-- 0201: owner 2026-11-11 inventory columns «متوسط سعر الشراء ، اخر سعر الشراء». `products.cost_price` follows the moving
-- average, so the LAST purchase price is read from the newest active purchase invoice line of the product.
-- products_last_purchase_cost(branch | NULL = every branch the caller can read) → product_id, last_cost, last_date. Invoker (RLS).
CREATE OR REPLACE FUNCTION public.products_last_purchase_cost(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE(product_id uuid, last_cost numeric, last_date date)
LANGUAGE sql STABLE SET search_path TO 'public' AS $fn$
  SELECT DISTINCT ON (si.product_id) si.product_id, si.cost_price::numeric, s.arrival_date
    FROM public.shipment_items si JOIN public.shipments s ON s.id = si.shipment_id
   WHERE s.status = 'active' AND si.product_id IS NOT NULL AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
   ORDER BY si.product_id, s.arrival_date DESC, s.created_at DESC
$fn$;
REVOKE ALL ON FUNCTION public.products_last_purchase_cost(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.products_last_purchase_cost(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
