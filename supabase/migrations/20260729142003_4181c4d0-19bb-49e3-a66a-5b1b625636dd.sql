
CREATE OR REPLACE FUNCTION public.is_personal_owner()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'owner'::app_role)
$$;
