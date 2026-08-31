CREATE TABLE IF NOT EXISTS public.system_cron_tokens (
  name TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.system_cron_tokens TO service_role;

ALTER TABLE public.system_cron_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only" ON public.system_cron_tokens
FOR ALL TO service_role USING (true) WITH CHECK (true);