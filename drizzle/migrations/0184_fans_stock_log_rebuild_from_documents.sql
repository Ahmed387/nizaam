-- 0184: owner 2026-11-10 «أعيد بناء سجل الصنف من مستنداته … نفذ». The stock log (stock_movements) of the seven fan skus
-- (1048, 1235, 1253, 1423, 143, 1478, 922) in FR-003 / FR-004 / FR-005 (21 products) held purchases labelled «sale» that point
-- at invoices without the product, with carton counts (×3), and missed shipments. The log of these 21 products is deleted and
-- rebuilt from the documents: sale = invoice items, purchase = shipment items, return_out = purchase-return items,
-- return_in = sale-return items and prior-year returns. Whatever the documents do not explain (the 31/12 opening stock of
-- عبدالمنعم: 1048 +2, 1235 +12, 1253 +12, 1423 +5, 922 +1) becomes one `adjustment` / `opening_balance` row dated 2026-01-01.
-- Balances are chained by date (opening, then in-movements, then out-movements of the same day). Quantities, batches, money and
-- profit do not move (products.quantity is not touched). Dry-run: old 381 rows → new 372; log total = quantity for all 21.
DO $mig$
DECLARE v_owner uuid;
BEGIN
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  IF v_owner IS NULL THEN RETURN; END IF;
  ALTER TABLE public.stock_movements DISABLE TRIGGER trg_stock_movements_immutable;
  CREATE TEMP TABLE fp ON COMMIT DROP AS SELECT p.id, p.tenant_id, p.branch_id, b.code, p.sku, p.quantity FROM public.products p JOIN public.branches b ON b.id = p.branch_id
    WHERE b.code IN ('FR-003', 'FR-004', 'FR-005') AND p.archived_at IS NULL AND p.sku IN ('1048', '1235', '1253', '1423', '143', '1478', '922');
  CREATE TEMP TABLE nm ON COMMIT DROP AS
    SELECT fp.id pid, fp.tenant_id, fp.branch_id, 'sale'::text t, -ii.quantity::numeric q, 'invoice'::text rt, i.id rid, i.invoice_date::timestamptz d, 2 pr
      FROM public.invoice_items ii JOIN public.invoices i ON i.id = ii.invoice_id JOIN fp ON fp.id = ii.product_id WHERE i.status = 'active'
    UNION ALL SELECT fp.id, fp.tenant_id, fp.branch_id, 'purchase', si.quantity, 'shipment', s.id, s.arrival_date::timestamptz, 1
      FROM public.shipment_items si JOIN public.shipments s ON s.id = si.shipment_id JOIN fp ON fp.id = si.product_id WHERE s.status = 'active'
    UNION ALL SELECT fp.id, fp.tenant_id, fp.branch_id, 'return_out', -x.quantity, 'purchase_return', pr.id, pr.invoice_date::timestamptz, 2
      FROM public.purchase_return_items x JOIN public.purchase_returns pr ON pr.id = x.purchase_return_id JOIN fp ON fp.id = x.product_id WHERE pr.status = 'active'
    UNION ALL SELECT fp.id, fp.tenant_id, fp.branch_id, 'return_in', x.quantity, 'sale_return', sr.id, sr.invoice_date::timestamptz, 1
      FROM public.return_items x JOIN public.returns sr ON sr.id = x.return_id JOIN fp ON fp.id = x.product_id WHERE sr.status = 'active'
    UNION ALL SELECT fp.id, fp.tenant_id, fp.branch_id, 'return_in', (e->>'quantity')::numeric, 'prior_year_return', y.id, y.return_date::timestamptz, 1
      FROM public.prior_year_returns y CROSS JOIN LATERAL jsonb_array_elements(y.items) e JOIN fp ON fp.id = (e->>'product_id')::uuid;
  INSERT INTO nm SELECT fp.id, fp.tenant_id, fp.branch_id, 'adjustment', fp.quantity - coalesce((SELECT sum(x.q) FROM nm x WHERE x.pid = fp.id), 0), 'opening_balance', fp.id, timestamptz '2026-01-01 00:00+02', 0
    FROM fp WHERE fp.quantity <> coalesce((SELECT sum(x.q) FROM nm x WHERE x.pid = fp.id), 0);
  DELETE FROM public.stock_movements m USING fp WHERE m.product_id = fp.id;
  INSERT INTO public.stock_movements (tenant_id, branch_id, product_id, movement_type, quantity, balance_before, balance_after, reference_type, reference_id, movement_date, created_by)
    SELECT tenant_id, branch_id, pid, t, q,
           sum(q) OVER w - q, sum(q) OVER w, rt, rid, d, v_owner
      FROM nm WINDOW w AS (PARTITION BY pid ORDER BY d, pr, rid ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW);
  ALTER TABLE public.stock_movements ENABLE TRIGGER trg_stock_movements_immutable;
END
$mig$;
