CREATE OR REPLACE FUNCTION public.open_cashier_shift(p_branch_id uuid, p_opening_cash numeric, p_notes text DEFAULT NULL::text, p_auto_attendance boolean DEFAULT false)
 RETURNS cashier_shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID; v_row public.cashier_shifts; v_emp record; v_att record;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_branch_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'الفرع غير موجود'; END IF;
  IF v_tenant <> public.current_tenant_id() THEN
    RAISE EXCEPTION 'غير مسموح: الفرع خارج شركتك';
  END IF;

  IF COALESCE(p_opening_cash, 0) < 0 THEN
    RAISE EXCEPTION 'الرصيد الافتتاحي مينفعش يكون بالسالب';
  END IF;

  IF NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'super_admin')
          OR public.has_role(auth.uid(),'owner') OR public.user_in_branch(auth.uid(), p_branch_id)) THEN
    RAISE EXCEPTION 'مش مسموح تفتح وردية في فرع مش مربوط بيك';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cashier_shifts
    WHERE branch_id = p_branch_id AND cashier_id = auth.uid() AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'لديك وردية مفتوحة بالفعل في هذا الفرع';
  END IF;

  SELECT id, name INTO v_emp FROM public.employees
   WHERE user_id = auth.uid() AND branch_id = p_branch_id AND is_active = true LIMIT 1;

  IF v_emp.id IS NOT NULL THEN
    SELECT * INTO v_att FROM public.attendance
     WHERE employee_id = v_emp.id AND date = CURRENT_DATE;

    IF v_att.id IS NULL OR v_att.check_in IS NULL THEN
      IF NOT p_auto_attendance THEN
        RAISE EXCEPTION 'لازم تسجل حضورك الأول قبل ما تفتح الوردية'
          USING ERRCODE = 'check_violation', HINT = 'NO_ATTENDANCE';
      END IF;
      IF v_att.id IS NULL THEN
        INSERT INTO public.attendance (tenant_id, branch_id, employee_id, employee_name, date, check_in, status, created_by, notes)
        VALUES (v_tenant, p_branch_id, v_emp.id, v_emp.name, CURRENT_DATE, now(), 'present', auth.uid(), 'حضور تلقائي مع فتح الوردية');
      ELSE
        UPDATE public.attendance SET check_in = now(),
               status = CASE WHEN status = 'absent' THEN 'present' ELSE status END,
               notes = COALESCE(notes,'') || ' | حضور تلقائي مع فتح الوردية'
         WHERE id = v_att.id;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.cashier_shifts (tenant_id, branch_id, cashier_id, opening_cash, open_notes)
  VALUES (v_tenant, p_branch_id, auth.uid(), COALESCE(p_opening_cash,0), p_notes)
  RETURNING * INTO v_row;

  RETURN v_row;
END $function$;