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

  -- 2) الورديات المعلّقة
  IF COALESCE((p_options->>'shifts')::boolean, false) THEN
    v_total := 0;
    DELETE FROM public.shift_cash_handovers
    WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.cashier_shifts
    WHERE tenant_id = v_tenant AND branch_id = ANY(v_branches);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

    DELETE FROM public.shift_schedules
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

  IF v_summary <> '{}'::jsonb THEN
    INSERT INTO public.audit_log (tenant_id, user_id, user_name, branch_id, action, entity, entity_id, details)
    VALUES (v_tenant, v_user, COALESCE((SELECT name FROM public.profiles WHERE id = v_user), 'النظام'), p_branch_id,
            'RESET', 'GoLiveExtras', COALESCE(p_branch_id, v_tenant),
            jsonb_build_object('options', p_options, 'summary', v_summary));
  END IF;

  RETURN v_summary;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_reset_go_live_extras(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_go_live_extras(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reset_branch_data(p_branch_id uuid, p_options jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_summary jsonb;
  v_extras jsonb;
  v_tenant uuid := public.current_tenant_id();
  v_purged integer := 0;
BEGIN
  v_summary := public.admin_reset_branch_data_impl(p_branch_id, p_options);
  v_extras := public.admin_reset_go_live_extras(p_branch_id, p_options);
  v_purged := public.purge_orphan_journal_entries(v_tenant);
  RETURN COALESCE(v_summary, '{}'::jsonb) || COALESCE(v_extras, '{}'::jsonb) || jsonb_build_object('journal_entries_purged', v_purged);
END;
$function$;