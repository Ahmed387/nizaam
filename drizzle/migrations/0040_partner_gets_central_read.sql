CREATE OR REPLACE FUNCTION public.partner_auto_viewer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'partner' THEN
    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (NEW.user_id, 'viewer', NEW.tenant_id)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_partner_auto_viewer AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.partner_auto_viewer();