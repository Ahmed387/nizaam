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
    SELECT array_agg(id) INTO v_branches
      FROM public.branches WHERE tenant_id = v_tenant;
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

  IF COALESCE((p_options->>'inventory')::boolean, false) THEN
    UPDATE public.products SET quantity = 0 WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('products_zeroed', v_n);
  END IF;

  IF COALESCE((p_options->>'products')::boolean, false) THEN
    DELETE FROM public.return_items WHERE return_id IN (SELECT id FROM public.returns WHERE branch_id = ANY(v_branches));
    DELETE FROM public.returns WHERE branch_id = ANY(v_branches);
    DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE branch_id = ANY(v_branches));
    DELETE FROM public.treasury WHERE branch_id = ANY(v_branches) AND category IN ('sales','return');
    DELETE FROM public.invoices WHERE branch_id = ANY(v_branches);
    DELETE FROM public.shipment_items WHERE shipment_id IN (SELECT id FROM public.shipments WHERE branch_id = ANY(v_branches));
    DELETE FROM public.shipments WHERE branch_id = ANY(v_branches);
    DELETE FROM public.stock_transfers WHERE from_branch_id = ANY(v_branches) OR to_branch_id = ANY(v_branches);
    DELETE FROM public.products WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('products_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'shipments')::boolean, false) THEN
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

  IF COALESCE((p_options->>'customers')::boolean, false) THEN
    DELETE FROM public.customers c WHERE c.branch_id = ANY(v_branches)
      AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.customer_id = c.id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('customers_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'payroll')::boolean, false) THEN
    DELETE FROM public.advance_payments WHERE advance_id IN (
      SELECT a.id FROM public.advances a JOIN public.employees e ON e.id = a.employee_id
      WHERE e.branch_id = ANY(v_branches));
    DELETE FROM public.advance_requests WHERE branch_id = ANY(v_branches);
    DELETE FROM public.advances a USING public.employees e
      WHERE a.employee_id = e.id AND e.branch_id = ANY(v_branches);
    DELETE FROM public.salaries s USING public.employees e
      WHERE s.employee_id = e.id AND e.branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('payroll_deleted', v_n);
  END IF;

  -- NEW: suppliers (only if no shipments reference them in scope; nuke supplier_payments first)
  IF COALESCE((p_options->>'suppliers')::boolean, false) THEN
    DELETE FROM public.supplier_payments WHERE branch_id = ANY(v_branches);
    -- delete suppliers in tenant that have no remaining shipments anywhere
    DELETE FROM public.suppliers s
     WHERE s.tenant_id = v_tenant
       AND NOT EXISTS (SELECT 1 FROM public.shipments sh WHERE sh.supplier_id = s.id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('suppliers_deleted', v_n);
  END IF;

  -- NEW: employees (wipes payroll dependencies first)
  IF COALESCE((p_options->>'employees')::boolean, false) THEN
    DELETE FROM public.advance_payments WHERE advance_id IN (
      SELECT a.id FROM public.advances a JOIN public.employees e ON e.id = a.employee_id
      WHERE e.branch_id = ANY(v_branches));
    DELETE FROM public.advance_requests WHERE branch_id = ANY(v_branches);
    DELETE FROM public.advances a USING public.employees e
      WHERE a.employee_id = e.id AND e.branch_id = ANY(v_branches);
    DELETE FROM public.salaries s USING public.employees e
      WHERE s.employee_id = e.id AND e.branch_id = ANY(v_branches);
    DELETE FROM public.employees WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('employees_deleted', v_n);
  END IF;

  -- NEW: notifications (tenant-wide)
  IF COALESCE((p_options->>'notifications')::boolean, false) THEN
    DELETE FROM public.notifications WHERE tenant_id = v_tenant;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('notifications_deleted', v_n);
  END IF;

  -- NEW: audit log (scoped to branches if specific, else whole tenant)
  IF COALESCE((p_options->>'audit_log')::boolean, false) THEN
    IF p_branch_id IS NULL THEN
      DELETE FROM public.audit_log WHERE tenant_id = v_tenant;
    ELSE
      DELETE FROM public.audit_log WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    END IF;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('audit_log_deleted', v_n);
  END IF;

  INSERT INTO public.audit_log(user_id, user_name, tenant_id, branch_id, action, entity, entity_id, details)
  VALUES (
    v_user,
    COALESCE((SELECT name FROM public.profiles WHERE id = v_user), 'admin'),
    v_tenant, p_branch_id, 'RESET_DATA', 'admin_reset',
    COALESCE(p_branch_id::text, 'ALL_BRANCHES'),
    jsonb_build_object('options', p_options, 'branches', v_branches, 'summary', v_summary)
  );

  RETURN v_summary;
END;
$function$;