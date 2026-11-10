-- 0182: owner 2026-11-10 «سند صرف سكة 1836 (50 جنيه أجرة توكتوك يوم 1/10) نفذها». The payment was entered in «سهل» after the
-- staged files were exported (the till report has it: 1/10, درج النقدية, بند «اجره تكتك», ملاحظات «محمد احمد»). Made with
-- `create_manual_voucher` in import mode, category «اجرة توكتوك» like 1833 — سكة cash drawer −180,583 → −180,633.
DO $mig$
DECLARE v_owner uuid; v_b uuid;
BEGIN
  SELECT id INTO v_b FROM public.branches WHERE code = 'FR-003';
  IF v_b IS NULL OR EXISTS (SELECT 1 FROM public.vouchers WHERE branch_id = v_b AND description LIKE '%سهل سكة — سند صرف 1836') THEN RETURN; END IF;
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id
   WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('app.sahl_import', '1', true);
  PERFORM public.create_manual_voucher(v_b, 'payment', (SELECT id FROM public.voucher_categories WHERE tenant_id = (SELECT tenant_id FROM public.branches WHERE id = v_b) AND name = 'اجرة توكتوك' LIMIT 1),
     50, 'cash', NULL, NULL, 0, NULL, NULL, NULL, 'محمد احمد — سهل سكة — سند صرف 1836', DATE '2026-10-01', NULL);
  PERFORM set_config('app.sahl_import', '0', true);
END
$mig$;
