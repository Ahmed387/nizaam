CREATE OR REPLACE FUNCTION public.assert_same_tenant(p_tenant uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_super_admin(auth.uid()) THEN RETURN; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF p_tenant IS DISTINCT FROM public.current_tenant_id() THEN
    RAISE EXCEPTION 'غير مصرح: هذا المستند يخص شركة أخرى';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_same_tenant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_same_tenant(uuid) TO authenticated, service_role;

-- 1) hard_delete_invoice
ALTER FUNCTION public.hard_delete_invoice(uuid) RENAME TO hard_delete_invoice__impl;
REVOKE ALL ON FUNCTION public.hard_delete_invoice__impl(uuid) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.hard_delete_invoice(_invoice_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_same_tenant((SELECT tenant_id FROM public.invoices WHERE id = _invoice_id));
  PERFORM public.hard_delete_invoice__impl(_invoice_id);
END $$;
GRANT EXECUTE ON FUNCTION public.hard_delete_invoice(uuid) TO authenticated, service_role;

-- 2) cancel_invoice_with_refund
ALTER FUNCTION public.cancel_invoice_with_refund(uuid, text, text) RENAME TO cancel_invoice_with_refund__impl;
REVOKE ALL ON FUNCTION public.cancel_invoice_with_refund__impl(uuid, text, text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.cancel_invoice_with_refund(_invoice_id uuid, _reason text, _refund_method text DEFAULT 'none')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_same_tenant((SELECT tenant_id FROM public.invoices WHERE id = _invoice_id));
  RETURN public.cancel_invoice_with_refund__impl(_invoice_id, _reason, _refund_method);
END $$;
GRANT EXECUTE ON FUNCTION public.cancel_invoice_with_refund(uuid, text, text) TO authenticated, service_role;

-- 3) redistribute_installments_after_return
ALTER FUNCTION public.redistribute_installments_after_return(uuid) RENAME TO redistribute_installments_after_return__impl;
REVOKE ALL ON FUNCTION public.redistribute_installments_after_return__impl(uuid) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.redistribute_installments_after_return(_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_same_tenant((SELECT tenant_id FROM public.invoices WHERE id = _invoice_id));
  RETURN public.redistribute_installments_after_return__impl(_invoice_id);
END $$;
GRANT EXECUTE ON FUNCTION public.redistribute_installments_after_return(uuid) TO authenticated, service_role;

-- 4) edit_shipment
ALTER FUNCTION public.edit_shipment(uuid, jsonb, jsonb) RENAME TO edit_shipment__impl;
REVOKE ALL ON FUNCTION public.edit_shipment__impl(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.edit_shipment(p_shipment_id uuid, p_header jsonb, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_same_tenant((SELECT tenant_id FROM public.shipments WHERE id = p_shipment_id));
  RETURN public.edit_shipment__impl(p_shipment_id, p_header, p_items);
END $$;
GRANT EXECUTE ON FUNCTION public.edit_shipment(uuid, jsonb, jsonb) TO authenticated, service_role;

-- 5) add_invoice_payment
ALTER FUNCTION public.add_invoice_payment(uuid, text, numeric, text, text, text, numeric, boolean, text) RENAME TO add_invoice_payment__impl;
REVOKE ALL ON FUNCTION public.add_invoice_payment__impl(uuid, text, numeric, text, text, text, numeric, boolean, text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.add_invoice_payment(p_invoice_id uuid, p_payment_method text, p_amount numeric,
  p_reference_number text, p_transfer_to_account text, p_transfer_from_account text,
  p_fee_amount numeric, p_fee_on_customer boolean, p_received_by_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_same_tenant((SELECT tenant_id FROM public.invoices WHERE id = p_invoice_id));
  RETURN public.add_invoice_payment__impl(p_invoice_id, p_payment_method, p_amount, p_reference_number,
    p_transfer_to_account, p_transfer_from_account, p_fee_amount, p_fee_on_customer, p_received_by_name);
END $$;
GRANT EXECUTE ON FUNCTION public.add_invoice_payment(uuid, text, numeric, text, text, text, numeric, boolean, text) TO authenticated, service_role;

-- 6) edit_invoice_payment
ALTER FUNCTION public.edit_invoice_payment(uuid, numeric, text, text, text, text, numeric, boolean, text, text) RENAME TO edit_invoice_payment__impl;
REVOKE ALL ON FUNCTION public.edit_invoice_payment__impl(uuid, numeric, text, text, text, text, numeric, boolean, text, text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.edit_invoice_payment(p_payment_id uuid, p_amount numeric, p_payment_method text,
  p_reference_number text, p_transfer_to_account text, p_transfer_from_account text,
  p_fee_amount numeric, p_fee_on_customer boolean, p_received_by_name text, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_same_tenant((SELECT i.tenant_id FROM public.invoice_payments ip
    JOIN public.invoices i ON i.id = ip.invoice_id WHERE ip.id = p_payment_id));
  RETURN public.edit_invoice_payment__impl(p_payment_id, p_amount, p_payment_method, p_reference_number,
    p_transfer_to_account, p_transfer_from_account, p_fee_amount, p_fee_on_customer, p_received_by_name, p_reason);
END $$;
GRANT EXECUTE ON FUNCTION public.edit_invoice_payment(uuid, numeric, text, text, text, text, numeric, boolean, text, text) TO authenticated, service_role;

-- 7) void_invoice_payment
ALTER FUNCTION public.void_invoice_payment(uuid, text) RENAME TO void_invoice_payment__impl;
REVOKE ALL ON FUNCTION public.void_invoice_payment__impl(uuid, text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.void_invoice_payment(p_payment_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_same_tenant((SELECT i.tenant_id FROM public.invoice_payments ip
    JOIN public.invoices i ON i.id = ip.invoice_id WHERE ip.id = p_payment_id));
  RETURN public.void_invoice_payment__impl(p_payment_id, p_reason);
END $$;
GRANT EXECUTE ON FUNCTION public.void_invoice_payment(uuid, text) TO authenticated, service_role;

-- 8) edit_payment_transaction
ALTER FUNCTION public.edit_payment_transaction(uuid, numeric, text, text, text, text, numeric, text, text) RENAME TO edit_payment_transaction__impl;
REVOKE ALL ON FUNCTION public.edit_payment_transaction__impl(uuid, numeric, text, text, text, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.edit_payment_transaction(p_tx_id uuid, p_amount numeric, p_payment_method text,
  p_reference_number text, p_transfer_to_account text, p_transfer_from_account text,
  p_fee_amount numeric, p_received_by_name text, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_same_tenant((SELECT tenant_id FROM public.payment_transactions WHERE id = p_tx_id));
  RETURN public.edit_payment_transaction__impl(p_tx_id, p_amount, p_payment_method, p_reference_number,
    p_transfer_to_account, p_transfer_from_account, p_fee_amount, p_received_by_name, p_reason);
END $$;
GRANT EXECUTE ON FUNCTION public.edit_payment_transaction(uuid, numeric, text, text, text, text, numeric, text, text) TO authenticated, service_role;

-- 9) void_payment_transaction
ALTER FUNCTION public.void_payment_transaction(uuid, text) RENAME TO void_payment_transaction__impl;
REVOKE ALL ON FUNCTION public.void_payment_transaction__impl(uuid, text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.void_payment_transaction(p_tx_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_same_tenant((SELECT tenant_id FROM public.payment_transactions WHERE id = p_tx_id));
  RETURN public.void_payment_transaction__impl(p_tx_id, p_reason);
END $$;
GRANT EXECUTE ON FUNCTION public.void_payment_transaction(uuid, text) TO authenticated, service_role;