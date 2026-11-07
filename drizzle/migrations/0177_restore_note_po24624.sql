-- 0177: 0176 called `edit_shipment(PO24624, '{}', items)`; an empty header writes notes = NULL, so the purchase the
-- import made in سكة for شلبى's sale 8299 lost its note. It is put back through `set_document_annotations` (text only)
-- with what it said plus the 0176 correction. Always pass the document's notes in edit_shipment's header.
DO $mig$
DECLARE v_owner uuid; v_id uuid := 'b625fc3a-1532-42cf-a7d8-59ca08c03e47';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.shipments WHERE id = v_id AND notes IS NULL) THEN RETURN; END IF;
  SELECT ur.user_id INTO v_owner FROM public.user_roles ur JOIN public.branches b ON b.tenant_id = ur.tenant_id
   WHERE ur.role = 'owner' AND b.code = 'FR-005' ORDER BY ur.user_id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM public.set_document_annotations('shipment', v_id, (SELECT received_by FROM public.shipments WHERE id = v_id),
    'من سجل شلبى: فاتورة بيع 8299 — ما اتسجلتش في الفرع — سعر سخان 1412 اتصلح من 2,675 لـ 3,675 (المالك 2026-11-07 «دي غلطة كتابة»)');
END
$mig$;
