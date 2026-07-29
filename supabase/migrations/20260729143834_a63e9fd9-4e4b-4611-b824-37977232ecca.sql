-- Unschedule any existing weekly report jobs (both possible names) to prevent duplicates
DO $$
DECLARE
  j RECORD;
BEGIN
  FOR j IN SELECT jobname FROM cron.job WHERE jobname IN ('generate-weekly-reports', 'weekly-reports', 'generate-scheduled-reports')
  LOOP
    PERFORM cron.unschedule(j.jobname);
  END LOOP;
END $$;

-- Re-create a single clean job
SELECT cron.schedule(
  'generate-weekly-reports',
  '0 6 * * 0',
  $$
  SELECT net.http_post(
    url:='https://wcvukheadkzktbqkfhum.supabase.co/functions/v1/generate-scheduled-reports',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjdnVraGVhZGt6a3RicWtmaHVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNzQ2OTcsImV4cCI6MjA5MjY1MDY5N30.LU-Nt9d4ZrW3ji67sRXTUoheZh1WKDMyeacw4Ucl7VE"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);