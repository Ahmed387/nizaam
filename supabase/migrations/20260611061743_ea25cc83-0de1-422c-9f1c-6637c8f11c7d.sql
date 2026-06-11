CREATE OR REPLACE FUNCTION public.admin_reset_branch_data(p_branch_id uuid, p_options jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_branches uuid[];
  v_summary jsonb := '{}'::jsonb;
  v_n int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF NOT (public.has_role(v_user, 'admin') OR public.is_super_admin(v_user)) THEN
    RAISE EXCEPTION 'هذا الإجراء متاح للمدير العام فقط';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL AND NOT public.is_super_admin(v_user) THEN
    RAISE EXCEPTION 'لا يوجد tenant';
  END IF;
  IF p_branch_id IS NULL THEN
    SELECT array_agg(id) INTO v_branches FROM public.branches WHERE tenant_id = v_tenant;
  ELSE
    PERFORM 1 FROM public.branches WHERE id = p_branch_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'الفرع غير موجود في شركتك'; END IF;
    v_branches := ARRAY[p_branch_id];
  END IF;
  IF v_branches IS NULL OR array_length(v_branches,1) IS NULL THEN
    RAISE EXCEPTION 'لا توجد فروع';
  END IF;

  IF COALESCE((p_options->>'sales')::boolean, false) THEN
    DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE branch_id = ANY(v_branches));
    DELETE FROM public.returns WHERE branch_id = ANY(v_branches);
    DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE branch_id = ANY(v_branches));
    DELETE FROM public.treasury WHERE branch_id = ANY(v_branches) AND category IN ('sales','return');
    DELETE FROM public.invoices WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('sales_invoices_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'returns')::boolean, false) AND NOT COALESCE((p_options->>'sales')::boolean, false) THEN
    DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE branch_id = ANY(v_branches));
    DELETE FROM public.treasury WHERE branch_id = ANY(v_branches) AND category = 'return';
    DELETE FROM public.returns WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('returns_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'purchase_returns')::boolean, false) THEN
    DELETE FROM public.purchase_return_items WHERE purchase_return_id IN (SELECT id FROM public.purchase_returns WHERE branch_id = ANY(v_branches));
    DELETE FROM public.treasury WHERE branch_id = ANY(v_branches) AND category = 'purchase_return';
    DELETE FROM public.purchase_returns WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('purchase_returns_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'inventory')::boolean, false) THEN
    UPDATE public.products SET quantity = 0 WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('products_zeroed', v_n);
  END IF;

  IF COALESCE((p_options->>'products')::boolean, false) THEN
    DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE branch_id = ANY(v_branches));
    DELETE FROM public.returns WHERE branch_id = ANY(v_branches);
    DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE branch_id = ANY(v_branches));
    DELETE FROM public.treasury WHERE branch_id = ANY(v_branches) AND category IN ('sales','return','purchase_return');
    DELETE FROM public.invoices WHERE branch_id = ANY(v_branches);
    DELETE FROM public.purchase_return_items WHERE purchase_return_id IN (SELECT id FROM public.purchase_returns WHERE branch_id = ANY(v_branches));
    DELETE FROM public.purchase_returns WHERE branch_id = ANY(v_branches);
    DELETE FROM public.shipment_items WHERE shipment_id IN (SELECT id FROM public.shipments WHERE branch_id = ANY(v_branches));
    DELETE FROM public.shipments WHERE branch_id = ANY(v_branches);
    DELETE FROM public.stock_transfers WHERE from_branch_id = ANY(v_branches) OR to_branch_id = ANY(v_branches);
    DELETE FROM public.products WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('products_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'shipments')::boolean, false) THEN
    DELETE FROM public.purchase_return_items WHERE purchase_return_id IN (SELECT id FROM public.purchase_returns WHERE branch_id = ANY(v_branches));
    DELETE FROM public.treasury WHERE branch_id = ANY(v_branches) AND category = 'purchase_return';
    DELETE FROM public.purchase_returns WHERE branch_id = ANY(v_branches);
    DELETE FROM public.shipment_items WHERE shipment_id IN (SELECT id FROM public.shipments WHERE branch_id = ANY(v_branches));
    DELETE FROM public.shipments WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('shipments_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'expenses')::boolean, false) THEN
    DELETE FROM public.treasury WHERE branch_id = ANY(v_branches)
      AND reference_id IN (SELECT id FROM public.expenses WHERE branch_id = ANY(v_branches));
    DELETE FROM public.expenses WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('expenses_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'treasury')::boolean, false) THEN
    DELETE FROM public.treasury_transfers WHERE from_branch_id = ANY(v_branches) OR to_branch_id = ANY(v_branches);
    DELETE FROM public.treasury WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('treasury_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'stock_movements')::boolean, false) THEN
    DELETE FROM public.stock_transfers WHERE from_branch_id = ANY(v_branches) OR to_branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('stock_transfers_deleted', v_n);
  END IF;

  -- FIXED: use contacts (type='customer') instead of non-existent customers table
  IF COALESCE((p_options->>'customers')::boolean, false) THEN
    DELETE FROM public.contacts c
      WHERE c.tenant_id = v_tenant
        AND c.type = 'customer'
        AND (c.branch_id IS NULL OR c.branch_id = ANY(v_branches))
        AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.customer_id = c.id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('customers_deleted', v_n);
  END IF;

  -- FIXED: use contacts (type='supplier') instead of non-existent suppliers table
  IF COALESCE((p_options->>'suppliers')::boolean, false) THEN
    DELETE FROM public.contacts s
      WHERE s.tenant_id = v_tenant
        AND s.type = 'supplier'
        AND NOT EXISTS (SELECT 1 FROM public.shipments sh WHERE sh.supplier_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM public.purchase_returns pr WHERE pr.supplier_id = s.id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('suppliers_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'employees')::boolean, false) THEN
    DELETE FROM public.advance_payments WHERE advance_id IN (SELECT id FROM public.advances WHERE employee_id IN (SELECT id FROM public.employees WHERE branch_id = ANY(v_branches)));
    DELETE FROM public.advances WHERE employee_id IN (SELECT id FROM public.employees WHERE branch_id = ANY(v_branches));
    DELETE FROM public.salaries WHERE employee_id IN (SELECT id FROM public.employees WHERE branch_id = ANY(v_branches));
    DELETE FROM public.employees WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('employees_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'payroll')::boolean, false) AND NOT COALESCE((p_options->>'employees')::boolean, false) THEN
    DELETE FROM public.advance_payments;
    DELETE FROM public.advances;
    DELETE FROM public.salaries;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('payroll_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'notifications')::boolean, false) THEN
    DELETE FROM public.notifications WHERE tenant_id = v_tenant;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('notifications_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'audit_log')::boolean, false) THEN
    DELETE FROM public.audit_log WHERE tenant_id = v_tenant;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('audit_log_deleted', v_n);
  END IF;

  RETURN v_summary;
END;
$function$;