CREATE OR REPLACE FUNCTION public.enforce_invoice_date_edit_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_allowed boolean := false;
BEGIN
  IF NEW.invoice_date IS DISTINCT FROM OLD.invoice_date THEN
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'يجب تسجيل الدخول لتعديل تاريخ الفاتورة' USING ERRCODE = '42501';
    END IF;

    v_tenant_id := NULLIF(to_jsonb(NEW)->>'tenant_id', '')::uuid;

    SELECT
      EXISTS (
        SELECT 1
        FROM public.tenants t
        WHERE t.id = v_tenant_id
          AND t.owner_user_id = v_user_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = v_user_id
          AND ur.tenant_id = v_tenant_id
          AND ur.role IN ('owner'::public.app_role, 'admin'::public.app_role, 'super_admin'::public.app_role)
      )
    INTO v_allowed;

    IF NOT v_allowed THEN
      RAISE EXCEPTION 'غير مسموح: تعديل تاريخ الفاتورة متاح لمالك الشركة أو المدير العام أو السوبر أدمن داخل نفس الشركة فقط'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_invoice_date_sovereign(
  p_invoice_id uuid,
  p_new_date timestamptz,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_tenant_id uuid;
  v_invoice public.invoices%ROWTYPE;
  v_user_name text;
  v_authorized boolean := false;
  v_journal_ids uuid[] := ARRAY[]::uuid[];
  v_journal_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتعديل تاريخ الفاتورة' USING ERRCODE = '42501';
  END IF;

  IF p_new_date IS NULL THEN
    RAISE EXCEPTION 'تاريخ الفاتورة الجديد مطلوب' USING ERRCODE = '22004';
  END IF;

  SELECT public.current_tenant_id() INTO v_user_tenant_id;
  IF v_user_tenant_id IS NULL THEN
    RAISE EXCEPTION 'تعذر تحديد الشركة الحالية للمستخدم' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_invoice
    FROM public.invoices
   WHERE id = p_invoice_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الفاتورة غير موجودة' USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.tenant_id IS NULL OR v_invoice.tenant_id <> v_user_tenant_id THEN
    RAISE EXCEPTION 'غير مسموح: الفاتورة لا تنتمي إلى الشركة الحالية' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.branches b
     WHERE b.id = v_invoice.branch_id
       AND b.tenant_id = v_invoice.tenant_id
  ) THEN
    RAISE EXCEPTION 'تعذر التحقق من فرع الفاتورة داخل الشركة الحالية' USING ERRCODE = '42501';
  END IF;

  SELECT
    EXISTS (
      SELECT 1
        FROM public.tenants t
       WHERE t.id = v_invoice.tenant_id
         AND t.owner_user_id = v_user_id
    )
    OR EXISTS (
      SELECT 1
        FROM public.user_roles ur
       WHERE ur.user_id = v_user_id
         AND ur.tenant_id = v_invoice.tenant_id
         AND ur.role IN ('owner'::public.app_role, 'admin'::public.app_role, 'super_admin'::public.app_role)
    )
  INTO v_authorized;

  IF NOT v_authorized OR NOT public.user_can_write_branch(v_user_id, v_invoice.branch_id) THEN
    RAISE EXCEPTION 'غير مسموح: يلزم مالك الشركة أو المدير العام أو السوبر أدمن مع صلاحية إدارة الفرع'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.fiscal_periods fp
     WHERE fp.tenant_id = v_invoice.tenant_id
       AND fp.status = 'closed'
       AND v_invoice.invoice_date::date BETWEEN fp.period_start AND fp.period_end
  ) THEN
    RAISE EXCEPTION 'لا يمكن تعديل فاتورة يقع تاريخها الحالي داخل فترة مالية مقفلة'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.fiscal_periods fp
     WHERE fp.tenant_id = v_invoice.tenant_id
       AND fp.status = 'closed'
       AND p_new_date::date BETWEEN fp.period_start AND fp.period_end
  ) THEN
    RAISE EXCEPTION 'لا يمكن نقل الفاتورة إلى فترة مالية مقفلة'
      USING ERRCODE = '23514';
  END IF;

  IF p_new_date IS NOT DISTINCT FROM v_invoice.invoice_date THEN
    RETURN jsonb_build_object(
      'invoice_id', v_invoice.id,
      'invoice_date', v_invoice.invoice_date,
      'journal_entries_updated', 0,
      'changed', false
    );
  END IF;

  UPDATE public.invoices
     SET invoice_date = p_new_date
   WHERE id = v_invoice.id;

  WITH updated_entries AS (
    UPDATE public.journal_entries
       SET entry_date = p_new_date::date,
           updated_at = now()
     WHERE tenant_id = v_invoice.tenant_id
       AND branch_id = v_invoice.branch_id
       AND source_id = v_invoice.id
       AND source_type IN ('invoice', 'invoice_cogs')
     RETURNING id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]), count(*)::integer
    INTO v_journal_ids, v_journal_count
    FROM updated_entries;

  SELECT COALESCE(NULLIF(p.name, ''), 'مستخدم النظام')
    INTO v_user_name
    FROM public.profiles p
   WHERE p.id = v_user_id
     AND p.tenant_id = v_invoice.tenant_id
   LIMIT 1;

  v_user_name := COALESCE(v_user_name, 'مستخدم النظام');

  INSERT INTO public.audit_log (
    user_id,
    user_name,
    tenant_id,
    branch_id,
    action,
    entity,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    v_user_name,
    v_invoice.tenant_id,
    v_invoice.branch_id,
    'invoice_date_changed',
    'invoices',
    v_invoice.id::text,
    jsonb_build_object(
      'old_invoice_date', v_invoice.invoice_date,
      'new_invoice_date', p_new_date,
      'reason', NULLIF(btrim(p_reason), ''),
      'journal_entry_ids', to_jsonb(v_journal_ids),
      'journal_entries_updated', v_journal_count
    )
  );

  RETURN jsonb_build_object(
    'invoice_id', v_invoice.id,
    'invoice_date', p_new_date,
    'journal_entries_updated', v_journal_count,
    'changed', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_invoice_date_sovereign(uuid, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_invoice_date_sovereign(uuid, timestamptz, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_invoice_date_sovereign(uuid, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_invoice_date_sovereign(uuid, timestamptz, text) TO service_role;