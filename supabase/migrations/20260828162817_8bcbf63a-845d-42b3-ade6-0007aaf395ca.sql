-- 1) مستلمو العهدة المصرّح لهم في الفرع (مدير الفرع + الإدارة)
CREATE OR REPLACE FUNCTION public.branch_handover_managers(p_branch_id uuid)
RETURNS TABLE (id uuid, name text, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (p.id) p.id, p.name, ur.role::text
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  JOIN public.branches b ON b.id = p_branch_id
  WHERE p.tenant_id = b.tenant_id
    AND b.tenant_id = public.current_tenant_id()
    AND (
      ur.role IN ('admin','owner')
      OR (ur.role = 'branch_manager' AND EXISTS (
            SELECT 1 FROM public.branch_users bu
            WHERE bu.user_id = p.id AND bu.branch_id = p_branch_id))
    )
  ORDER BY p.id, (ur.role = 'branch_manager') DESC;
$$;

GRANT EXECUTE ON FUNCTION public.branch_handover_managers(uuid) TO authenticated;

-- 2) تسليم العهدة الطارئ: الكاشير نفسه يقدر يسجّله باختيار المدير المستلم
CREATE OR REPLACE FUNCTION public.record_mid_shift_handover(
  p_shift_id uuid,
  p_manager_id uuid DEFAULT NULL,
  p_amount_received numeric DEFAULT 0,
  p_notes text DEFAULT NULL
)
RETURNS public.shift_cash_handovers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.cashier_shifts;
  v_manager uuid;
  v_is_mgr boolean;
  v_is_cashier boolean;
  v_row public.shift_cash_handovers;
  v_cashier_name text; v_manager_name text; v_branch_name text;
  v_admins uuid[];
BEGIN
  SELECT * INTO v_shift FROM public.cashier_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية غير موجودة'; END IF;
  IF v_shift.tenant_id <> public.current_tenant_id() THEN RAISE EXCEPTION 'غير مسموح'; END IF;
  IF v_shift.status <> 'open' THEN RAISE EXCEPTION 'الوردية مقفولة — التسليم الطارئ للورديات المفتوحة فقط'; END IF;

  v_is_mgr := public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner')
     OR public.has_role(auth.uid(), 'super_admin')
     OR (public.has_role(auth.uid(), 'branch_manager') AND EXISTS (
           SELECT 1 FROM public.branch_users bu
           WHERE bu.user_id = auth.uid() AND bu.branch_id = v_shift.branch_id));
  v_is_cashier := (auth.uid() = v_shift.cashier_id);

  IF NOT (v_is_mgr OR v_is_cashier) THEN
    RAISE EXCEPTION 'مسموح للكاشير صاحب الوردية أو مدير الفرع أو الإدارة فقط بتسجيل تسليم العهدة';
  END IF;

  -- المدير المستلم
  IF v_is_mgr AND p_manager_id IS NULL THEN
    v_manager := auth.uid();
  ELSE
    v_manager := p_manager_id;
  END IF;
  IF v_manager IS NULL THEN
    RAISE EXCEPTION 'لازم تختار مدير الفرع المستلم للعهدة';
  END IF;
  IF v_manager = v_shift.cashier_id THEN
    RAISE EXCEPTION 'مينفعش الكاشير يسلّم العهدة لنفسه';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branch_handover_managers(v_shift.branch_id) m WHERE m.id = v_manager) THEN
    RAISE EXCEPTION 'المستلم لازم يكون مدير الفرع أو من الإدارة المخوّلة لهذا الفرع';
  END IF;

  IF COALESCE(p_amount_received,0) < 0 THEN RAISE EXCEPTION 'المبلغ غير صحيح'; END IF;

  INSERT INTO public.shift_cash_handovers
    (tenant_id, shift_id, branch_id, from_cashier_id, to_manager_id, amount, notes, occurred_at, created_by)
  VALUES
    (v_shift.tenant_id, v_shift.id, v_shift.branch_id, v_shift.cashier_id, v_manager,
     COALESCE(p_amount_received,0), NULLIF(p_notes,''), now(), auth.uid())
  RETURNING * INTO v_row;

  SELECT name INTO v_cashier_name FROM public.profiles WHERE id = v_shift.cashier_id;
  SELECT name INTO v_manager_name FROM public.profiles WHERE id = v_manager;
  SELECT name INTO v_branch_name FROM public.branches WHERE id = v_shift.branch_id;

  SELECT COALESCE(array_agg(DISTINCT ur.user_id), '{}') INTO v_admins
  FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
  WHERE p.tenant_id = v_shift.tenant_id AND ur.role IN ('admin','owner');

  -- إشعار للمدير المستلم كمان لو التسجيل جه من الكاشير
  IF v_is_cashier AND NOT v_is_mgr THEN
    v_admins := array(SELECT DISTINCT x FROM unnest(v_admins || ARRAY[v_manager]) AS x);
  END IF;

  IF array_length(v_admins,1) IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, type, link, related_entity, related_entity_id)
    SELECT u,
      'تنبيه طارئ: تسليم عهدة أثناء الوردية',
      'الكاشير ' || COALESCE(v_cashier_name,'—') || ' غادر فرع ' || COALESCE(v_branch_name,'—') ||
      ' في تمام الساعة ' || to_char(v_row.occurred_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD HH24:MI:SS') ||
      '، وقام مدير الفرع ' || COALESCE(v_manager_name,'—') || ' باستلام عهدة بقيمة ' ||
      to_char(v_row.amount, 'FM999999990.00') || ' جنيه، والوردية مستمرة برقم ' || v_shift.id::text ||
      COALESCE(' — ملاحظات: ' || v_row.notes, ''),
      'general',
      '/branch/' || v_shift.branch_id::text || '/shifts/close',
      'cashier_shifts', v_shift.id
    FROM unnest(v_admins) AS u;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_mid_shift_handover(uuid, uuid, numeric, text) TO authenticated;

-- 3) منع التعديل/الحذف المباشر على الجداول المالية الحساسة من المتصفح
REVOKE UPDATE, DELETE ON public.journal_entries FROM authenticated;
REVOKE UPDATE, DELETE ON public.journal_entry_lines FROM authenticated;
REVOKE UPDATE, DELETE ON public.product_batches FROM authenticated;
REVOKE UPDATE, DELETE ON public.invoices FROM authenticated;
REVOKE UPDATE, DELETE ON public.treasury FROM authenticated;
GRANT ALL ON public.journal_entries TO service_role;
GRANT ALL ON public.journal_entry_lines TO service_role;
GRANT ALL ON public.product_batches TO service_role;
GRANT ALL ON public.invoices TO service_role;
GRANT ALL ON public.treasury TO service_role;