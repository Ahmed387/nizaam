-- 1) shift_schedules
CREATE TABLE IF NOT EXISTS public.shift_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL DEFAULT public.current_tenant_id(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  shift_name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_extra BOOLEAN NOT NULL DEFAULT false,
  shift_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_schedules TO authenticated;
GRANT ALL ON public.shift_schedules TO service_role;

ALTER TABLE public.shift_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_schedules_select" ON public.shift_schedules
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "shift_schedules_write" ON public.shift_schedules
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin')))
  WITH CHECK (tenant_id = public.current_tenant_id() AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin')));

CREATE INDEX IF NOT EXISTS idx_shift_schedules_branch ON public.shift_schedules(branch_id);

CREATE OR REPLACE FUNCTION public.set_shift_schedules_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public'
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_shift_schedules_updated_at
  BEFORE UPDATE ON public.shift_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_shift_schedules_updated_at();

-- 2) cashier_shifts additions
ALTER TABLE public.cashier_shifts
  ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES public.shift_schedules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reported_opening_cash NUMERIC,
  ADD COLUMN IF NOT EXISTS expected_opening_cash NUMERIC,
  ADD COLUMN IF NOT EXISTS opening_status TEXT NOT NULL DEFAULT 'accepted',
  ADD COLUMN IF NOT EXISTS overridden_by UUID,
  ADD COLUMN IF NOT EXISTS overridden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS soft_close_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS soft_closed_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE public.cashier_shifts
    ADD CONSTRAINT cashier_shifts_opening_status_chk
    CHECK (opening_status IN ('accepted','rejected','pending_override'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) schedule helpers
CREATE OR REPLACE FUNCTION public.current_shift_schedule(p_branch_id uuid, p_at timestamptz DEFAULT now())
RETURNS public.shift_schedules
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH t AS (SELECT (p_at AT TIME ZONE 'Africa/Cairo')::time AS tt, (p_at AT TIME ZONE 'Africa/Cairo')::date AS dd)
  SELECT s.* FROM public.shift_schedules s, t
  WHERE s.branch_id = p_branch_id AND s.is_active
    AND (s.shift_date IS NULL OR s.shift_date IN (t.dd, t.dd - 1))
    AND (
      CASE WHEN s.end_time > s.start_time
        THEN t.tt >= (s.start_time - interval '30 minutes') AND t.tt < s.end_time
        ELSE t.tt >= (s.start_time - interval '30 minutes') OR t.tt < s.end_time
      END
    )
  ORDER BY s.is_extra DESC, s.start_time
  LIMIT 1;
$$;

-- expected opening cash = closing cash of last closed shift in branch
CREATE OR REPLACE FUNCTION public.expected_opening_cash(p_branch_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT COALESCE(s.closing_cash, 0)
    FROM public.cashier_shifts s
    WHERE s.branch_id = p_branch_id AND s.status <> 'open'
    ORDER BY s.closed_at DESC NULLS LAST
    LIMIT 1
  ), 0)::numeric;
$$;

-- planned end timestamp of a shift
CREATE OR REPLACE FUNCTION public.shift_planned_end(p_shift_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE s RECORD; sc RECORD; d DATE; e TIMESTAMP;
BEGIN
  SELECT * INTO s FROM public.cashier_shifts WHERE id = p_shift_id;
  IF s.id IS NULL OR s.schedule_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO sc FROM public.shift_schedules WHERE id = s.schedule_id;
  IF sc.id IS NULL THEN RETURN NULL; END IF;
  d := (s.opened_at AT TIME ZONE 'Africa/Cairo')::date;
  e := d + sc.end_time;
  IF sc.end_time <= sc.start_time THEN e := e + interval '1 day'; END IF;
  IF e < (s.opened_at AT TIME ZONE 'Africa/Cairo') THEN e := e + interval '1 day'; END IF;
  RETURN e AT TIME ZONE 'Africa/Cairo';
END $$;

-- 4) secure open with handover
CREATE OR REPLACE FUNCTION public.open_cashier_shift_secure(
  p_branch_id uuid,
  p_reported_cash numeric,
  p_notes text DEFAULT NULL,
  p_auto_attendance boolean DEFAULT false
)
RETURNS public.cashier_shifts
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_tenant UUID; v_row public.cashier_shifts; v_sched public.shift_schedules;
  v_expected NUMERIC; v_status TEXT; v_diff NUMERIC;
  v_branch TEXT; v_name TEXT; v_admins UUID[];
BEGIN
  SELECT tenant_id, name INTO v_tenant, v_branch FROM public.branches WHERE id = p_branch_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'الفرع غير موجود'; END IF;

  v_sched := public.current_shift_schedule(p_branch_id);
  v_expected := public.expected_opening_cash(p_branch_id);
  v_diff := COALESCE(p_reported_cash,0) - v_expected;
  v_status := CASE WHEN abs(v_diff) < 0.01 THEN 'accepted' ELSE 'rejected' END;

  -- reuse legacy function for all validations + attendance + insert
  v_row := public.open_cashier_shift(p_branch_id, COALESCE(p_reported_cash,0), p_notes, p_auto_attendance);

  UPDATE public.cashier_shifts SET
    schedule_id = v_sched.id,
    reported_opening_cash = COALESCE(p_reported_cash,0),
    expected_opening_cash = v_expected,
    opening_status = v_status
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  UPDATE public.cashier_shifts SET soft_close_at = public.shift_planned_end(v_row.id) - interval '10 minutes'
  WHERE id = v_row.id RETURNING * INTO v_row;

  IF v_status = 'rejected' THEN
    SELECT name INTO v_name FROM public.profiles WHERE id = auth.uid();
    SELECT COALESCE(array_agg(ur.user_id), '{}') INTO v_admins
      FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
     WHERE p.tenant_id = v_tenant AND ur.role IN ('admin','owner','branch_manager');

    INSERT INTO public.notifications (user_id, title, body, type, link, related_entity, related_entity_id)
    SELECT u, 'رفض استلام عهدة وردية',
           COALESCE(v_name,'الكاشير') || ' في فرع ' || COALESCE(v_branch,'') || ' عدّ ' ||
           to_char(COALESCE(p_reported_cash,0),'FM999999990.00') || ' جنيه والمتوقع ' ||
           to_char(v_expected,'FM999999990.00') || ' — ' ||
           CASE WHEN v_diff < 0 THEN 'عجز ' ELSE 'زيادة ' END || to_char(abs(v_diff),'FM999999990.00') || ' جنيه. محتاج اعتماد.',
           'shift_handover_rejected', '/admin/shifts', 'cashier_shifts', v_row.id
    FROM unnest(v_admins) AS u;
  END IF;

  RETURN v_row;
END $$;

-- 5) owner/manager override
CREATE OR REPLACE FUNCTION public.override_shift_opening(
  p_shift_id uuid,
  p_note text DEFAULT NULL
)
RETURNS public.cashier_shifts
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_row public.cashier_shifts; v_diff NUMERIC; v_prev RECORD; v_prev_name TEXT;
BEGIN
  SELECT * INTO v_row FROM public.cashier_shifts WHERE id = p_shift_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'الوردية غير موجودة'; END IF;
  IF v_row.tenant_id <> public.current_tenant_id() THEN RAISE EXCEPTION 'غير مسموح'; END IF;
  IF NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'owner')
          OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'branch_manager')) THEN
    RAISE EXCEPTION 'الاعتماد مسموح للأونر أو مدير الفرع فقط';
  END IF;
  IF v_row.opening_status = 'accepted' THEN RETURN v_row; END IF;

  v_diff := COALESCE(v_row.reported_opening_cash,0) - COALESCE(v_row.expected_opening_cash,0);

  SELECT s.cashier_id, p.name INTO v_prev
  FROM public.cashier_shifts s LEFT JOIN public.profiles p ON p.id = s.cashier_id
  WHERE s.branch_id = v_row.branch_id AND s.id <> v_row.id AND s.status <> 'open'
  ORDER BY s.closed_at DESC NULLS LAST LIMIT 1;
  v_prev_name := COALESCE(v_prev.name, 'الكاشير السابق');

  IF abs(v_diff) >= 0.01 THEN
    INSERT INTO public.treasury (tenant_id, branch_id, type, category, amount, description, reference_id, created_by, payment_method)
    VALUES (
      v_row.tenant_id, v_row.branch_id,
      CASE WHEN v_diff < 0 THEN 'expense'::treasury_type ELSE 'income'::treasury_type END,
      CASE WHEN v_diff < 0 THEN 'عجز عهدة وردية' ELSE 'زيادة عهدة وردية' END,
      abs(v_diff),
      'تسوية فرق استلام عهدة عند فتح وردية — مسؤولية ' || v_prev_name || COALESCE(' — ' || p_note, ''),
      v_row.id, auth.uid(), 'cash'
    );
  END IF;

  UPDATE public.cashier_shifts SET
    opening_status = 'accepted',
    overridden_by = auth.uid(),
    overridden_at = now(),
    open_notes = COALESCE(open_notes,'') || ' | اعتماد إداري لفرق العهدة' || COALESCE(': ' || p_note, '')
  WHERE id = p_shift_id RETURNING * INTO v_row;

  INSERT INTO public.notifications (user_id, title, body, type, link, related_entity, related_entity_id)
  VALUES (v_row.cashier_id, 'تم اعتماد فتح وردينك',
          'الإدارة اعتمدت رصيد الدرج وتقدر تبدأ البيع دلوقتي.',
          'shift_handover_approved', '/branch/' || v_row.branch_id || '/sales/new', 'cashier_shifts', v_row.id);

  RETURN v_row;
END $$;

-- 6) POS gate
CREATE OR REPLACE FUNCTION public.shift_sale_gate(p_branch_id uuid)
RETURNS TABLE(shift_id uuid, allowed boolean, reason text, minutes_left integer, opening_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE s RECORD; v_end TIMESTAMPTZ; v_left INT;
BEGIN
  SELECT * INTO s FROM public.cashier_shifts
   WHERE branch_id = p_branch_id AND cashier_id = auth.uid() AND status = 'open'
   ORDER BY opened_at DESC LIMIT 1;

  IF s.id IS NULL THEN
    shift_id := NULL; allowed := false; reason := 'no_shift'; minutes_left := NULL; opening_status := NULL;
    RETURN NEXT; RETURN;
  END IF;

  IF s.opening_status <> 'accepted' THEN
    shift_id := s.id; allowed := false; reason := 'handover_pending'; minutes_left := NULL; opening_status := s.opening_status;
    RETURN NEXT; RETURN;
  END IF;

  v_end := public.shift_planned_end(s.id);
  IF v_end IS NOT NULL THEN
    v_left := CEIL(EXTRACT(EPOCH FROM (v_end - now())) / 60.0);
    IF v_left <= 10 THEN
      shift_id := s.id; allowed := false; reason := 'soft_close'; minutes_left := GREATEST(v_left,0); opening_status := s.opening_status;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  shift_id := s.id; allowed := true; reason := 'ok'; minutes_left := v_left; opening_status := s.opening_status;
  RETURN NEXT;
END $$;

-- 7) maintenance: schedule aware soft/hard close
CREATE OR REPLACE FUNCTION public.run_shift_maintenance()
RETURNS TABLE(reminded integer, warned integer, auto_closed integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_reminded INT := 0; v_warned INT := 0; v_closed INT := 0;
  v_cash NUMERIC; v_move NUMERIC; v_expected NUMERIC; v_hours NUMERIC;
  v_admins UUID[]; v_branch TEXT; v_name TEXT; v_emp_id UUID;
  v_end TIMESTAMPTZ; v_grace INT;
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
    FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
    WHERE p.tenant_id = r.tenant_id AND ur.role IN ('admin','owner');

    v_hours := EXTRACT(EPOCH FROM (now() - r.opened_at)) / 3600.0;
    v_end := public.shift_planned_end(r.id);
    v_grace := r.close_grace_minutes;

    IF (v_end IS NOT NULL AND now() >= v_end + make_interval(mins => v_grace))
       OR v_hours >= r.auto_close_hours THEN
      v_cash := public.shift_cash_sales(r.id);
      v_move := public.shift_cash_movement(r.id);
      v_expected := COALESCE(r.opening_cash,0) + COALESCE(v_move, COALESCE(v_cash,0));

      UPDATE public.cashier_shifts SET
        closed_at = now(), closing_cash = 0, cash_sales = v_cash,
        expected_cash = v_expected, variance = 0 - v_expected,
        status = 'auto_closed',
        close_notes = COALESCE(close_notes,'') || ' [قفل تلقائي' ||
          CASE WHEN v_end IS NOT NULL AND now() >= v_end + make_interval(mins => v_grace)
               THEN ' بعد انتهاء ميعاد الوردية المجدولة' ELSE ' بعد ' || round(v_hours) || ' ساعة' END ||
          ' — الدرج لم يُجرد، الفرق الظاهر يحتاج مراجعة]'
      WHERE id = r.id;
      v_closed := v_closed + 1;

      SELECT id INTO v_emp_id FROM public.employees
       WHERE user_id = r.cashier_id AND branch_id = r.branch_id AND is_active = true LIMIT 1;
      IF v_emp_id IS NOT NULL THEN
        UPDATE public.attendance
           SET check_out = now(), auto_checkout = true,
               notes = COALESCE(notes,'') || ' | انصراف تلقائي مع القفل التلقائي للوردية'
         WHERE employee_id = v_emp_id AND date >= public.cairo_today() - 1
           AND check_in IS NOT NULL AND check_out IS NULL AND now() > check_in;
      END IF;

      INSERT INTO public.notifications (user_id, title, body, type, link, related_entity, related_entity_id)
      SELECT u, 'قفل تلقائي لوردية', 'وردية ' || COALESCE(v_name,'كاشير') || ' في فرع ' || COALESCE(v_branch,'') || ' اتقفلت تلقائيًا وتحتاج مراجعة.',
             'shift_auto_closed', '/admin/shifts', 'cashier_shifts', r.id
      FROM unnest(array_append(v_admins, r.cashier_id)) AS u;

    ELSIF v_end IS NOT NULL AND now() >= v_end - interval '10 minutes'
      AND r.soft_closed_at IS NULL THEN
      UPDATE public.cashier_shifts SET soft_closed_at = now(), soft_close_at = v_end - interval '10 minutes' WHERE id = r.id;
      v_warned := v_warned + 1;
      INSERT INTO public.notifications (user_id, title, body, type, link, related_entity, related_entity_id)
      VALUES (r.cashier_id, 'قرب انتهاء الوردية — صفّي الدرج',
              'الوردية بتنتهي ' || to_char(v_end AT TIME ZONE 'Africa/Cairo','HH24:MI') || ' — البيع اتوقف، لازم تعد الدرج وتقفل الوردية.',
              'shift_soft_close', '/branch/' || r.branch_id || '/shifts/close', 'cashier_shifts', r.id);

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