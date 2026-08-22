CREATE TABLE public.owner_personal_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  description text NOT NULL DEFAULT 'إيداع',
  deposit_datetime timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_opd_owner_dt ON public.owner_personal_deposits (owner_user_id, deposit_datetime DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_personal_deposits TO authenticated;
GRANT ALL ON public.owner_personal_deposits TO service_role;

ALTER TABLE public.owner_personal_deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY opd_select ON public.owner_personal_deposits FOR SELECT TO authenticated
  USING (personal_access_level(owner_user_id) IN ('view','edit'));

CREATE POLICY opd_insert ON public.owner_personal_deposits FOR INSERT TO authenticated
  WITH CHECK (personal_access_level(owner_user_id) = 'edit');

CREATE POLICY opd_update ON public.owner_personal_deposits FOR UPDATE TO authenticated
  USING (personal_access_level(owner_user_id) = 'edit')
  WITH CHECK (personal_access_level(owner_user_id) = 'edit');

CREATE POLICY opd_delete ON public.owner_personal_deposits FOR DELETE TO authenticated
  USING (personal_access_level(owner_user_id) = 'edit');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'owner_personal_deposits') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.owner_personal_deposits;
  END IF;
END $$;