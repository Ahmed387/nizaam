
CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id uuid NOT NULL PRIMARY KEY,
  tenant_id uuid NOT NULL,
  last_login_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.user_presence TO authenticated;
GRANT ALL ON public.user_presence TO service_role;

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "presence_self_write" ON public.user_presence
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND tenant_id = public.current_tenant_id());

CREATE POLICY "presence_read_admin_supervisor" ON public.user_presence
  FOR SELECT
  USING (
    public.is_super_admin(auth.uid())
    OR (tenant_id = public.current_tenant_id()
        AND (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'supervisor'::app_role)))
  );

CREATE INDEX IF NOT EXISTS idx_user_presence_tenant ON public.user_presence(tenant_id);
