CREATE TABLE IF NOT EXISTS public.settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settings_read_all" ON public.settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "settings_admin_write" ON public.settings
  FOR ALL USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

INSERT INTO public.settings (key, value) VALUES
  ('company', '{"name":"A & N","address":"","phone":"","tax_number":""}'::jsonb),
  ('invoice', '{"footer_note":"شكراً لتعاملكم معنا","show_logo":true}'::jsonb),
  ('inventory', '{"default_low_stock_alert":5}'::jsonb)
ON CONFLICT (key) DO NOTHING;