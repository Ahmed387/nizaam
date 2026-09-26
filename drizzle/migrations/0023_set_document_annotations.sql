CREATE OR REPLACE FUNCTION public.set_document_annotations(p_kind text, p_id uuid, p_recipient text, p_notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid := public.current_tenant_id(); v_rows int;
  r text := nullif(btrim(coalesce(p_recipient,'')), ''); n text := nullif(btrim(coalesce(p_notes,'')), '');
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF p_kind = 'invoice' THEN
    UPDATE invoices SET recipient_name = r, notes = n WHERE id = p_id AND tenant_id = v_tenant;
  ELSIF p_kind = 'shipment' THEN
    UPDATE shipments SET received_by = r, notes = n WHERE id = p_id AND tenant_id = v_tenant;
  ELSIF p_kind = 'sale_return' THEN
    UPDATE returns SET recipient_name = r, notes = n WHERE id = p_id AND tenant_id = v_tenant;
  ELSIF p_kind = 'purchase_return' THEN
    UPDATE purchase_returns SET recipient_name = r, notes = n WHERE id = p_id AND tenant_id = v_tenant;
  ELSIF p_kind = 'voucher' THEN
    UPDATE vouchers v SET recipient_name = r, description = coalesce(n, v.description)
      WHERE v.id = p_id AND v.branch_id IN (SELECT id FROM branches WHERE tenant_id = v_tenant);
  ELSIF p_kind = 'stock_transfer' THEN
    UPDATE stock_transfers SET recipient_name = r, notes = n WHERE (id = p_id OR group_id = p_id) AND tenant_id = v_tenant;
  ELSE RAISE EXCEPTION 'نوع مستند غير معروف'; END IF;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'المستند غير موجود أو غير مسموح'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_document_annotations(text, uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_document_annotations(text, uuid, text, text) TO authenticated;