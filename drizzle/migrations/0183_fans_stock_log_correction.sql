-- 0183: owner 2026-11-10 «حركة تصحيح واحدة لكل صنف … تمام موافق». After 0179 divided the fans' carton lines by 3, nine fan
-- rows (sku 1048 / 1235 / 1253 / 1423 / 143 / 1478 / 922) had a stock log (Σ balance_after − balance_before) that no longer
-- equalled their quantity (شلبى 1478: log 2,070 above the real 0). One `adjustment` movement per row with the difference
-- (quantity = difference, balance_before = log total, balance_after = quantity). Quantity, batches and money do not move.
-- Dry-run: 1048 −20, 1235 −6, 1253 +2, 1423 +18, 143 −6 and +2, 1478 −2 and −2,070, 922 +2; afterwards log = quantity for all.
DO $mig$
DECLARE v_owner uuid; r record;
BEGIN
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  IF v_owner IS NULL THEN RETURN; END IF;
  FOR r IN SELECT p.id, p.tenant_id, p.branch_id, p.quantity,
             (SELECT coalesce(sum(balance_after - balance_before), 0) FROM public.stock_movements m WHERE m.product_id = p.id) mv
           FROM public.products p JOIN public.branches b ON b.id = p.branch_id
          WHERE b.code IN ('FR-003', 'FR-004', 'FR-005') AND p.archived_at IS NULL
            AND p.sku IN ('1048', '1235', '1253', '1423', '143', '1478', '922')
            AND p.quantity <> (SELECT coalesce(sum(balance_after - balance_before), 0) FROM public.stock_movements m WHERE m.product_id = p.id) LOOP
    INSERT INTO public.stock_movements (tenant_id, branch_id, product_id, movement_type, quantity, balance_before, balance_after, reference_type, reference_id, movement_date, created_by)
    VALUES (r.tenant_id, r.branch_id, r.id, 'adjustment', r.quantity - r.mv, r.mv, r.quantity, 'system', r.id, now(), v_owner);
  END LOOP;
END
$mig$;
