CREATE OR REPLACE FUNCTION public.assert_can_import_opening_debt()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  ) THEN
    RAISE EXCEPTION 'ترحيل الديون القديمة متاح للأونر / المدير بس';
  END IF;
END; $$;