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
  v_n int;
  v_total int;
  v_disable_tables text[] := ARRAY[
    'invoices','invoice_items','returns','return_items','purchase_returns','purchase_return_items',
    'shipments','shipment_items','products','product_batches','stock_transfers','treasury',
    'treasury_transfers','contacts','employees','payment_plans','payment_installments',
    'payment_transactions','supplier_payments','stock_adjustments','stock_adjustment_items',
    'vouchers'
  ];
  v_table text;
BEGIN
  PERFORM set_config('statement_timeout', '0', true);

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول';
  END IF;

  IF NOT (public.has_role(v_user, 'admin') OR public.is_super_admin(v_user)) THEN
    RAISE EXCEPTION 'هذا الإجراء متاح للمدير العام فقط';
  END IF;

  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL AND NOT public.is_super_admin(v_user) THEN
    RAISE EXCEPTION 'لا يوجد tenant';
  END IF;

  IF p_branch_id IS NULL THEN
    SELECT array_agg(id), count(*) INTO v_branches, v_branch_count
    FROM public.branches WHERE tenant_id = v_tenant;
  ELSE
    PERFORM 1 FROM public.branches WHERE id = p_branch_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'الفرع غير موجود في شركتك'; END IF;
    v_branches := ARRAY[p_branch_id];
    v_branch_count := 1;
  END IF;

  IF v_branches IS NULL OR array_length(v_branches, 1) IS NULL THEN
    RAISE EXCEPTION 'لا توجد فروع';
  END IF;

  FOREACH v_table IN ARRAY v_disable_tables LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', v_table);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
  END LOOP;

  IF COALESCE((p_options->>'sales')::boolean, false)
     OR COALESCE((p_options->>'products')::boolean, false) THEN
    v_total := 0;

    DELETE FROM public.customer_credit_log
    WHERE invoice_id IN (SELECT id FROM public.invoices WHERE branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.payment_transactions WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.payment_installments
    WHERE payment_plan_id IN (SELECT id FROM public.payment_plans WHERE branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.payment_plans WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.pre_order_transactions WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.pre_orders WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.quote_items
    WHERE quote_id IN (SELECT id FROM public.quotes WHERE branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.quotes WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.return_items
    WHERE return_id IN (SELECT id FROM public.returns WHERE branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.returns WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.invoice_payments
    WHERE invoice_id IN (SELECT id FROM public.invoices WHERE branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.invoice_items
    WHERE invoice_id IN (SELECT id FROM public.invoices WHERE branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.treasury
    WHERE branch_id = ANY(v_branches) AND category IN ('sales','return');
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.vouchers
    WHERE branch_id = ANY(v_branches)
      AND source_type IN ('invoice','sale','return','sale_return','installment','payment_plan');
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.invoices WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('sales_invoices_deleted', v_n, 'sales_related_deleted', v_total);
  END IF;

  IF COALESCE((p_options->>'returns')::boolean, false)
     AND NOT COALESCE((p_options->>'sales')::boolean, false)
     AND NOT COALESCE((p_options->>'products')::boolean, false) THEN
    DELETE FROM public.return_items
    WHERE return_id IN (SELECT id FROM public.returns WHERE branch_id = ANY(v_branches));
    DELETE FROM public.treasury WHERE branch_id = ANY(v_branches) AND category = 'return';
    DELETE FROM public.vouchers WHERE branch_id = ANY(v_branches)
      AND source_type IN ('return','sale_return');
    DELETE FROM public.returns WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('returns_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'purchase_returns')::boolean, false)
     OR COALESCE((p_options->>'shipments')::boolean, false)
     OR COALESCE((p_options->>'products')::boolean, false) THEN
    DELETE FROM public.purchase_return_items
    WHERE purchase_return_id IN (SELECT id FROM public.purchase_returns WHERE branch_id = ANY(v_branches));
    DELETE FROM public.treasury WHERE branch_id = ANY(v_branches) AND category = 'purchase_return';
    DELETE FROM public.vouchers WHERE branch_id = ANY(v_branches)
      AND source_type IN ('purchase_return');
    DELETE FROM public.purchase_returns WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('purchase_returns_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'shipments')::boolean, false)
     OR COALESCE((p_options->>'products')::boolean, false) THEN
    v_total := 0;

    DELETE FROM public.supplier_payments WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.product_batches WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.shipment_items
    WHERE shipment_id IN (SELECT id FROM public.shipments WHERE branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.vouchers WHERE branch_id = ANY(v_branches)
      AND source_type IN ('shipment','purchase','supplier_payment');
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.shipments WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('shipments_deleted', v_n, 'shipments_related_deleted', v_total);
  END IF;

  IF COALESCE((p_options->>'inventory')::boolean, false)
     AND NOT COALESCE((p_options->>'products')::boolean, false) THEN
    DELETE FROM public.inventory_reservations WHERE branch_id = ANY(v_branches);
    UPDATE public.product_batches SET quantity_remaining = 0 WHERE branch_id = ANY(v_branches);
    UPDATE public.products SET quantity = 0 WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('products_zeroed', v_n);
  END IF;

  IF COALESCE((p_options->>'stock_movements')::boolean, false)
     OR COALESCE((p_options->>'products')::boolean, false) THEN
    v_total := 0;

    DELETE FROM public.inventory_adjustments
    WHERE session_id IN (SELECT id FROM public.inventory_sessions WHERE branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.inventory_session_items
    WHERE session_id IN (SELECT id FROM public.inventory_sessions WHERE branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.inventory_sessions WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.stock_adjustment_items
    WHERE adjustment_id IN (SELECT id FROM public.stock_adjustments WHERE branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.stock_adjustments WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.stock_transfers
    WHERE from_branch_id = ANY(v_branches) OR to_branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    v_summary := v_summary || jsonb_build_object('stock_movements_deleted', v_total);
  END IF;

  IF COALESCE((p_options->>'products')::boolean, false) THEN
    DELETE FROM public.inventory_reservations WHERE branch_id = ANY(v_branches);
    DELETE FROM public.quote_items
    WHERE product_id IN (SELECT id FROM public.products WHERE branch_id = ANY(v_branches));
    DELETE FROM public.products WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('products_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'treasury')::boolean, false) THEN
    v_total := 0;

    DELETE FROM public.supplier_payments WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.payment_transactions WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.treasury_transfers
    WHERE from_branch_id = ANY(v_branches) OR to_branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.vouchers WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.treasury WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('treasury_deleted', v_n, 'treasury_related_deleted', v_total);
  END IF;

  IF COALESCE((p_options->>'customers')::boolean, false) THEN
    DELETE FROM public.customer_credit_log
    WHERE contact_id IN (
      SELECT id FROM public.contacts WHERE tenant_id = v_tenant AND type = 'customer'
    );
    DELETE FROM public.contacts WHERE tenant_id = v_tenant AND type = 'customer';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('customers_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'employees')::boolean, false) THEN
    DELETE FROM public.advance_payments
    WHERE advance_id IN (SELECT id FROM public.advances WHERE branch_id = ANY(v_branches));
    DELETE FROM public.advances WHERE branch_id = ANY(v_branches);
    DELETE FROM public.advance_requests WHERE branch_id = ANY(v_branches);
    DELETE FROM public.salaries WHERE branch_id = ANY(v_branches);
    DELETE FROM public.attendance WHERE branch_id = ANY(v_branches);
    DELETE FROM public.employees WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('employees_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'notifications')::boolean, false) THEN
    DELETE FROM public.notifications WHERE branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('notifications_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'audit')::boolean, false) THEN
    DELETE FROM public.audit_log WHERE tenant_id = v_tenant;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('audit_deleted', v_n);
  END IF;

  FOREACH v_table IN ARRAY v_disable_tables LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_table);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
  END LOOP;

  INSERT INTO public.audit_log (tenant_id, user_id, user_name, action, entity, entity_id, details)
  VALUES (v_tenant, v_user, COALESCE((SELECT name FROM public.profiles WHERE id = v_user), 'النظام'),
          'RESET', 'BranchData', COALESCE(p_branch_id, v_tenant),
          jsonb_build_object('options', p_options, 'summary', v_summary, 'branches', v_branch_count));

  RETURN v_summary;
EXCEPTION WHEN OTHERS THEN
  FOREACH v_table IN ARRAY v_disable_tables LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_table);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
  RAISE;
END;
$function$;