
CREATE TABLE IF NOT EXISTS public.scheduled_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  period text NOT NULL DEFAULT 'weekly',
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sr_tenant_idx ON public.scheduled_reports(tenant_id, created_at DESC);

ALTER TABLE public.scheduled_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sr_read ON public.scheduled_reports;
CREATE POLICY sr_read ON public.scheduled_reports FOR SELECT
  USING (((tenant_id = public.current_tenant_id()) AND public.is_admin(auth.uid())) OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS sr_no_write ON public.scheduled_reports;
CREATE POLICY sr_no_write ON public.scheduled_reports FOR ALL
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.scheduled_reports;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
