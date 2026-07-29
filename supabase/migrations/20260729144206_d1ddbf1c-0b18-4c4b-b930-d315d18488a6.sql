CREATE OR REPLACE FUNCTION public.set_scheduled_reports_cron(_day int, _hour int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  _cron_expr text;
BEGIN
  IF NOT public.is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'only owner can change report schedule';
  END IF;
  IF _day NOT BETWEEN 0 AND 6 THEN
    RAISE EXCEPTION 'day must be 0-6 (0=Sunday)';
  END IF;
  IF _hour NOT BETWEEN 0 AND 23 THEN
    RAISE EXCEPTION 'hour must be 0-23';
  END IF;

  _cron_expr := format('0 %s * * %s', _hour, _day);

  PERFORM cron.unschedule('generate-weekly-reports')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-weekly-reports');

  PERFORM cron.schedule(
    'generate-weekly-reports',
    _cron_expr,
    $ct$
    select net.http_post(
      url:='https://wcvukheadkzktbqkfhum.supabase.co/functions/v1/generate-scheduled-reports',
      headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjdnVraGVhZGt6a3RicWtmaHVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNzQ2OTcsImV4cCI6MjA5MjY1MDY5N30.LU-Nt9d4ZrW3ji67sRXTUoheZh1WKDMyeacw4Ucl7VE"}'::jsonb,
      body:=concat('{"time":"', now(), '"}')::jsonb
    );
    $ct$
  );

  INSERT INTO public.settings (key, value, updated_by)
  VALUES ('scheduled_reports_schedule', jsonb_build_object('day', _day, 'hour', _hour, 'cron', _cron_expr), auth.uid())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_scheduled_reports_cron(int, int) TO authenticated;