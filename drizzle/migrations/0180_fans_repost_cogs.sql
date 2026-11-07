-- 0180: after 0179 `profit_reconciliation` showed the cost of goods in the books 19,200.03 (سكة) and 19,661.88
-- (عبدالمنعم) away from the invoices: `recost_product_sales` re-posts only invoices whose line COST changed, and 0179
-- changed QUANTITIES (÷ 3) — so the COGS entry of every active invoice holding one of the seven fan codes is posted
-- again (`post_invoice_cogs`, own day) and every active sale return of them re-synced (`sync_sale_return_journal`).
-- Dry-run: 214 invoices, 23 returns; cost differences back to 0.03 / 141.75 (the old one) / 0.06;
-- net profit 1/1–28/10 641,666.39 → 680,386.52.
DO $mig$
DECLARE v_owner uuid; r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE code = 'FR-005') THEN RETURN; END IF;
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id
   WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  FOR r IN SELECT DISTINCT ii.invoice_id FROM public.invoice_items ii JOIN public.invoices i ON i.id = ii.invoice_id
             JOIN public.products p ON p.id = ii.product_id
            WHERE i.status = 'active' AND p.sku IN ('1048', '1235', '1253', '1423', '143', '1478', '922') LOOP
    PERFORM public.post_invoice_cogs(r.invoice_id);
  END LOOP;
  FOR r IN SELECT DISTINCT rt.id FROM public.returns rt JOIN public.return_items ri ON ri.return_id = rt.id
             JOIN public.products p ON p.id = ri.product_id
            WHERE rt.status = 'active' AND p.sku IN ('1048', '1235', '1253', '1423', '143', '1478', '922') LOOP
    PERFORM public.sync_sale_return_journal(r.id);
  END LOOP;
END
$mig$;
