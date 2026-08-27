CREATE OR REPLACE FUNCTION public.personal_owner_info()
RETURNS TABLE(owner_id uuid, owner_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, COALESCE(p.name, split_part(u.email, '@', 1))
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE lower(u.email) = 'an.ayoub98@gmail.com'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.personal_owner_info() FROM public;
GRANT EXECUTE ON FUNCTION public.personal_owner_info() TO authenticated;