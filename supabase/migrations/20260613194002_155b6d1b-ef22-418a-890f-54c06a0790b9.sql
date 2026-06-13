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
  v_branch_count int;
  v_summary jsonb := '{}'::jsonb;
  v_n int := 0;
  v_total int := 0;
  v_table text;
  v_disable_tables text[] := ARRAY[
    'invoices','invoice_items','invoice_payments','returns','return_items',
    'purchase_returns','purchase_return_items','shipments','shipment_items',
    'products','product_batches','stock_transfers','treasury','treasury_transfers',
    'contacts','employees','attendance','salaries','advances','advance_payments',
    'advance_requests','payment_plans','payment_installments','payment_transactions',
    'supplier_payments','expenses','stock_adjustments','stock_adjustment_items','inventory_reservations',
    'inventory_sessions','inventory_session_items','inventory_adjustments','vouchers','notifications','audit_log'
  ];
BEGIN
  PERFORM set_config('statement_timeout', '120000', true);

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  IF NOT (public.has_role(v_user, 'admin') OR public.is_super_admin(v_user)) THEN
    RAISE EXCEPTION 'هذا الإجراء متاح للمدير العام فقط';
  END IF;

  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'لا يوجد tenant مرتبط بالمستخدم الحالي';
  END IF;

  IF p_branch_id IS NULL THEN
    SELECT array_agg(id), count(*) INTO v_branches, v_branch_count
    FROM public.branches
    WHERE tenant_id = v_tenant;
  ELSE
    PERFORM 1 FROM public.branches WHERE id = p_branch_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الفرع غير موجود في شركتك';
    END IF;
    v_branches := ARRAY[p_branch_id];
    v_branch_count := 1;
  END IF;

  IF v_branches IS NULL OR array_length(v_branches, 1) IS NULL THEN
    RAISE EXCEPTION 'لا توجد فروع';
  END IF;

  FOREACH v_table IN ARRAY v_disable_tables LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', v_table);
    EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
      NULL;
    END;
  END LOOP;

  IF COALESCE((p_options->>'sales')::boolean, false)
     OR COALESCE((p_options->>'products')::boolean, false) THEN
    v_total := 0;

    DELETE FROM public.customer_credit_log
    WHERE tenant_id = v_tenant
      AND invoice_id IN (SELECT id FROM public.invoices WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.payment_installments
    WHERE payment_plan_id IN (SELECT id FROM public.payment_plans WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches))
       OR payment_transaction_id IN (SELECT id FROM public.payment_transactions WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.payment_transactions WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.payment_plans WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.pre_order_transactions WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.pre_orders WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.quote_items
    WHERE quote_id IN (SELECT id FROM public.quotes WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.quotes WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.return_items
    WHERE return_id IN (SELECT id FROM public.returns WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.returns WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.invoice_payments
    WHERE tenant_id = v_tenant
      AND (branch_id = ANY(v_branches)
        OR invoice_id IN (SELECT id FROM public.invoices WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches)));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.invoice_items
    WHERE invoice_id IN (SELECT id FROM public.invoices WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.treasury
    WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches) AND category IN ('sales','return');
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.vouchers
    WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches)
      AND source_type IN ('invoice','sale','return','sale_return','installment','payment_plan');
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.invoices WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('sales_invoices_deleted', v_n, 'sales_related_deleted', v_total);
  END IF;

  IF COALESCE((p_options->>'returns')::boolean, false)
     AND NOT COALESCE((p_options->>'sales')::boolean, false)
     AND NOT COALESCE((p_options->>'products')::boolean, false) THEN
    v_total := 0;
    DELETE FROM public.return_items
    WHERE return_id IN (SELECT id FROM public.returns WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.treasury WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches) AND category = 'return';
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.vouchers WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches)
      AND source_type IN ('return','sale_return');
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.returns WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('returns_deleted', v_n, 'returns_related_deleted', v_total);
  END IF;

  IF COALESCE((p_options->>'purchase_returns')::boolean, false)
     OR COALESCE((p_options->>'shipments')::boolean, false)
     OR COALESCE((p_options->>'products')::boolean, false) THEN
    v_total := 0;
    DELETE FROM public.purchase_return_items
    WHERE purchase_return_id IN (SELECT id FROM public.purchase_returns WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.treasury WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches) AND category = 'purchase_return';
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.vouchers WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches)
      AND source_type = 'purchase_return';
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.purchase_returns WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('purchase_returns_deleted', v_n, 'purchase_returns_related_deleted', v_total);
  END IF;

  IF COALESCE((p_options->>'shipments')::boolean, false)
     OR COALESCE((p_options->>'products')::boolean, false) THEN
    v_total := 0;
    DELETE FROM public.supplier_payments WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.product_batches WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.shipment_items
    WHERE shipment_id IN (SELECT id FROM public.shipments WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.vouchers WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches)
      AND source_type IN ('shipment','purchase','supplier_payment');
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.shipments WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('shipments_deleted', v_n, 'shipments_related_deleted', v_total);
  END IF;

  IF COALESCE((p_options->>'inventory')::boolean, false)
     AND NOT COALESCE((p_options->>'products')::boolean, false) THEN
    v_total := 0;
    DELETE FROM public.inventory_reservations WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    UPDATE public.product_batches SET quantity_remaining = 0 WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    UPDATE public.products SET quantity = 0 WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('products_zeroed', v_n, 'inventory_related_deleted', v_total);
  END IF;

  IF COALESCE((p_options->>'stock_movements')::boolean, false)
     OR COALESCE((p_options->>'products')::boolean, false) THEN
    v_total := 0;
    DELETE FROM public.inventory_adjustments
    WHERE session_id IN (SELECT id FROM public.inventory_sessions WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.inventory_session_items
    WHERE session_id IN (SELECT id FROM public.inventory_sessions WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.inventory_sessions WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.stock_adjustment_items
    WHERE adjustment_id IN (SELECT id FROM public.stock_adjustments WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.stock_adjustments WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.stock_transfers
    WHERE tenant_id = v_tenant AND (from_branch_id = ANY(v_branches) OR to_branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    v_summary := v_summary || jsonb_build_object('stock_movements_deleted', v_total);
  END IF;

  IF COALESCE((p_options->>'products')::boolean, false) THEN
    v_total := 0;
    DELETE FROM public.inventory_reservations WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.quote_items
    WHERE product_id IN (SELECT id FROM public.products WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.products WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('products_deleted', v_n, 'products_related_deleted', v_total);
  END IF;

  IF COALESCE((p_options->>'treasury')::boolean, false) THEN
    v_total := 0;
    DELETE FROM public.expenses WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.supplier_payments WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.payment_installments
    WHERE payment_plan_id IN (SELECT id FROM public.payment_plans WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches))
       OR payment_transaction_id IN (SELECT id FROM public.payment_transactions WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.payment_transactions WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.payment_plans WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.invoice_payments WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.pre_order_transactions WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.treasury_transfers
    WHERE tenant_id = v_tenant AND (from_branch_id = ANY(v_branches) OR to_branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.vouchers WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.treasury WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('treasury_deleted', v_n, 'treasury_related_deleted', v_total);
  END IF;

  IF COALESCE((p_options->>'customers')::boolean, false) THEN
    DELETE FROM public.customer_credit_log
    WHERE tenant_id = v_tenant
      AND contact_id IN (
        SELECT id FROM public.contacts
        WHERE tenant_id = v_tenant
          AND type IN ('customer','both')
          AND (p_branch_id IS NULL OR branch_id = ANY(v_branches))
      );
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_n;

    DELETE FROM public.contacts
    WHERE tenant_id = v_tenant
      AND type = 'customer'
      AND (p_branch_id IS NULL OR branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('customers_deleted', v_n, 'customer_credit_deleted', v_total);
  END IF;

  IF COALESCE((p_options->>'suppliers')::boolean, false) THEN
    DELETE FROM public.contacts c
    WHERE c.tenant_id = v_tenant
      AND c.type = 'supplier'
      AND (p_branch_id IS NULL OR c.branch_id = ANY(v_branches))
      AND NOT EXISTS (SELECT 1 FROM public.shipments s WHERE s.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.purchase_returns pr WHERE pr.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.supplier_payments sp WHERE sp.contact_id = c.id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('suppliers_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'employees')::boolean, false)
     OR COALESCE((p_options->>'payroll')::boolean, false) THEN
    v_total := 0;
    DELETE FROM public.advance_payments
    WHERE tenant_id = v_tenant
      AND advance_id IN (
        SELECT a.id FROM public.advances a
        JOIN public.employees e ON e.id = a.employee_id
        WHERE e.tenant_id = v_tenant AND e.branch_id = ANY(v_branches)
      );
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.advances
    WHERE tenant_id = v_tenant
      AND employee_id IN (SELECT id FROM public.employees WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.advance_requests
    WHERE tenant_id = v_tenant
      AND (branch_id = ANY(v_branches)
        OR employee_id IN (SELECT id FROM public.employees WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches)));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.salaries
    WHERE tenant_id = v_tenant
      AND employee_id IN (SELECT id FROM public.employees WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    DELETE FROM public.attendance WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    IF COALESCE((p_options->>'employees')::boolean, false) THEN
      DELETE FROM public.employees WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_summary := v_summary || jsonb_build_object('employees_deleted', v_n, 'payroll_related_deleted', v_total);
    ELSE
      v_summary := v_summary || jsonb_build_object('payroll_deleted', v_total);
    END IF;
  END IF;

  IF COALESCE((p_options->>'notifications')::boolean, false) THEN
    IF p_branch_id IS NULL THEN
      DELETE FROM public.notifications WHERE tenant_id = v_tenant;
    ELSE
      DELETE FROM public.notifications
      WHERE tenant_id = v_tenant
        AND (branch_id = ANY(v_branches)
          OR data->>'branch_id' = ANY(SELECT unnest(v_branches)::text));
    END IF;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('notifications_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'audit_log')::boolean, false)
     OR COALESCE((p_options->>'audit')::boolean, false) THEN
    DELETE FROM public.audit_log
    WHERE tenant_id = v_tenant
      AND (p_branch_id IS NULL OR branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('audit_deleted', v_n);
  END IF;

  FOREACH v_table IN ARRAY v_disable_tables LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_table);
    EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
      NULL;
    END;
  END LOOP;

  INSERT INTO public.audit_log (tenant_id, user_id, user_name, branch_id, action, entity, entity_id, details)
  VALUES (v_tenant, v_user, COALESCE((SELECT name FROM public.profiles WHERE id = v_user), 'النظام'), p_branch_id,
          'RESET', 'BranchData', COALESCE(p_branch_id, v_tenant),
          jsonb_build_object('options', p_options, 'summary', v_summary, 'branches', v_branch_count));

  RETURN v_summary;
EXCEPTION WHEN OTHERS THEN
  FOREACH v_table IN ARRAY v_disable_tables LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_table);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
  RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reset_branch_data(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reset_branch_data(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_branch_data(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_branch_data(uuid, jsonb) TO service_role;