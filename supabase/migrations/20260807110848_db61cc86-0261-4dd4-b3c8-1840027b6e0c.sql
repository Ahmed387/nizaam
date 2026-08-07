DELETE FROM public.attendance WHERE date > CURRENT_DATE;

CREATE OR REPLACE FUNCTION public.guard_attendance_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.date > CURRENT_DATE THEN
    RAISE EXCEPTION 'مينفعش تسجل حضور بتاريخ في المستقبل';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_guard_attendance_date ON public.attendance;
CREATE TRIGGER trg_guard_attendance_date
BEFORE INSERT OR UPDATE OF date ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_date();