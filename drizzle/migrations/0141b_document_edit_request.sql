-- 0141b: one door for every document edit — request_document_edit (owner «نفذ», 2026-10-30; completes 0141)
--
-- The screen sends the edit (and the owner's answers) to ONE function:
--   * the owner → the edit runs now (apply_document_edit);
--   * anybody else with the permission of that document → a «طلب موافقة» with «قبل ← بعد» (payload.diff); the owner
--     approves it on «طلبات الموافقة» and the same edit runs under his name.
-- Before: only admins and branch managers could insert a request (RLS), so a cashier with «تعديل المبيعات» had no way.
--   Example: the cashier of سكة edits IN04970 from 2 fridges to 1 → request «الكمية 2 ← 1» → owner approves → done.
-- Permission per document: invoice sales.update, purchase invoice shipments.update, returns returns.update, voucher
-- receipt_vouchers.create / payment_vouchers.create (vouchers have no separate edit key). One pending request per
-- document at a time.
-- An edit can carry a second step (payload.then) — e.g. the lines AND the date of the same invoice in one request.

-- apply_document_edit: run payload.then after the main step (same transaction)
DO $mig$
DECLARE d text := pg_get_functiondef('public.apply_document_edit(jsonb)'::regprocedure);
  o text := $o$  RETURN coalesce(v_res, '{}'::jsonb) || jsonb_build_object('rpc', v_rpc);$o$;
  n text := $n$  -- 0141b: a second step of the same edit (e.g. the date after the lines)
  IF jsonb_typeof(p->'then') = 'object' THEN
    v_res := coalesce(v_res, '{}'::jsonb) || jsonb_build_object('then', public.apply_document_edit(p->'then'));
  END IF;
  RETURN coalesce(v_res, '{}'::jsonb) || jsonb_build_object('rpc', v_rpc);$n$;
BEGIN
  IF position('0141b' IN d) > 0 THEN RETURN; END IF;
  IF position(o IN d) = 0 THEN RAISE EXCEPTION '0141b: apply_document_edit not the expected version'; END IF;
  EXECUTE replace(d, o, n);
END
$mig$;

CREATE OR REPLACE FUNCTION public.request_document_edit(p_entity text, p_entity_id uuid, p_label text, p_payload jsonb, p_reason text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_branch uuid; v_tenant uuid; v_perm text; v_allowed text[]; v_rpc text := p_payload->>'rpc'; v_step jsonb;
  v_id uuid; v_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '42501'; END IF;
  CASE p_entity
    WHEN 'invoice' THEN
      SELECT branch_id, tenant_id INTO v_branch, v_tenant FROM public.invoices WHERE id = p_entity_id;
      v_perm := 'sales.update'; v_allowed := ARRAY['edit_invoice', 'update_invoice_date_sovereign'];
    WHEN 'shipment' THEN
      SELECT branch_id, tenant_id INTO v_branch, v_tenant FROM public.shipments WHERE id = p_entity_id;
      v_perm := 'shipments.update'; v_allowed := ARRAY['edit_shipment', 'update_shipment_date'];
    WHEN 'sale_return' THEN
      SELECT branch_id, tenant_id INTO v_branch, v_tenant FROM public.returns WHERE id = p_entity_id;
      v_perm := 'returns.update'; v_allowed := ARRAY['edit_sale_return'];
    WHEN 'purchase_return' THEN
      SELECT branch_id, tenant_id INTO v_branch, v_tenant FROM public.purchase_returns WHERE id = p_entity_id;
      v_perm := 'returns.update'; v_allowed := ARRAY['edit_purchase_return'];
    WHEN 'voucher' THEN
      SELECT branch_id, tenant_id, CASE WHEN type = 'receipt' THEN 'receipt_vouchers.create' ELSE 'payment_vouchers.create' END
        INTO v_branch, v_tenant, v_perm FROM public.vouchers WHERE id = p_entity_id;
      v_allowed := ARRAY['edit_voucher'];
    ELSE RAISE EXCEPTION 'نوع المستند غير معروف: %', coalesce(p_entity, '—');
  END CASE;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'المستند غير موجود' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_access(v_branch, v_perm);

  -- every step must belong to this document type
  v_step := p_payload;
  WHILE v_step IS NOT NULL AND jsonb_typeof(v_step) = 'object' LOOP
    IF NOT ((v_step->>'rpc') = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'التعديل ده مش لنوع المستند ده (%)', coalesce(v_step->>'rpc', '—');
    END IF;
    v_step := v_step->'then';
  END LOOP;

  IF public.doc_edit_is_direct() THEN
    RETURN jsonb_build_object('mode', 'applied', 'result', public.apply_document_edit(p_payload));
  END IF;

  IF EXISTS (SELECT 1 FROM public.approval_requests WHERE entity_id = p_entity_id AND status = 'pending' AND action = 'update') THEN
    RAISE EXCEPTION 'فيه طلب تعديل على المستند ده لسه مستني رد المالك';
  END IF;
  SELECT coalesce(nullif(name, ''), username, 'موظف') INTO v_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.approval_requests (tenant_id, branch_id, entity_type, entity_id, entity_label, action, payload, reason,
                                        requested_by, requested_by_name)
  VALUES (v_tenant, v_branch, p_entity, p_entity_id, coalesce(nullif(p_label, ''), p_entity), 'update', p_payload,
          nullif(p_reason, ''), auth.uid(), coalesce(v_name, 'موظف'))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('mode', 'requested', 'request_id', v_id);
END $function$;
REVOKE ALL ON FUNCTION public.request_document_edit(text, uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_document_edit(text, uuid, text, jsonb, text) TO authenticated;

INSERT INTO public.security_rpc_allowlist(function_name, added_in, note) VALUES
  ('request_document_edit', '0141b', 'edit a document: owner runs it, anybody else with the permission sends an approval request')
ON CONFLICT DO NOTHING;
