-- 1) approve_inventory_session
ALTER FUNCTION public.approve_inventory_session(uuid) RENAME TO approve_inventory_session__impl;
REVOKE ALL ON FUNCTION public.approve_inventory_session__impl(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_inventory_session(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_user uuid := auth.uid(); v_s record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT tenant_id, branch_id INTO v_s FROM public.inventory_sessions WHERE id = p_session_id;
  IF v_s IS NULL THEN RAISE EXCEPTION 'session not found'; END IF;
  PERFORM public.assert_same_tenant(v_s.tenant_id);
  IF NOT (public.is_super_admin(v_user) OR public.is_admin(v_user)
          OR public.has_role(v_user,'owner') OR public.has_role(v_user,'accountant')
          OR ((public.has_role(v_user,'branch_manager') OR public.has_role(v_user,'warehouse'))
              AND public.user_in_branch(v_user, v_s.branch_id))) THEN
    RAISE EXCEPTION 'لا تملك صلاحية اعتماد الجرد';
  END IF;
  PERFORM public.approve_inventory_session__impl(p_session_id);
END $$;
GRANT EXECUTE ON FUNCTION public.approve_inventory_session(uuid) TO authenticated;

-- 2) cancel_pre_order
ALTER FUNCTION public.cancel_pre_order(uuid, boolean) RENAME TO cancel_pre_order__impl;
REVOKE ALL ON FUNCTION public.cancel_pre_order__impl(uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_pre_order(p_pre_order_id uuid, p_refund boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.pre_orders WHERE id = p_pre_order_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'الحجز غير موجود'; END IF;
  PERFORM public.assert_same_tenant(v_tenant);
  PERFORM public.cancel_pre_order__impl(p_pre_order_id, p_refund);
END $$;
GRANT EXECUTE ON FUNCTION public.cancel_pre_order(uuid, boolean) TO authenticated;

-- 3) edit_invoice (3 overloads)
ALTER FUNCTION public.edit_invoice(uuid, uuid, jsonb) RENAME TO edit_invoice__impl;
ALTER FUNCTION public.edit_invoice(uuid, uuid, jsonb, numeric) RENAME TO edit_invoice__impl;
ALTER FUNCTION public.edit_invoice(uuid, uuid, jsonb, numeric, numeric) RENAME TO edit_invoice__impl;
REVOKE ALL ON FUNCTION public.edit_invoice__impl(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.edit_invoice__impl(uuid, uuid, jsonb, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.edit_invoice__impl(uuid, uuid, jsonb, numeric, numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assert_can_edit_invoice(p_invoice_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_user uuid := auth.uid(); v_inv record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT tenant_id, branch_id INTO v_inv FROM public.invoices WHERE id = p_invoice_id;
  IF v_inv IS NULL THEN RAISE EXCEPTION 'الفاتورة غير موجودة'; END IF;
  PERFORM public.assert_same_tenant(v_inv.tenant_id);
  IF NOT (public.is_super_admin(v_user) OR public.is_admin(v_user) OR public.has_role(v_user,'owner')
          OR (public.has_role(v_user,'branch_manager') AND public.user_in_branch(v_user, v_inv.branch_id))) THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل هذه الفاتورة';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.edit_invoice(_invoice_id uuid, _customer_id uuid, _items jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.assert_can_edit_invoice(_invoice_id);
  PERFORM public.edit_invoice__impl(_invoice_id, _customer_id, _items);
END $$;
CREATE OR REPLACE FUNCTION public.edit_invoice(_invoice_id uuid, _customer_id uuid, _items jsonb, _vat_rate numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.assert_can_edit_invoice(_invoice_id);
  PERFORM public.edit_invoice__impl(_invoice_id, _customer_id, _items, _vat_rate);
END $$;
CREATE OR REPLACE FUNCTION public.edit_invoice(_invoice_id uuid, _customer_id uuid, _items jsonb, _vat_rate numeric, _discount_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.assert_can_edit_invoice(_invoice_id);
  PERFORM public.edit_invoice__impl(_invoice_id, _customer_id, _items, _vat_rate, _discount_amount);
END $$;
GRANT EXECUTE ON FUNCTION public.edit_invoice(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_invoice(uuid, uuid, jsonb, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_invoice(uuid, uuid, jsonb, numeric, numeric) TO authenticated;

-- 4) partial_confirm_transfer
ALTER FUNCTION public.partial_confirm_transfer(uuid, integer) RENAME TO partial_confirm_transfer__impl;
REVOKE ALL ON FUNCTION public.partial_confirm_transfer__impl(uuid, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.partial_confirm_transfer(p_transfer_id uuid, p_received integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_user uuid := auth.uid(); v_t record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT tenant_id, to_branch_id, from_branch_id INTO v_t FROM public.stock_transfers WHERE id = p_transfer_id;
  IF v_t IS NULL THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  PERFORM public.assert_same_tenant(v_t.tenant_id);
  IF NOT (public.is_super_admin(v_user) OR public.is_admin(v_user) OR public.has_role(v_user,'owner')
          OR public.user_in_branch(v_user, v_t.to_branch_id)) THEN
    RAISE EXCEPTION 'لا تملك صلاحية تأكيد هذا التحويل';
  END IF;
  RETURN public.partial_confirm_transfer__impl(p_transfer_id, p_received);
END $$;
GRANT EXECUTE ON FUNCTION public.partial_confirm_transfer(uuid, integer) TO authenticated;

-- 5) treasury transfers
ALTER FUNCTION public.acknowledge_treasury_transfer(uuid) RENAME TO acknowledge_treasury_transfer__impl;
REVOKE ALL ON FUNCTION public.acknowledge_treasury_transfer__impl(uuid) FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.reject_treasury_transfer(uuid, text) RENAME TO reject_treasury_transfer__impl;
REVOKE ALL ON FUNCTION public.reject_treasury_transfer__impl(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.acknowledge_treasury_transfer(p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.treasury_transfers WHERE id = p_transfer_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  PERFORM public.assert_same_tenant(v_tenant);
  PERFORM public.acknowledge_treasury_transfer__impl(p_transfer_id);
END $$;
CREATE OR REPLACE FUNCTION public.reject_treasury_transfer(p_transfer_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.treasury_transfers WHERE id = p_transfer_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  PERFORM public.assert_same_tenant(v_tenant);
  PERFORM public.reject_treasury_transfer__impl(p_transfer_id, p_reason);
END $$;
GRANT EXECUTE ON FUNCTION public.acknowledge_treasury_transfer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_treasury_transfer(uuid, text) TO authenticated;