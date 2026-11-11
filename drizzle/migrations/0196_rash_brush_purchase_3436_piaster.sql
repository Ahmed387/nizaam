-- 0196: owner 2026-11-11 «تصليح قرش راش برش … نفذ». «سهل» purchase 3436 (شلبى, PO24827, 1/1/2026) totals 6,516.98 while its lines
-- add up to 6,517.00 here (2 × 827.13 − 25 = 1,629.26; «سهل» wrote the line as 1,629.25 and the total one piaster lower again).
-- An invoice discount of 0.02 through `edit_shipment` makes the total 6,516.98 — «شركة راش برش» 0.01 → 0.00, average costs
-- unchanged, tills = books.
DO $mig$
DECLARE s public.shipments%ROWTYPE; v_items jsonb; v_owner uuid;
BEGIN
  SELECT sh.* INTO s FROM public.shipments sh JOIN public.branches b ON b.id = sh.branch_id
   WHERE b.code = 'FR-005' AND sh.notes LIKE '%فاتورة شراء 3436%' AND sh.status = 'active' AND sh.total_cost = 6516.99;
  IF s.id IS NULL THEN RETURN; END IF;
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur WHERE ur.role = 'owner' AND ur.tenant_id = s.tenant_id ORDER BY ur.user_id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  SELECT jsonb_agg(jsonb_build_object('id', si.id, 'product_id', si.product_id, 'product_name', si.product_name, 'sku', p.sku, 'image', NULL,
           'quantity', si.quantity, 'cost_price', si.cost_price, 'discount_percent', coalesce(si.discount_percent, 0), 'discount_amount', coalesce(si.discount_amount, 0)))
    INTO v_items FROM public.shipment_items si JOIN public.products p ON p.id = si.product_id WHERE si.shipment_id = s.id;
  PERFORM public.edit_shipment(s.id, jsonb_build_object('arrival_date', (s.arrival_date AT TIME ZONE 'Africa/Cairo')::date, 'received_by', s.received_by,
    'shipping_cost', s.shipping_cost, 'customs_cost', s.customs_cost, 'other_cost', s.other_cost, 'other_cost_description', s.other_cost_description,
    'admin_cost', s.admin_cost, 'discount_type', 'amount', 'discount_value', 0.02, 'vat_type', s.vat_type, 'vat_value', s.vat_value, 'notes', s.notes), v_items);
END
$mig$;
