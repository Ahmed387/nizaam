CREATE OR REPLACE FUNCTION public.admin_reset_go_live_extras(p_branch_id uuid, p_options jsonb)
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
  v_n int := 0;
  v_total int := 0;
  v_skipped int := 0;
BEGIN
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
    SELECT array_agg(id) INTO v_branches FROM public.branches WHERE tenant_id = v_tenant;
  ELSE
    PERFORM 1 FROM public.branches WHERE id = p_branch_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الفرع غير موجود في شركتك';
    END IF;
    v_branches := ARRAY[p_branch_id];
  END IF;

  IF v_branches IS NULL OR array_length(v_branches, 1) IS NULL THEN
    RAISE EXCEPTION 'لا توجد فروع';
  END IF;

  -- 1) تصفير ترقيم السندات
  IF COALESCE((p_options->>'voucher_sequences')::boolean, false) THEN
    DELETE FROM public.voucher_sequences WHERE tenant_id = v_tenant;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('voucher_sequences_reset', v_n);
  END IF;

  -- 2) الورديات المعلّقة (حركات تشغيلية فقط — جداول الورديات shift_schedules إعدادات ثابتة ولا تُمس)
  IF COALESCE((p_options->>'shifts')::boolean, false) THEN
    v_total := 0;
    DELETE FROM public.shift_cash_handovers
    WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.cashier_shifts
    WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    v_summary := v_summary || jsonb_build_object('shifts_deleted', v_total);
  END IF;

  -- 3) فتح الفترات المالية
  IF COALESCE((p_options->>'fiscal_periods')::boolean, false) THEN
    v_total := 0;
    DELETE FROM public.branch_closures
    WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    IF p_branch_id IS NULL THEN
      DELETE FROM public.fiscal_periods WHERE tenant_id = v_tenant;
      GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;
    END IF;

    v_summary := v_summary || jsonb_build_object('fiscal_periods_opened', v_total);
  END IF;

  -- 4) المرفقات اليتيمة
  IF COALESCE((p_options->>'attachments')::boolean, false) THEN
    v_total := 0;
    DELETE FROM public.voucher_attachments va
    WHERE NOT EXISTS (SELECT 1 FROM public.vouchers v WHERE v.id = va.voucher_id);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.attachments a
    WHERE a.tenant_id = v_tenant
      AND NOT EXISTS (SELECT 1 FROM public.invoices t WHERE t.id = a.record_id)
      AND NOT EXISTS (SELECT 1 FROM public.shipments t WHERE t.id = a.record_id)
      AND NOT EXISTS (SELECT 1 FROM public.vouchers t WHERE t.id = a.record_id)
      AND NOT EXISTS (SELECT 1 FROM public.returns t WHERE t.id = a.record_id)
      AND NOT EXISTS (SELECT 1 FROM public.purchase_returns t WHERE t.id = a.record_id)
      AND NOT EXISTS (SELECT 1 FROM public.contacts t WHERE t.id = a.record_id)
      AND NOT EXISTS (SELECT 1 FROM public.products t WHERE t.id = a.record_id)
      AND NOT EXISTS (SELECT 1 FROM public.expenses t WHERE t.id = a.record_id)
      AND NOT EXISTS (SELECT 1 FROM public.employees t WHERE t.id = a.record_id)
      AND NOT EXISTS (SELECT 1 FROM public.stock_transfers t WHERE t.id = a.record_id)
      AND NOT EXISTS (SELECT 1 FROM public.stock_adjustments t WHERE t.id = a.record_id)
      AND NOT EXISTS (SELECT 1 FROM public.treasury t WHERE t.id = a.record_id)
      AND NOT EXISTS (SELECT 1 FROM public.quotes t WHERE t.id = a.record_id)
      AND NOT EXISTS (SELECT 1 FROM public.fixed_assets t WHERE t.id = a.record_id);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    v_summary := v_summary || jsonb_build_object('orphan_attachments_deleted', v_total);
  END IF;

  -- 5) حركات الجرد والاعتمادات
  IF COALESCE((p_options->>'count_moves')::boolean, false) THEN
    DELETE FROM public.inventory_count_batch_moves m
    WHERE m.tenant_id = v_tenant
      AND (
        NOT EXISTS (SELECT 1 FROM public.inventory_sessions s WHERE s.id = m.session_id)
        OR EXISTS (SELECT 1 FROM public.inventory_sessions s WHERE s.id = m.session_id AND s.branch_id = ANY(v_branches))
      );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('count_moves_deleted', v_n);
  END IF;

  IF COALESCE((p_options->>'approvals')::boolean, false) THEN
    v_total := 0;
    DELETE FROM public.approval_requests
    WHERE tenant_id = v_tenant AND (branch_id IS NULL OR branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.discount_approval_requests
    WHERE tenant_id = v_tenant AND (branch_id IS NULL OR branch_id = ANY(v_branches));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    v_summary := v_summary || jsonb_build_object('approvals_deleted', v_total);
  END IF;

  -- 6) تصفير أرصدة وديون العملاء (مع الحفاظ على بيانات العميل)
  IF COALESCE((p_options->>'customer_balances')::boolean, false) THEN
    v_total := 0;
    DELETE FROM public.customer_credit_log ccl
    WHERE ccl.tenant_id = v_tenant
      AND ccl.contact_id IN (
        SELECT c.id FROM public.contacts c
        WHERE c.tenant_id = v_tenant
          AND c.type IN ('customer','both')
          AND (p_branch_id IS NULL OR c.branch_id = ANY(v_branches))
      );
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    UPDATE public.contacts c
    SET credit_balance = 0, opening_balance = 0
    WHERE c.tenant_id = v_tenant
      AND c.type IN ('customer','both')
      AND (p_branch_id IS NULL OR c.branch_id = ANY(v_branches))
      AND (COALESCE(c.credit_balance,0) <> 0 OR COALESCE(c.opening_balance,0) <> 0);
    GET DIAGNOSTICS v_n = ROW_COUNT;

    v_summary := v_summary || jsonb_build_object('customer_balances_zeroed', v_n, 'customer_credit_log_deleted', v_total);
  END IF;

  -- 7) جهات الاتصال غير المرتبطة بأي حركات
  IF COALESCE((p_options->>'orphan_contacts')::boolean, false) THEN
    DELETE FROM public.contacts c
    WHERE c.tenant_id = v_tenant
      AND (p_branch_id IS NULL OR c.branch_id = ANY(v_branches))
      AND NOT EXISTS (SELECT 1 FROM public.invoices t WHERE t.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.returns t JOIN public.invoices iv ON iv.id = t.invoice_id WHERE iv.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.shipments t WHERE t.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.purchase_returns t WHERE t.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.supplier_payments t WHERE t.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.quotes t WHERE t.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.pre_orders t WHERE t.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.vouchers t WHERE t.party_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.customer_credit_log t WHERE t.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.payment_plans t WHERE t.entity_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.attachments t WHERE t.record_id = c.id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_summary := v_summary || jsonb_build_object('orphan_contacts_deleted', v_n);
  END IF;

  -- 8) مسح كروت العملاء والموردين نهائياً (تخطي المرتبط بمستندات)
  IF COALESCE((p_options->>'all_contacts')::boolean, false) THEN
    DELETE FROM public.customer_credit_log ccl
    WHERE ccl.tenant_id = v_tenant
      AND ccl.contact_id IN (
        SELECT c.id FROM public.contacts c
        WHERE c.tenant_id = v_tenant
          AND (p_branch_id IS NULL OR c.branch_id = ANY(v_branches))
      );

    DELETE FROM public.attachments a
    WHERE a.tenant_id = v_tenant
      AND a.record_id IN (
        SELECT c.id FROM public.contacts c
        WHERE c.tenant_id = v_tenant
          AND (p_branch_id IS NULL OR c.branch_id = ANY(v_branches))
      );

    SELECT count(*) INTO v_skipped
    FROM public.contacts c
    WHERE c.tenant_id = v_tenant
      AND (p_branch_id IS NULL OR c.branch_id = ANY(v_branches))
      AND (
        EXISTS (SELECT 1 FROM public.invoices t WHERE t.contact_id = c.id)
        OR EXISTS (SELECT 1 FROM public.returns t JOIN public.invoices iv ON iv.id = t.invoice_id WHERE iv.contact_id = c.id)
        OR EXISTS (SELECT 1 FROM public.shipments t WHERE t.contact_id = c.id)
        OR EXISTS (SELECT 1 FROM public.purchase_returns t WHERE t.contact_id = c.id)
        OR EXISTS (SELECT 1 FROM public.supplier_payments t WHERE t.contact_id = c.id)
        OR EXISTS (SELECT 1 FROM public.quotes t WHERE t.contact_id = c.id)
        OR EXISTS (SELECT 1 FROM public.pre_orders t WHERE t.contact_id = c.id)
        OR EXISTS (SELECT 1 FROM public.vouchers t WHERE t.party_id = c.id)
        OR EXISTS (SELECT 1 FROM public.payment_plans t WHERE t.entity_id = c.id)
      );

    DELETE FROM public.contacts c
    WHERE c.tenant_id = v_tenant
      AND (p_branch_id IS NULL OR c.branch_id = ANY(v_branches))
      AND NOT EXISTS (SELECT 1 FROM public.invoices t WHERE t.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.returns t JOIN public.invoices iv ON iv.id = t.invoice_id WHERE iv.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.shipments t WHERE t.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.purchase_returns t WHERE t.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.supplier_payments t WHERE t.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.quotes t WHERE t.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.pre_orders t WHERE t.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.vouchers t WHERE t.party_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.payment_plans t WHERE t.entity_id = c.id);
    GET DIAGNOSTICS v_n = ROW_COUNT;

    v_summary := v_summary || jsonb_build_object('contacts_deleted', v_n, 'contacts_skipped_linked', v_skipped);
  END IF;

  -- 9) مسح الشركاء وحصصهم (كل الفروع فقط)
  IF COALESCE((p_options->>'partners')::boolean, false) AND p_branch_id IS NULL THEN
    v_total := 0;

    DELETE FROM public.partner_advance_payments pap
    WHERE EXISTS (SELECT 1 FROM public.partner_advances a WHERE a.id = pap.advance_id AND a.tenant_id = v_tenant);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.partner_advance_installments pai
    WHERE EXISTS (SELECT 1 FROM public.partner_advances a WHERE a.id = pai.advance_id AND a.tenant_id = v_tenant);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.partner_advances WHERE tenant_id = v_tenant;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.profit_distribution_lines pdl
    WHERE EXISTS (SELECT 1 FROM public.profit_distributions d WHERE d.id = pdl.distribution_id AND d.tenant_id = v_tenant);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.profit_distributions WHERE tenant_id = v_tenant;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.partner_transactions WHERE tenant_id = v_tenant;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.partner_share_history WHERE tenant_id = v_tenant;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.partner_users WHERE tenant_id = v_tenant;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.branch_capital_allocations WHERE tenant_id = v_tenant;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.equity_partners WHERE tenant_id = v_tenant;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    v_summary := v_summary || jsonb_build_object('partners_records_deleted', v_total);
  END IF;

  IF v_summary <> '{}'::jsonb THEN
    INSERT INTO public.audit_log (tenant_id, user_id, user_name, branch_id, action, entity, entity_id, details)
    VALUES (v_tenant, v_user, COALESCE((SELECT name FROM public.profiles WHERE id = v_user), 'النظام'), p_branch_id,
            'RESET', 'GoLiveExtras', COALESCE(p_branch_id, v_tenant),
            jsonb_build_object('options', p_options, 'summary', v_summary));
  END IF;

  RETURN v_summary;
END;
$function$;