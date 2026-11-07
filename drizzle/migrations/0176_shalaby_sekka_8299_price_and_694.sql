-- 0176: owner 2026-11-07 — two separate documents between شلبى and سكة in September:
--   «دي غلطة كتابة»: شلبى's sale 8299 (10/9, IN47017) had سخان 1412 at 2,675 instead of 3,675; the line is corrected in
--   شلبى's invoice and in the purchase the import made for it in سكة (both 73,775 → 74,775), through `edit_invoice` /
--   `edit_shipment` as the owner.
--   «والعكس صحيح … موافق ابد ونفذ»: سكة's purchase 694 (4/9, سخان 1412 ×1 at 3,675 from «المخزن الرئيسي») had no sale in
--   شلبى; one is made there on 4/9 to «معرض سكة تلة (حساب خاص)» on account, the same way the import made sales
--   (`process_sale_full` in import mode), then the item is re-costed from 1/9 and both accounts' ledgers re-synced.
-- Dry-run: IN47017 74,775, the سكة purchase 74,775, new sale 3,675 on 2026-09-04.
DO $mig$
DECLARE v_owner uuid; v_items jsonb; v_sitems jsonb; v_b uuid; v_pid uuid; v_inv uuid; v_ship uuid; v_sekka uuid; v_shal uuid;
BEGIN
  SELECT id INTO v_inv FROM public.invoices WHERE notes = 'سهل — شلبى — فاتورة 8299' AND status = 'active';
  IF v_inv IS NULL OR NOT EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = v_inv AND selling_price = 2675) THEN RETURN; END IF;
  SELECT id INTO v_ship FROM public.shipments WHERE notes LIKE 'من سجل شلبى: فاتورة بيع 8299 %' AND status = 'active';
  SELECT c.id INTO v_sekka FROM public.contacts c JOIN public.branches b ON b.id = c.internal_branch_id WHERE b.code = 'FR-003';
  SELECT c.id INTO v_shal FROM public.contacts c JOIN public.branches b ON b.id = c.internal_branch_id WHERE b.code = 'FR-005';
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id
   WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  SELECT id INTO v_b FROM public.branches WHERE code = 'FR-005';
  SELECT id INTO v_pid FROM public.products WHERE branch_id = v_b AND sku = '1412';

  SELECT jsonb_agg(jsonb_build_object('product_id', ii.product_id, 'product_name', ii.product_name, 'quantity', ii.quantity,
           'selling_price', CASE WHEN p.sku = '1412' AND ii.selling_price = 2675 THEN 3675 ELSE ii.selling_price END,
           'market_price', ii.market_price, 'line_discount', ii.line_discount, 'cost_price', ii.cost_price) ORDER BY ii.id)
    INTO v_items FROM public.invoice_items ii JOIN public.products p ON p.id = ii.product_id WHERE ii.invoice_id = v_inv;
  PERFORM public.edit_invoice(v_inv, (SELECT contact_id FROM public.invoices WHERE id = v_inv), v_items, NULL, NULL);

  SELECT jsonb_agg(jsonb_build_object('id', si.id, 'quantity', si.quantity,
           'cost_price', CASE WHEN p.sku = '1412' AND si.cost_price = 2675 THEN 3675 ELSE si.cost_price END,
           'discount_percent', coalesce(si.discount_percent, 0), 'discount_amount', coalesce(si.discount_amount, 0)))
    INTO v_sitems FROM public.shipment_items si JOIN public.products p ON p.id = si.product_id WHERE si.shipment_id = v_ship;
  PERFORM public.edit_shipment(v_ship, '{}'::jsonb, v_sitems);

  PERFORM set_config('app.sahl_import', '1', true);
  PERFORM public.process_sale_full(v_b, v_sekka, 3675, 0, 0, NULL, 3675, 'credit',
     jsonb_build_array(jsonb_build_object('product_id', v_pid, 'product_name', (SELECT name FROM public.products WHERE id = v_pid),
       'quantity', 1, 'selling_price', 3675, 'cost_price', 0, 'line_discount', 0, 'market_price', 0)), '[]'::jsonb, 0, 0, '2026-09-04',
     NULL, 'من سجل سكة: فاتورة شراء 694 (4/9) — ما اتسجلتش في شلبى (المالك 2026-11-07 «والعكس صحيح»)', 0, 'سهل');
  PERFORM set_config('app.sahl_import', '0', true);
  PERFORM public.recost_product_sales((SELECT array_agg(id) FROM public.products WHERE sku = '1412' AND tenant_id = (SELECT tenant_id FROM public.branches WHERE id = v_b)),
                                      '2026-09-01 00:00+02');
  PERFORM public.ledger_sync_safe(v_sekka, NULL, 'sahl_import');
  PERFORM public.ledger_sync_safe(v_shal, NULL, 'sahl_import');
END
$mig$;
