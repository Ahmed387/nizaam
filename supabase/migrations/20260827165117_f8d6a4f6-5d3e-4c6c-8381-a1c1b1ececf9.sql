CREATE OR REPLACE FUNCTION public.personal_identity()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(coalesce((SELECT u.email FROM auth.users u WHERE u.id = auth.uid()), '')) = 'an.ayoub98@gmail.com'
      OR lower(coalesce((SELECT p.username FROM public.profiles p WHERE p.id = auth.uid()), '')) = 'an.ayoub98@gmail.com'
      THEN 'owner'
    WHEN lower(coalesce((SELECT u.email FROM auth.users u WHERE u.id = auth.uid()), '')) = 'nasser1968ayoub@gmail.com'
      OR lower(coalesce((SELECT p.username FROM public.profiles p WHERE p.id = auth.uid()), '')) = 'nasser1968ayoub@gmail.com'
      THEN 'viewer'
    ELSE 'none'
  END;
$$;

CREATE OR REPLACE FUNCTION public.personal_access_level(_owner uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN _owner IS DISTINCT FROM (
      SELECT u2.id FROM auth.users u2 WHERE lower(u2.email) = 'an.ayoub98@gmail.com' LIMIT 1
    ) THEN 'none'
    WHEN public.personal_identity() = 'owner' THEN 'edit'
    WHEN public.personal_identity() = 'viewer' THEN 'view'
    ELSE 'none'
  END;
$$;

DROP FUNCTION IF EXISTS public.personal_owner_info();

CREATE FUNCTION public.personal_owner_info()
RETURNS TABLE(owner_id uuid, owner_name text, access text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    (SELECT u.id FROM auth.users u WHERE lower(u.email) = 'an.ayoub98@gmail.com' LIMIT 1) AS owner_id,
    'حج ناصر'::text AS owner_name,
    CASE public.personal_identity()
      WHEN 'owner' THEN 'edit'
      WHEN 'viewer' THEN 'view'
      ELSE 'none'
    END AS access
  WHERE public.personal_identity() <> 'none';
$$;

GRANT EXECUTE ON FUNCTION public.personal_identity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.personal_owner_info() TO authenticated;
GRANT EXECUTE ON FUNCTION public.personal_access_level(uuid) TO authenticated;