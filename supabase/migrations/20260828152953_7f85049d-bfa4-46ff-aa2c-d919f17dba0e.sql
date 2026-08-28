-- 0) local date helper (Africa/Cairo)
CREATE OR REPLACE FUNCTION public.cairo_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$ SELECT (now() AT TIME ZONE 'Africa/Cairo')::date $$;

REVOKE ALL ON FUNCTION public.cairo_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cairo_today() TO authenticated, service_role;

-- 1) attendance: auto_checkout flag
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS auto_checkout boolean NOT NULL DEFAULT false;

-- 2) guard_attendance_date -> Cairo local date
CREATE OR REPLACE FUNCTION public.guard_attendance_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.date > public.cairo_today() THEN
    RAISE EXCEPTION 'مينفعش تسجل حضور بتاريخ في المستقبل';
  END IF;
  RETURN NEW;
END; $function$;

-- 3) guard_attendance_times: block duplicate + silent overwrite
CREATE OR REPLACE FUNCTION public.guard_attendance_times()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_privileged boolean;
BEGIN
  v_privileged := public.is_super_admin(auth.uid())
               OR public.is_admin(auth.uid())
               OR public.has_role(auth.uid(),'owner')
               OR public.has_role(auth.uid(),'supervisor');

  IF NEW.check_out IS NOT NULL AND NEW.check_in IS NULL THEN
    RAISE EXCEPTION 'مينفعش تسجل انصراف من غير ما تسجل حضور الأول';
  END IF;

  IF NEW.check_in IS NOT NULL AND NEW.check_out IS NOT NULL
     AND NEW.check_out <= NEW.check_in THEN
    RAISE EXCEPTION 'وقت الانصراف لازم يكون بعد وقت الحضور';
  END IF;

  -- منع تسجيل حضور مكرر لنفس الموظف في نفس اليوم
  IF TG_OP = 'INSERT' AND EXISTS (
       SELECT 1 FROM public.attendance a
        WHERE a.employee_id = NEW.employee_id
          AND a.date = NEW.date
          AND a.id <> NEW.id
     ) AND NOT v_privileged THEN
    RAISE EXCEPTION 'تم تسجيل حضور مسبق اليوم لهذا الموظف';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.check_in IS NOT NULL
     AND NEW.check_in IS DISTINCT FROM OLD.check_in
     AND NOT v_privileged THEN
    RAISE EXCEPTION 'الحضور اتسجل قبل كده — تعديل وقت الحضور للمدير أو المالك بس';
  END IF;

  -- منع الكتابة فوق انصراف مسجّل بالفعل
  IF TG_OP = 'UPDATE'
     AND OLD.check_out IS NOT NULL
     AND NEW.check_out IS DISTINCT FROM OLD.check_out
     AND NOT v_privileged THEN
    RAISE EXCEPTION 'الانصراف اتسجل قبل كده — تعديل وقت الانصراف للمدير أو المالك بس';
  END IF;

  RETURN NEW;
END $function$;

-- 4) shifts: Cairo local date for attendance lookups
CREATE OR REPLACE FUNCTION public.open_cashier_shift(p_branch_id uuid, p_opening_cash numeric, p_notes text DEFAULT NULL::text, p_auto_attendance boolean DEFAULT false)
 RETURNS cashier_shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID; v_row public.cashier_shifts; v_emp record; v_att record;
  v_today DATE := public.cairo_today();
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
     WHERE employee_id = v_emp.id AND date = v_today;

    IF v_att.id IS NULL OR v_att.check_in IS NULL THEN
      IF NOT p_auto_attendance THEN
        RAISE EXCEPTION 'لازم تسجل حضورك الأول قبل ما تفتح الوردية'
          USING ERRCODE = 'check_violation', HINT = 'NO_ATTENDANCE';
      END IF;
      IF v_att.id IS NULL THEN
        INSERT INTO public.attendance (tenant_id, branch_id, employee_id, employee_name, date, check_in, status, created_by, notes)
        VALUES (v_tenant, p_branch_id, v_emp.id, v_emp.name, v_today, now(), 'present', auth.uid(), 'حضور تلقائي مع فتح الوردية');
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

CREATE OR REPLACE FUNCTION public.close_cashier_shift(p_shift_id uuid, p_closing_cash numeric, p_notes text DEFAULT NULL::text, p_auto boolean DEFAULT false, p_auto_checkout boolean DEFAULT true)
 RETURNS cashier_shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.cashier_shifts; v_cash NUMERIC; v_move NUMERIC; v_expected NUMERIC;
  v_is_system BOOLEAN := (p_auto AND COALESCE(auth.role(), '') = 'service_role');
  v_emp_id uuid;
BEGIN
  SELECT * INTO v_row FROM public.cashier_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية غير موجودة'; END IF;
  IF v_row.status <> 'open' THEN RAISE EXCEPTION 'الوردية مغلقة بالفعل'; END IF;
  IF NOT v_is_system AND v_row.tenant_id <> public.current_tenant_id() THEN
    RAISE EXCEPTION 'غير مسموح';
  END IF;
  IF NOT v_is_system
     AND v_row.cashier_id <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'مسموح فقط لصاحب الوردية أو الأدمن';
  END IF;

  v_cash := public.shift_cash_sales(p_shift_id);
  v_move := public.shift_cash_movement(p_shift_id);
  v_expected := COALESCE(v_row.opening_cash,0) + COALESCE(v_move, COALESCE(v_cash,0));

  UPDATE public.cashier_shifts SET
    closed_at = now(), closing_cash = COALESCE(p_closing_cash,0), cash_sales = v_cash,
    expected_cash = v_expected, variance = COALESCE(p_closing_cash,0) - v_expected,
    close_notes = p_notes, closed_by = auth.uid(),
    status = CASE WHEN v_is_system THEN 'auto_closed' ELSE 'closed' END
  WHERE id = p_shift_id
  RETURNING * INTO v_row;

  IF p_auto_checkout THEN
    SELECT id INTO v_emp_id FROM public.employees
     WHERE user_id = v_row.cashier_id AND branch_id = v_row.branch_id AND is_active = true LIMIT 1;
    IF v_emp_id IS NOT NULL THEN
      UPDATE public.attendance
         SET check_out = now(),
             auto_checkout = true,
             notes = COALESCE(notes,'') || ' | انصراف تلقائي مع قفل الوردية'
       WHERE employee_id = v_emp_id
         AND date >= public.cairo_today() - 1
         AND check_in IS NOT NULL AND check_out IS NULL
         AND now() > check_in;
    END IF;
  END IF;

  RETURN v_row;
END $function$;

-- 5) run_shift_maintenance: real expected cash + real variance + auto checkout
CREATE OR REPLACE FUNCTION public.run_shift_maintenance()
 RETURNS TABLE(reminded integer, warned integer, auto_closed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_reminded INT := 0;
  v_warned INT := 0;
  v_closed INT := 0;
  v_cash NUMERIC;
  v_move NUMERIC;
  v_expected NUMERIC;
  v_hours NUMERIC;
  v_admins UUID[];
  v_branch TEXT;
  v_name TEXT;
  v_emp_id UUID;
BEGIN
  FOR r IN
    SELECT s.*, COALESCE(sc.reminder_hours,12) AS reminder_hours,
           COALESCE(sc.auto_close_hours,16) AS auto_close_hours,
           COALESCE(sc.pre_close_warn_minutes,30) AS pre_close_warn_minutes,
           sc.close_time, COALESCE(sc.close_grace_minutes,60) AS close_grace_minutes
    FROM public.cashier_shifts s
    LEFT JOIN public.branch_schedules sc ON sc.branch_id = s.branch_id
    WHERE s.status = 'open'
  LOOP
    SELECT name INTO v_branch FROM public.branches WHERE id = r.branch_id;
    SELECT name INTO v_name FROM public.profiles WHERE id = r.cashier_id;
    SELECT COALESCE(array_agg(ur.user_id), '{}') INTO v_admins
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE p.tenant_id = r.tenant_id AND ur.role IN ('admin','owner');

    v_hours := EXTRACT(EPOCH FROM (now() - r.opened_at)) / 3600.0;

    -- 1) Auto close
    IF v_hours >= r.auto_close_hours THEN
      v_cash := public.shift_cash_sales(r.id);
      v_move := public.shift_cash_movement(r.id);
      v_expected := COALESCE(r.opening_cash,0) + COALESCE(v_move, COALESCE(v_cash,0));

      UPDATE public.cashier_shifts SET
        closed_at = now(),
        closing_cash = 0,
        cash_sales = v_cash,
        expected_cash = v_expected,
        variance = 0 - v_expected,
        status = 'auto_closed',
        close_notes = COALESCE(close_notes,'') || ' [قفل تلقائي بعد ' || round(v_hours) || ' ساعة — الدرج لم يُجرد، الفرق الظاهر يحتاج مراجعة]'
      WHERE id = r.id;
      v_closed := v_closed + 1;

      -- انصراف تلقائي للموظف صاحب الوردية
      SELECT id INTO v_emp_id FROM public.employees
       WHERE user_id = r.cashier_id AND branch_id = r.branch_id AND is_active = true LIMIT 1;
      IF v_emp_id IS NOT NULL THEN
        UPDATE public.attendance
           SET check_out = now(),
               auto_checkout = true,
               notes = COALESCE(notes,'') || ' | انصراف تلقائي مع القفل التلقائي للوردية'
         WHERE employee_id = v_emp_id
           AND date >= public.cairo_today() - 1
           AND check_in IS NOT NULL AND check_out IS NULL
           AND now() > check_in;
      END IF;

      INSERT INTO public.notifications (user_id, title, body, type, link, related_entity, related_entity_id)
      SELECT u, 'قفل تلقائي لوردية', 'وردية ' || COALESCE(v_name,'كاشير') || ' في فرع ' || COALESCE(v_branch,'') || ' اتقفلت تلقائيًا بعد ' || round(v_hours) || ' ساعة وتحتاج مراجعة.',
             'shift_auto_closed', '/admin/shifts', 'cashier_shifts', r.id
      FROM unnest(array_append(v_admins, r.cashier_id)) AS u;

    ELSIF r.close_time IS NOT NULL
      AND (now() AT TIME ZONE 'Africa/Cairo')::time
          BETWEEN (r.close_time - make_interval(mins => r.pre_close_warn_minutes)) AND r.close_time
      AND (r.pre_close_warned_at IS NULL OR r.pre_close_warned_at < now() - interval '12 hours') THEN
      UPDATE public.cashier_shifts SET pre_close_warned_at = now() WHERE id = r.id;
      v_warned := v_warned + 1;
      INSERT INTO public.notifications (user_id, title, body, type, link, related_entity, related_entity_id)
      SELECT u, 'قرب ميعاد قفل الفرع', 'فرع ' || COALESCE(v_branch,'') || ' هيقفل الساعة ' || to_char(r.close_time,'HH24:MI') || ' — لازم تقفل الوردية.',
             'shift_pre_close', '/branch/' || r.branch_id || '/shifts/close', 'cashier_shifts', r.id
      FROM unnest(array_append(v_admins, r.cashier_id)) AS u;

    ELSIF v_hours >= r.reminder_hours
      AND (r.reminder_sent_at IS NULL OR r.reminder_sent_at < now() - interval '4 hours') THEN
      UPDATE public.cashier_shifts SET reminder_sent_at = now() WHERE id = r.id;
      v_reminded := v_reminded + 1;
      INSERT INTO public.notifications (user_id, title, body, type, link, related_entity, related_entity_id)
      SELECT u, 'وردية مفتوحة من فترة طويلة', 'وردية ' || COALESCE(v_name,'كاشير') || ' في فرع ' || COALESCE(v_branch,'') || ' مفتوحة من ' || round(v_hours) || ' ساعة.',
             'shift_reminder', '/branch/' || r.branch_id || '/shifts/close', 'cashier_shifts', r.id
      FROM unnest(array_append(v_admins, r.cashier_id)) AS u;
    END IF;
  END LOOP;

  reminded := v_reminded; warned := v_warned; auto_closed := v_closed;
  RETURN NEXT;
END $function$;