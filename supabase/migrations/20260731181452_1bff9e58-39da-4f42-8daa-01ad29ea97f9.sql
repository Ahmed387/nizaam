
-- ============ Branch schedules ============
CREATE TABLE IF NOT EXISTS public.branch_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL UNIQUE REFERENCES public.branches(id) ON DELETE CASCADE,
  open_time TIME,
  close_time TIME,
  close_grace_minutes INT NOT NULL DEFAULT 60,
  weekly_off INT[] NOT NULL DEFAULT '{}',
  reminder_hours INT NOT NULL DEFAULT 12,
  auto_close_hours INT NOT NULL DEFAULT 16,
  pre_close_warn_minutes INT NOT NULL DEFAULT 30,
  block_open_on_off_day BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.branch_schedules TO authenticated;
GRANT ALL ON public.branch_schedules TO service_role;
ALTER TABLE public.branch_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branch_schedules_select" ON public.branch_schedules FOR SELECT TO authenticated
USING (tenant_id = public.current_tenant_id());

CREATE POLICY "branch_schedules_write" ON public.branch_schedules FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin')))
WITH CHECK (tenant_id = public.current_tenant_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin')));

-- ============ Branch closures ============
CREATE TABLE IF NOT EXISTS public.branch_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_branch_closures_branch ON public.branch_closures(branch_id, start_date, end_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.branch_closures TO authenticated;
GRANT ALL ON public.branch_closures TO service_role;
ALTER TABLE public.branch_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branch_closures_select" ON public.branch_closures FOR SELECT TO authenticated
USING (tenant_id = public.current_tenant_id());

CREATE POLICY "branch_closures_write" ON public.branch_closures FOR ALL TO authenticated
USING (tenant_id = public.current_tenant_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin')))
WITH CHECK (tenant_id = public.current_tenant_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'super_admin')));

CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_branch_schedules_updated_at ON public.branch_schedules;
CREATE TRIGGER trg_branch_schedules_updated_at BEFORE UPDATE ON public.branch_schedules
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_branch_closures_updated_at ON public.branch_closures;
CREATE TRIGGER trg_branch_closures_updated_at BEFORE UPDATE ON public.branch_closures
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ============ Shift tracking columns ============
ALTER TABLE public.cashier_shifts ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
ALTER TABLE public.cashier_shifts ADD COLUMN IF NOT EXISTS pre_close_warned_at TIMESTAMPTZ;

-- ============ Maintenance job ============
CREATE OR REPLACE FUNCTION public.run_shift_maintenance()
RETURNS TABLE(reminded INT, warned INT, auto_closed INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_reminded INT := 0;
  v_warned INT := 0;
  v_closed INT := 0;
  v_cash NUMERIC;
  v_expected NUMERIC;
  v_hours NUMERIC;
  v_admins UUID[];
  v_branch TEXT;
  v_name TEXT;
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
      v_expected := COALESCE(r.opening_cash,0) + COALESCE(v_cash,0);
      UPDATE public.cashier_shifts SET
        closed_at = now(),
        closing_cash = v_expected,
        cash_sales = v_cash,
        expected_cash = v_expected,
        variance = 0,
        status = 'auto_closed',
        close_notes = COALESCE(close_notes,'') || ' [قفل تلقائي بعد ' || round(v_hours) || ' ساعة — يحتاج مراجعة]'
      WHERE id = r.id;
      v_closed := v_closed + 1;

      INSERT INTO public.notifications (user_id, title, body, type, link, related_entity, related_entity_id)
      SELECT u, 'قفل تلقائي لوردية', 'وردية ' || COALESCE(v_name,'كاشير') || ' في فرع ' || COALESCE(v_branch,'') || ' اتقفلت تلقائيًا بعد ' || round(v_hours) || ' ساعة وتحتاج مراجعة.',
             'shift_auto_closed', '/admin/shifts', 'cashier_shifts', r.id
      FROM unnest(array_append(v_admins, r.cashier_id)) AS u;

    -- 2) Pre-close warning (branch close time approaching)
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

    -- 3) Long-open reminder
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
END $$;

GRANT EXECUTE ON FUNCTION public.run_shift_maintenance() TO authenticated, service_role;

-- ============ Admin shifts history ============
CREATE OR REPLACE VIEW public.v_shifts_history AS
SELECT s.*, b.name AS branch_name, p.name AS cashier_name
FROM public.cashier_shifts s
LEFT JOIN public.branches b ON b.id = s.branch_id
LEFT JOIN public.profiles p ON p.id = s.cashier_id;

GRANT SELECT ON public.v_shifts_history TO authenticated;
