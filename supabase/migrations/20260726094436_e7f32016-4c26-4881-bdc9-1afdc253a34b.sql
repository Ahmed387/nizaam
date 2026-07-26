
CREATE TABLE public.owner_personal_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  description text NOT NULL,
  category text,
  expense_datetime timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ope_owner_dt ON public.owner_personal_expenses(owner_user_id, expense_datetime DESC);
CREATE INDEX idx_ope_category ON public.owner_personal_expenses(owner_user_id, category);

CREATE TABLE public.owner_expenses_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  granted_user_id uuid NOT NULL,
  can_view boolean NOT NULL DEFAULT true,
  can_edit boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, granted_user_id)
);
CREATE INDEX idx_oea_granted ON public.owner_expenses_access(granted_user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_personal_expenses TO authenticated;
GRANT ALL ON public.owner_personal_expenses TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_expenses_access TO authenticated;
GRANT ALL ON public.owner_expenses_access TO service_role;

ALTER TABLE public.owner_personal_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_expenses_access ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_personal_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid() AND lower(u.email) = 'an.ayoub98@gmail.com'
  );
$$;

CREATE OR REPLACE FUNCTION public.personal_access_level(_owner uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() = _owner AND public.is_personal_owner() THEN 'edit'
    WHEN EXISTS (SELECT 1 FROM public.owner_expenses_access a
      WHERE a.owner_user_id = _owner AND a.granted_user_id = auth.uid() AND a.can_edit = true) THEN 'edit'
    WHEN EXISTS (SELECT 1 FROM public.owner_expenses_access a
      WHERE a.owner_user_id = _owner AND a.granted_user_id = auth.uid() AND a.can_view = true) THEN 'view'
    ELSE 'none'
  END;
$$;

CREATE POLICY "ope_select" ON public.owner_personal_expenses FOR SELECT TO authenticated
  USING (public.personal_access_level(owner_user_id) IN ('view','edit'));
CREATE POLICY "ope_insert" ON public.owner_personal_expenses FOR INSERT TO authenticated
  WITH CHECK (public.personal_access_level(owner_user_id) = 'edit');
CREATE POLICY "ope_update" ON public.owner_personal_expenses FOR UPDATE TO authenticated
  USING (public.personal_access_level(owner_user_id) = 'edit')
  WITH CHECK (public.personal_access_level(owner_user_id) = 'edit');
CREATE POLICY "ope_delete" ON public.owner_personal_expenses FOR DELETE TO authenticated
  USING (public.personal_access_level(owner_user_id) = 'edit');

CREATE POLICY "oea_owner_manage" ON public.owner_expenses_access FOR ALL TO authenticated
  USING (auth.uid() = owner_user_id AND public.is_personal_owner())
  WITH CHECK (auth.uid() = owner_user_id AND public.is_personal_owner());
CREATE POLICY "oea_grantee_read_own" ON public.owner_expenses_access FOR SELECT TO authenticated
  USING (auth.uid() = granted_user_id);

CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_ope_updated_at BEFORE UPDATE ON public.owner_personal_expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER trg_oea_updated_at BEFORE UPDATE ON public.owner_expenses_access
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
